import { randomUUID } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, extname, isAbsolute, join } from 'node:path';
import type {
  Diagnostic,
  FormatResult,
  LanguageToolStatus,
  LintRequest,
  Preferences,
} from '../../shared/api';
import { ProjectError, type ProjectService } from './projects';
import { getToolPath } from './tool-paths';
import { OwnedProcessError, runOwnedProcess } from './owned-process';
import { recipeDirectory } from './recipe-plan';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 15_000;
const SEPARATOR = '\u001f';
const LANGUAGE_TOOLS = ['texlab', 'chktex', 'latexindent', 'latexindent.pl'] as const;

/** Resolve only the optional language tools, never a renderer-provided executable name. */
async function findLanguageTool(name: (typeof LANGUAGE_TOOLS)[number]): Promise<string | null> {
  if (!(LANGUAGE_TOOLS as readonly string[]).includes(name)) return null;
  const canonicalName = name === 'latexindent.pl' ? 'latexindent' : name;
  const custom = getToolPath(canonicalName);
  if (custom) {
    try {
      if ((await stat(custom)).isFile()) return await realpath(custom);
    } catch {
      /* Tool path is invalid */
    }
    return null;
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const clean = directory.replace(/^"|"$/g, '');
    if (!isAbsolute(clean)) continue;
    const candidates =
      process.platform === 'win32' && !name.endsWith('.pl')
        ? [join(clean, `${name}.exe`), join(clean, name)]
        : [join(clean, name)];
    for (const candidate of candidates) {
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if ((await stat(candidate)).isFile()) return await realpath(candidate);
      } catch {
        // Continue through the explicit, fixed executable list.
      }
    }
  }
  return null;
}

export function parseChktexOutput(output: string, fallbackFile: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const row of output.split(/\r?\n/)) {
    if (!row.trim()) continue;
    const [file, line, column, code, ...messageParts] = row.split(SEPARATOR);
    const lineNumber = Number(line);
    const columnNumber = Number(column);
    const message = messageParts.join(SEPARATOR).trim();
    if (!message || !Number.isInteger(lineNumber) || lineNumber < 1) continue;
    diagnostics.push({
      severity: /error/i.test(code) ? 'error' : 'warning',
      source: 'chktex',
      code: code?.trim() || undefined,
      message,
      file:
        basename(file || fallbackFile).toLowerCase() === basename(fallbackFile).toLowerCase()
          ? fallbackFile
          : undefined,
      line: lineNumber,
      ...(Number.isInteger(columnNumber) && columnNumber > 0 ? { column: columnNumber } : {}),
    });
  }
  return diagnostics.slice(0, 500);
}

interface LanguageTask {
  requestId: string;
  controller: AbortController;
  done: Promise<unknown>;
}

export class LanguageService {
  private readonly tasks = new Map<string, LanguageTask>();
  private readonly cancelled = new Map<string, number>();
  private stopping: Promise<void> | null = null;

