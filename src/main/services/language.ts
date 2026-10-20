import { spawn } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import type {
  Diagnostic,
  FormatResult,
  LanguageToolStatus,
  LintRequest,
  Preferences,
} from '../../shared/api';
import { ProjectError, type ProjectService } from './projects';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 15_000;
const SEPARATOR = '\u001f';
const LANGUAGE_TOOLS = ['texlab', 'chktex', 'latexindent', 'latexindent.pl'] as const;

/** Resolve only the optional language tools, never a renderer-provided executable name. */
async function findLanguageTool(name: (typeof LANGUAGE_TOOLS)[number]): Promise<string | null> {
  if (!(LANGUAGE_TOOLS as readonly string[]).includes(name)) return null;
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

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROCESS_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (value: string) => (stdout += value));
    child.stderr.on('data', (value: string) => (stderr += value));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new ProjectError('LANGUAGE_TIMEOUT', 'The language tool timed out after 15 seconds.'),
        );
        return;
      }
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.stdin.end(input);
  });
}

export class LanguageService {
  constructor(
    private readonly projects: ProjectService,
    private readonly getPreferences: () => Promise<Preferences>,
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

  async lint(request: LintRequest): Promise<Diagnostic[]> {
    const target = await this.projects.resolvePath(request);
    if (!/\.tex$/i.test(request.path))
      throw new ProjectError('INVALID_ARGUMENT', 'ChkTeX only lints .tex files.');
    const preferences = await this.getPreferences();
    if (!preferences.chktexEnabled) return [];
    const executable = await findLanguageTool('chktex');
    if (!executable) return [];
    const root = this.projects.getRoot(request.projectId);
    const result = await runProcess(
      executable,
      ['-q', '-v0', '-s', SEPARATOR, '-I0', target],
      root,
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
  }): Promise<FormatResult> {
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
    const result = await runProcess(executable, ['-'], root, request.content);
    if (result.code !== 0 || !result.stdout)
      throw new ProjectError('FORMAT_FAILED', 'latexindent could not format this document.');
    return { content: result.stdout, formatter: 'latexindent' };
  }
}