  cancel(value: { requestId: string } | string): void {
    const requestId = typeof value === 'string' ? value : value?.requestId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(requestId))
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid language request identifier.');
    this.cancelled.set(requestId, Date.now() + 60_000);
    if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.keys().next().value!);
    for (const task of this.tasks.values())
      if (task.requestId === requestId) task.controller.abort();
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const tasks = [...this.tasks.values()];
    for (const task of tasks) task.controller.abort();
    this.stopping = Promise.allSettled(tasks.map((task) => task.done))
      .then(() => undefined)
      .finally(() => {
        this.stopping = null;
      });
    return this.stopping;
  }

  private task<T>(
    request: { projectId: string; requestId?: string },
    kind: 'lint' | 'format',
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.stopping) throw new ProjectError('LANGUAGE_BUSY', 'Language tools are stopping.');
    if (!request || typeof request.projectId !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a workspace for the language request.');
    this.projects.getRoot(request.projectId);
    const requestId = request.requestId ?? randomUUID();
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(requestId))
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid language request identifier.');
    for (const [id, expires] of this.cancelled)
      if (expires <= Date.now()) this.cancelled.delete(id);
    if (this.cancelled.has(requestId))
      throw new ProjectError('LANGUAGE_CANCELLED', 'Language request cancelled.');
    const key = request.projectId + '\0' + kind;
    const previous = this.tasks.get(key);
    if (previous && kind === 'format')
      throw new ProjectError('LANGUAGE_BUSY', 'A formatter is already running for this workspace.');
    previous?.controller.abort();
    const controller = new AbortController();
    const entry: LanguageTask = { requestId, controller, done: Promise.resolve() };
    const run = Promise.resolve()
      .then(async () => {
        await previous?.done.catch(() => undefined);
        controller.signal.throwIfAborted();
        const result = await action(controller.signal);
        controller.signal.throwIfAborted();
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof OwnedProcessError) throw new ProjectError(error.code, error.message);
        if (controller.signal.aborted)
          throw new ProjectError('LANGUAGE_CANCELLED', 'Language request cancelled.');
        throw error;
      })
      .finally(() => {
        if (this.tasks.get(key) === entry) this.tasks.delete(key);
      });
    entry.done = run;
    this.tasks.set(key, entry);
    return run;
  }

  private run(
    executable: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
    input?: string,
  ) {
    signal.throwIfAborted();
    return runOwnedProcess({
      executable,
      args,
      cwd,
      signal,
      input,
      timeoutMs: PROCESS_TIMEOUT_MS,
      maxStdoutBytes: 5 * 1024 * 1024,
      maxStderrBytes: 256 * 1024,
    });
  }

  constructor(
    private readonly projects: ProjectService,
    private readonly getPreferences: () => Promise<Preferences>,
    private readonly getBuildDirectory?: (projectId: string, path: string) => Promise<string>,
  ) {}

  async status(): Promise<LanguageToolStatus> {
    const [texlab, chktex, latexindent, latexindentPerl] = await Promise.all([
      findLanguageTool('texlab'),
      findLanguageTool('chktex'),
      findLanguageTool('latexindent'),
      findLanguageTool('latexindent.pl'),
    ]);
    return {
      texlab: !!texlab,
      chktex: !!chktex,
      latexindent: !!(latexindent ?? latexindentPerl),
    };
  }

  async lint(request: LintRequest & { requestId?: string }): Promise<Diagnostic[]> {
    return this.task(request, 'lint', (signal) => this.lintDocument(request, signal));
  }

  private async lintDocument(request: LintRequest, signal: AbortSignal): Promise<Diagnostic[]> {
    const target = await this.projects.resolvePath(request);
    if (!/\.tex$/i.test(request.path))
      throw new ProjectError('INVALID_ARGUMENT', 'ChkTeX only lints .tex files.');
    const preferences = await this.getPreferences();
    if (!preferences.chktexEnabled) return [];
    const executable = await findLanguageTool('chktex');
    if (!executable) return [];
    const root = this.projects.getRoot(request.projectId);
    const result = await this.run(
      executable,
      ['-q', '-v0', '-s', SEPARATOR, '-I0', target],
      root,
      signal,
    );
    // ChkTeX uses a nonzero result for some malformed inputs but still emits useful diagnostics.
    void result.code;
    void result.stderr;
    return parseChktexOutput(result.stdout, request.path).flatMap((diagnostic) => {
      const rule = Number(diagnostic.code);
      if (Number.isInteger(rule) && preferences.chktexIgnoredRules.includes(rule)) return [];
      const severity = diagnostic.code
        ? preferences.chktexRuleSeverities[diagnostic.code]
        : undefined;
      return severity ? [{ ...diagnostic, severity }] : [diagnostic];
    });
  }

  async format(request: {
    projectId: string;
    path: string;
    content: string;
    requestId?: string;
  }): Promise<FormatResult> {
    return this.task(request, 'format', (signal) => this.formatDocument(request, signal));
  }

  private async formatDocument(
    request: { projectId: string; path: string; content: string },
    signal: AbortSignal,
  ): Promise<FormatResult> {
    await this.projects.resolvePath({ projectId: request.projectId, path: request.path });
    if (!/\.tex$/i.test(request.path))
      throw new ProjectError('INVALID_ARGUMENT', 'latexindent only formats .tex files.');
    if (
      typeof request.content !== 'string' ||
      Buffer.byteLength(request.content, 'utf8') > MAX_SOURCE_BYTES
    )
      throw new ProjectError('INVALID_ARGUMENT', 'The document is too large to format safely.');
    const executable =
      (await findLanguageTool('latexindent')) ?? (await findLanguageTool('latexindent.pl'));
    if (!executable)
      throw new ProjectError(
        'TOOL_MISSING',
        'latexindent was not found on PATH. Install it to format LaTeX.',
      );
    const root = this.projects.getRoot(request.projectId);
    const resolved = await this.projects.resolvePath({
      projectId: request.projectId,
      path: request.path,
    });
    const fileBase = basename(resolved, extname(resolved));
    const logFileName = `${fileBase}-indent.log`;

    let cruftDir = join(root, 'build', 'textra');
    if (this.getBuildDirectory) {
      try {
        cruftDir = await this.getBuildDirectory(request.projectId, request.path);
      } catch {
        /* Fall back to default build folder */
      }
    }
    signal.throwIfAborted();
    cruftDir = await recipeDirectory(root, cruftDir, true);

    const result = await this.run(
      executable,
      ['-c', cruftDir, '-g', logFileName, '-'],
      root,
      signal,
      request.content,
    );
    if (result.code !== 0 || !result.stdout)
      throw new ProjectError('FORMAT_FAILED', 'latexindent could not format this document.');
    return { content: result.stdout, formatter: 'latexindent' };
  }
}
