import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  BuildRequest,
  BuildState,
  FileRef,
  PdfLocation,
  SourceLocation,
  SyncForwardRequest,
  SyncInverseRequest,
  ToolInfo,
  RestoredPdf,
} from '../../shared/api';
import { parseDiagnostics } from './diagnostics';
import { getToolPath } from './tool-paths';
import { terminateProcessTree } from './owned-process';
import which from 'which';
import type { RecipeSettings } from '../../shared/recipes';
import { planRecipe, recipeArguments, recipeDirectory, type RecipePlan } from './recipe-plan';

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

const names = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'latexmk',
  'bibtex',
  'biber',
  'synctex',
  'chktex',
  'latexindent',
] as const;
const MAX_LOG = 2_000_000;
const MAX_PDF = 64 * 1024 * 1024;

async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink > 1 || info.size > limit)
      throw new BuildError('Cached artifact is unsafe or exceeds its size limit.');
    // Bound reads even if another process grows the output after stat.
    const buffer = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const chunk = await file.read(buffer, size, buffer.length - size, null);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size > limit) throw new BuildError('Cached artifact exceeds its size limit.');
    return buffer.subarray(0, size);
  } finally {
    await file.close();
  }
}

export async function findExecutable(name: string): Promise<string | null> {
  if (!(names as readonly string[]).includes(name)) throw new BuildError('Unsupported tool.');
  const custom = getToolPath(name);
  if (custom) {
    try {
      if ((await stat(custom)).isFile()) return await realpath(custom);
    } catch {
      /* Fall through to report the tool as not found. */
    }
    return null;
  }
  try {
    const resolved = await which(name, { nothrow: true });
    if (resolved && (await stat(resolved)).isFile()) return await realpath(resolved);
    if (name === 'latexindent') {
      const pl = await which('latexindent.pl', { nothrow: true });
      if (pl && (await stat(pl)).isFile()) return await realpath(pl);
    }
  } catch {
    /* Tool not found */
  }
  return null;
}

function probe(executable: string, timeoutMs = 4000): Promise<string | null> {
  return new Promise((done) => {
    let output = '';
    const child = spawn(executable, ['--version'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, timeoutMs);
    child.stdout?.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(0, 4096);
    });
    child.stderr?.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(0, 4096);
    });
    child.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0 ? (output.split(/\r?\n/).find(Boolean) ?? null) : null);
    });
  });
}

export async function detectTools(): Promise<ToolInfo[]> {
  const results: ToolInfo[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < names.length) {
        const index = next++;
        const name = names[index]!;
        const path = await findExecutable(name);
        results[index] = {
          name,
          path,
          version: path ? await probe(path) : null,
          custom: getToolPath(name) !== undefined,
        };
      }
    }),
  );
  return results;
}

function relativePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    /[\\:]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    isAbsolute(value)
  )
    throw new BuildError('Invalid relative path.');
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.startsWith('-') ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part) ||
        ['.git', '.textra', 'node_modules'].includes(part.toLowerCase()),
    )
  )
    throw new BuildError('Unsafe project path.');
  return value;
}

async function checkedPath(root: string, path: string, createDirectories = false): Promise<string> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)) !== root)
    throw new BuildError('The project folder changed or contains an unsafe link.');
  const parts = relativePath(path).split('/');
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (createDirectories) {
      try {
        await mkdir(current);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    }
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new BuildError('Symlinks are not allowed in build paths.');
    const canonical = await realpath(current);
    const inside = relative(root, canonical);
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
      throw new BuildError('Path escapes the project.');
  }
  return current;
}

export class BuildService {
  private state: BuildState = {
    running: false,
    log: '',
    diagnostics: [],
    outcome: 'idle',
    pdfPath: null,
    projectId: null,
    rootFile: null,
  };
  private child: ChildProcess | null = null;
  private cancelled = false;
  private timedOut = false;
  private successful: {
    projectId: string;
    rootFile: string;
    path: string;
    absolute: string;
    bytes: Uint8Array;
    auxiliary?: string;
    version: number;
    syncValid?: boolean;
  } | null = null;
  private pdfVersion = 0;
  private created: string[] = [];
  private stopping: Promise<void> | null = null;
  constructor(
    private readonly getRoot: (id: string) => string,
    private readonly timeoutMs = 120_000,
    private readonly metadataDirectory?: string,
  ) {}

  private async metadataPath(root: string): Promise<string | null> {
    if (!this.metadataDirectory) return null;
    const directory = join(this.metadataDirectory, 'last-pdfs');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new BuildError('Unsafe PDF cache directory.');
    return join(directory, `${createHash('sha256').update(root).digest('hex')}.json`);
  }

  private async rememberPdf(request: BuildRequest): Promise<void> {
    const pdf = this.successful;
    if (!pdf || pdf.projectId !== request.projectId) return;
    const root = this.getRoot(request.projectId);
    const target = await this.metadataPath(root);
    if (!target) return;
    const fingerprint = await this.pdfFingerprint(await checkedPath(root, pdf.path));
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          schemaVersion: 1,
          root,
          rootFile: pdf.rootFile,
          path: pdf.path,
          recipeId: request.recipe ?? null,
          compiledAt: new Date().toISOString(),
          fingerprint,
          digest: createHash('sha256').update(pdf.bytes).digest('hex'),
        }),
        { flag: 'wx', mode: 0o600 },
      );
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  /** Restored bytes are preview-only; current-build SyncTeX stays unavailable. */
  async restoreLastPdf(projectId: string): Promise<RestoredPdf | null> {
    const root = this.getRoot(projectId);
    if (this.state.running || this.successful?.projectId === projectId) return null;
    try {
      const target = await this.metadataPath(root);
      if (!target) return null;
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > 8192)
        return null;
      const raw: unknown = JSON.parse((await readBoundedFile(target, 8192)).toString('utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const value = raw as Record<string, unknown>;
      if (
        value.schemaVersion !== 1 ||
        value.root !== root ||
        typeof value.rootFile !== 'string' ||
        !/\.tex$/i.test(value.rootFile) ||
        typeof value.path !== 'string' ||
        !/\.pdf$/i.test(value.path) ||
        typeof value.compiledAt !== 'string' ||
        !Number.isFinite(Date.parse(value.compiledAt)) ||
        !(
          value.recipeId === null ||
          (typeof value.recipeId === 'string' && value.recipeId.length <= 1024)
        ) ||
        typeof value.fingerprint !== 'string' ||
        typeof value.digest !== 'string'
      )
        return null;
      await checkedPath(root, relativePath(value.rootFile));
      const path = relativePath(value.path);
      const absolute = await checkedPath(root, path);
      const output = await lstat(absolute);
      if (output.size > MAX_PDF || (await this.pdfFingerprint(absolute)) !== value.fingerprint)
        return null;
      const bytes = await readBoundedFile(absolute, MAX_PDF);
      if (
        bytes.length > MAX_PDF ||
        bytes.subarray(0, 5).toString() !== '%PDF-' ||
        createHash('sha256').update(bytes).digest('hex') !== value.digest
      )
        return null;
      this.getRoot(projectId);
      // An explicit compile may have completed while cache validation was in flight.
      if (this.state.running || this.successful?.projectId === projectId) return null;
      this.successful = {
        projectId,
        rootFile: value.rootFile,
        path,
        absolute,
        bytes: new Uint8Array(bytes),
        version: ++this.pdfVersion,
        syncValid: false,
      };
      return {
        projectId,
        rootFile: value.rootFile,
        path,
        recipeId: value.recipeId,
        compiledAt: value.compiledAt,
        pdfVersion: this.successful.version,
      };
    } catch {
      return null;
    }
  }

  getState(): BuildState {
    return structuredClone(this.state);
  }
  private append(text: string): void {
    if (this.state.log.length < MAX_LOG)
      this.state.log += text.slice(0, MAX_LOG - this.state.log.length);
  }
  private async terminate(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await terminateProcessTree(child);
  }
  async cancel(): Promise<void> {
    if (!this.state.running) return;
    this.cancelled = true;
    this.stopping ??= this.terminate().finally(() => {
      this.stopping = null;
    });
    await this.stopping;
  }
  private run(
    executable: string,
    args: string[],
    cwd: string,
    extraEnv: NodeJS.ProcessEnv = {},
  ): Promise<number> {
    if (this.cancelled) return Promise.resolve(-1);
    this.append(
      `\n> ${basename(executable)} ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n`,
    );
    return new Promise((done, reject) => {
      const child = spawn(executable, args, {
        cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...extraEnv, MIKTEX_ENABLE_INSTALLER: '0' },
      });
      this.child = child;
      child.stdout?.on('data', (data: Buffer) => this.append(data.toString()));
      child.stderr?.on('data', (data: Buffer) => this.append(data.toString()));
      child.once('error', (error) => {
        if (this.child === child) this.child = null;
        reject(error);
      });
      child.once('close', (code) => {
        if (this.child === child) this.child = null;
        done(code ?? -1);
      });
    });
  }

  async compile(request: BuildRequest, settings?: RecipeSettings): Promise<BuildState> {
    if (this.state.running) throw new BuildError('A build is already running. Cancel it first.');
    if (
      !request ||
      typeof request.projectId !== 'string' ||
      !['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'bibtex-pipeline'].includes(request.engine)
    )
      throw new BuildError('Invalid build request.');
    const rootFile = relativePath(request.rootFile);
    if (!/\.tex$/i.test(rootFile)) throw new BuildError('Choose a .tex root document.');
    const root = this.getRoot(request.projectId);
    this.cancelled = false;
    this.timedOut = false;
    this.state = {
      running: true,
      outcome: 'running',
      log: '',
      diagnostics: [],
      pdfPath: this.successful?.projectId === request.projectId ? this.successful.path : null,
      pdfVersion:
        this.successful?.projectId === request.projectId ? this.successful.version : undefined,
      projectId: request.projectId,
      rootFile,
    };
    const timer = setTimeout(() => {
      this.timedOut = true;
      void this.cancel();
    }, this.timeoutMs);
    try {
      await checkedPath(root, rootFile);
      if (request.recipe !== undefined) {
        if (typeof request.recipe !== 'string' || !settings)
          throw new BuildError('Configured recipe settings are required.');
        await this.compileRecipe(request, root, settings);
      } else {
        const compilerName =
          request.engine === 'bibtex-pipeline' || request.engine === 'latexmk'
            ? 'pdflatex'
            : request.engine;
        const compiler = await findExecutable(compilerName);
        if (!compiler)
          throw new BuildError(
            `${compilerName} was not found on PATH. Install a TeX distribution, then restart TeXtra.`,
          );
        const version = await probe(compiler);
        if (this.cancelled) throw new BuildError('Build cancelled.');
        const miktex = /MiKTeX/i.test(version ?? '');
        const safeFlags = miktex
          ? ['-disable-installer', '-disable-write18', '-dont-parse-first-line']
          : ['-no-shell-escape', '-no-parse-first-line'];
        const targetKey = createHash('sha256').update(rootFile).digest('hex').slice(0, 12);
        const outputRelative = `build/textra/${targetKey}/${randomUUID()}`;
        const output = await checkedPath(root, outputRelative, true);
        this.created.push(output);
        // TeX \include writes aux files under matching relative subdirectories.
        let mirrored = 0;
        const mirror = async (source: string, destination: string, depth = 0): Promise<void> => {
          if (this.cancelled) throw new BuildError('Build cancelled.');
          if (depth > 20 || mirrored > 5000)
            throw new BuildError('Project has too many folders to prepare a bounded build.');
          for (const entry of await readdir(source, { withFileTypes: true })) {
            if (
              entry.isDirectory() &&
              !entry.isSymbolicLink() &&
              !['build', 'node_modules', '.git', '.textra', '.agents'].includes(entry.name) &&
              !entry.name.startsWith('.')
            ) {
              await mkdir(join(destination, entry.name), { recursive: true });
              mirrored++;
              await mirror(join(source, entry.name), join(destination, entry.name), depth + 1);
            }
          }
        };
        await mirror(root, output);
        const flags = [
          ...safeFlags,
          '-interaction=nonstopmode',
          '-halt-on-error',
          '-file-line-error',
          '-synctex=1',
          `-output-directory=${output}`,
          `./${rootFile}`,
        ];
        let code: number;
        if (request.engine === 'latexmk') {
          const executable = await findExecutable('latexmk');
          if (!executable) throw new BuildError('latexmk was not found on PATH.');
          if (/["'`$&|<>^%!()\r\n]/.test(root + rootFile + output))
            throw new BuildError(
              'For paths with shell metacharacters use a direct TeX engine instead of latexmk.',
            );
          code = await this.run(
            executable,
            [
              '-norc',
              '-pdf',
              '-view=none',
              '-interaction=nonstopmode',
              '-halt-on-error',
              '-file-line-error',
              '-synctex=1',
              ...safeFlags.map((flag) => `-latexoption=${flag}`),
              `-outdir=${output}`,
              `./${rootFile}`,
            ],
            root,
          );
        } else {
          code = await this.run(compiler, flags, root);
          if (code === 0 && request.engine === 'bibtex-pipeline' && !this.cancelled) {
            const bibtex = await findExecutable('bibtex');
            if (!bibtex) throw new BuildError('BibTeX was not found on PATH.');
            code = await this.run(
              bibtex,
              [
                ...(miktex ? ['-disable-installer'] : []),
                basename(rootFile).replace(/\.tex$/i, ''),
              ],
              output,
              {
                BIBINPUTS: `${root}${delimiter}${process.env.BIBINPUTS ?? ''}`,
                BSTINPUTS: `${root}${delimiter}${process.env.BSTINPUTS ?? ''}`,
              },
            );
          }
          if (code === 0 && !this.cancelled) code = await this.run(compiler, flags, root);
          if (code === 0 && request.engine === 'bibtex-pipeline' && !this.cancelled)
            code = await this.run(compiler, flags, root);
        }
        this.state.diagnostics = parseDiagnostics(this.state.log, rootFile, root);
        if (this.cancelled) this.state.outcome = this.timedOut ? 'failed' : 'cancelled';
        else if (code !== 0) this.state.outcome = 'failed';
        else {
          const pdfPath = `${outputRelative}/${basename(rootFile).replace(/\.tex$/i, '')}.pdf`;
          const absolute = await checkedPath(root, pdfPath);
          if ((await stat(absolute)).size > MAX_PDF)
            throw new BuildError('PDF exceeds the 64 MiB preview limit.');
          const bytes = await readFile(absolute);
          if (bytes.subarray(0, 5).toString() !== '%PDF-')
            throw new BuildError('Compiler did not produce a valid PDF header.');
          this.successful = {
            projectId: request.projectId,
            rootFile,
            path: pdfPath,
            absolute,
            bytes: new Uint8Array(bytes),
            version: ++this.pdfVersion,
          };
          this.state.pdfPath = pdfPath;
          this.state.pdfVersion = this.successful.version;
          this.state.outcome = 'success';
          // Only remove directories created by this service instance, never arbitrary user build folders.
          while (this.created.length > 5) {
            const old = this.created.shift();
            if (old && old !== output && old.startsWith(join(root, 'build', 'textra') + sep))
              await rm(old, { recursive: true, force: true }).catch(() => undefined);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Compilation failed.';
      this.append(`\n${message}\n`);
      this.state.diagnostics = [
        ...parseDiagnostics(this.state.log, rootFile, root),
        { severity: 'error', message },
      ];
      this.state.outcome = this.cancelled && !this.timedOut ? 'cancelled' : 'failed';
    } finally {
      clearTimeout(timer);
      if (this.timedOut) {
        this.append('\nBuild timed out.\n');
        this.state.diagnostics.push({ severity: 'error', message: 'Build timed out.' });
      }
      this.state.running = false;
    }
    if (this.state.outcome === 'success') await this.rememberPdf(request).catch(() => undefined);
    return this.getState();
  }

  private async compileRecipe(
    request: BuildRequest,
    root: string,
    settings: RecipeSettings,
  ): Promise<void> {
    const plan = await planRecipe(root, request.rootFile, request.recipe!, settings);
    // Validate the entire sequence before starting even the first process.
    const prepared = [];
    const capabilities = new Map<string, { executable: string; miktex: boolean }>();
    for (const step of plan.steps) {
      let capability = capabilities.get(step.command);
      if (!capability) {
        const executable = await findExecutable(step.command);
        if (!executable) throw new BuildError(`${step.command} was not found on PATH.`);
        const probeExecutable =
          step.command === 'latexmk' ? await findExecutable('pdflatex') : executable;
        if (!probeExecutable) throw new BuildError('pdflatex was not found on PATH.');
        const version = await probe(probeExecutable, 10000);
        if (!version)
          throw new BuildError(
            `Could not verify ${step.command}. Check the TeX installation and try again.`,
          );
        capability = { executable, miktex: /MiKTeX/i.test(version) };
        capabilities.set(step.command, capability);
      }
      prepared.push({
        ...step,
        executable: capability.executable,
        args: recipeArguments(step, plan, capability.miktex),
      });
      if (this.cancelled) throw new BuildError('Build cancelled.');
    }
    const previous = await this.pdfFingerprint(plan.pdf);
    await this.prepareRecipeDirectories(plan);
    // Stable output paths can acquire partial sidecars in a failed build.
    // Retain the PDF bytes without mapping them through newer SyncTeX data.
    if (this.successful?.absolute === plan.pdf) this.successful.syncValid = false;
    let code = -1;
    this.state.stepCount = prepared.length;
    this.state.stepsDone = 0;
    for (const step of prepared) {
      if (this.cancelled) break;
      await recipeDirectory(root, step.cwd);
      await this.checkRecipeArtifacts(plan);
      const bibliography = ['bibtex', 'biber'].includes(step.command);
      code = await this.run(step.executable, step.args, step.cwd, {
        ...(bibliography
          ? {
              BIBINPUTS: `${dirname(plan.document)}${delimiter}${root}${delimiter}${process.env.BIBINPUTS ?? ''}`,
              BSTINPUTS: `${dirname(plan.document)}${delimiter}${root}${delimiter}${process.env.BSTINPUTS ?? ''}`,
            }
          : {}),
        ...step.env,
      });
      if (code !== 0) break;
      this.state.stepsDone = (this.state.stepsDone ?? 0) + 1;
    }
    this.state.diagnostics = parseDiagnostics(this.state.log, request.rootFile, root);
    if (this.cancelled) {
      this.state.outcome = this.timedOut ? 'failed' : 'cancelled';
      return;
    }
    if (code !== 0) {
      this.state.outcome = 'failed';
      return;
    }
    const current = await this.pdfFingerprint(plan.pdf);
    if (!current || current === previous)
      throw new BuildError(
        'The recipe did not generate a fresh PDF. Check the output directory and compiler steps.',
      );
    const pdfPath = relative(root, plan.pdf).split(sep).join('/');
    const absolute = await checkedPath(root, pdfPath);
    if ((await stat(absolute)).size > MAX_PDF)
      throw new BuildError('PDF exceeds the 64 MiB preview limit.');
    const bytes = await readFile(absolute);
    if (bytes.subarray(0, 5).toString() !== '%PDF-')
      throw new BuildError('Compiler did not produce a valid PDF header.');
    this.successful = {
      projectId: request.projectId,
      rootFile: request.rootFile,
      path: pdfPath,
      absolute,
      auxiliary: plan.auxiliary,
      bytes: new Uint8Array(bytes),
      version: ++this.pdfVersion,
    };
    this.state.pdfPath = pdfPath;
    this.state.pdfVersion = this.successful.version;
    this.state.outcome = 'success';
    // Configured paths belong to the project; they are never added to retention/pruning.
  }

  private async pdfFingerprint(path: string): Promise<string | null> {
    try {
      const info = await lstat(path, { bigint: true });
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1n)
        throw new BuildError('Generated artifacts cannot be links.');
      // ctime also changes when a sync client updates metadata on an untouched PDF.
      return `${info.ino}:${info.size}:${info.mtimeNs}`;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async checkRecipeArtifacts(plan: RecipePlan): Promise<void> {
    await recipeDirectory(plan.root, plan.output);
    await recipeDirectory(plan.root, plan.auxiliary);
    for (const directory of new Set([plan.output, plan.auxiliary])) {
      for (const extension of [
        'pdf',
        'aux',
        'log',
        'synctex',
        'synctex.gz',
        'toc',
        'out',
        'bbl',
        'blg',
        'bcf',
        'run.xml',
        'fls',
        'fdb_latexmk',
        'xdv',
        'dvi',
      ])
        await this.pdfFingerprint(join(directory, `${plan.jobName}.${extension}`));
    }
  }

  private async prepareRecipeDirectories(plan: RecipePlan): Promise<void> {
    // \include writes auxiliary files in matching source subdirectories.
    let mirrored = 0;
    const mirror = async (source: string, destination: string, depth = 0): Promise<void> => {
      if (this.cancelled) throw new BuildError('Build cancelled.');
      if (depth > 20 || mirrored > 5000)
        throw new BuildError('Project has too many folders to prepare a bounded build.');
      for (const entry of await readdir(source, { withFileTypes: true })) {
        const directory = join(source, entry.name);
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          entry.name.startsWith('.') ||
          ['build', 'node_modules'].includes(entry.name)
        )
          continue;
        if (
          [plan.output, plan.auxiliary].some(
            (output) => output === directory || output.startsWith(directory + sep),
          )
        )
          continue;
        const target = join(destination, entry.name);
        await recipeDirectory(plan.root, target, true);
        mirrored++;
        if (directory !== target) await mirror(directory, target, depth + 1);
      }
    };
    if (dirname(plan.document) !== plan.auxiliary)
      await mirror(dirname(plan.document), plan.auxiliary);
    await this.checkRecipeArtifacts(plan);
  }

  async readPdf(request: FileRef): Promise<Uint8Array> {
    this.getRoot(request.projectId);
    if (
      !this.successful ||
      this.successful.projectId !== request.projectId ||
      this.successful.path !== request.path
    )
      throw new BuildError('Only the last successful build PDF can be opened.');
    return new Uint8Array(this.successful.bytes);
  }
  private async sync(args: string[], projectId: string): Promise<string> {
    const root = this.getRoot(projectId);
    const executable = await findExecutable('synctex');
    if (!executable)
      throw new BuildError('SyncTeX is unavailable. Install it with your TeX distribution.');
    return new Promise((done, reject) => {
      let output = '';
      const child = spawn(executable, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new BuildError('SyncTeX timed out.'));
      }, 5000);
      child.stdout?.on('data', (data: Buffer) => {
        output = (output + data.toString()).slice(0, 100_000);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) done(output);
        else reject(new BuildError('SyncTeX found no matching location. Recompile the document.'));
      });
    });
  }
  private successfulFor(projectId: string, rootFile: string) {
    if (
      !this.successful ||
      this.successful.projectId !== projectId ||
      this.successful.rootFile !== rootFile ||
      this.successful.syncValid === false
    )
      throw new BuildError('Compile this root document successfully before using SyncTeX.');
    return this.successful;
  }
  async syncForward(request: SyncForwardRequest): Promise<PdfLocation> {
    if (!Number.isInteger(request.line) || request.line < 1 || request.line > 10_000_000)
      throw new BuildError('Invalid source line.');
    const last = this.successfulFor(request.projectId, request.rootFile);
    const source = await checkedPath(this.getRoot(request.projectId), request.path);
    const output = await this.sync(
      [
        'view',
        '-i',
        `${request.line}:1:${source}`,
        '-o',
        last.absolute,
        ...(last.auxiliary ? ['-d', last.auxiliary] : []),
      ],
      request.projectId,
    );
    const number = (key: string) => Number(new RegExp(`^${key}:([\\d.-]+)`, 'm').exec(output)?.[1]);
    const result = { page: number('Page'), x: number('x'), y: number('y') };
    if (
      !Number.isInteger(result.page) ||
      result.page < 1 ||
      !Number.isFinite(result.x) ||
      !Number.isFinite(result.y)
    )
      throw new BuildError('SyncTeX found no PDF location for this line.');
    return result;
  }
  async syncInverse(request: SyncInverseRequest): Promise<SourceLocation> {
    if (
      !Number.isInteger(request.page) ||
      request.page < 1 ||
      !Number.isFinite(request.x) ||
      !Number.isFinite(request.y) ||
      request.x < 0 ||
      request.y < 0 ||
      request.x > 100000 ||
      request.y > 100000
    )
      throw new BuildError('Invalid PDF coordinates.');
    const last = this.successfulFor(request.projectId, request.rootFile);
    const output = await this.sync(
      [
        'edit',
        '-o',
        `${request.page}:${request.x}:${request.y}:${last.absolute}`,
        ...(last.auxiliary ? ['-d', last.auxiliary] : []),
      ],
      request.projectId,
    );
    const input = /^Input:(.+)$/m.exec(output)?.[1]?.trim();
    const line = Number(/^Line:(\d+)\s*$/m.exec(output)?.[1]);
    if (!input || !Number.isInteger(line) || line < 1)
      throw new BuildError('SyncTeX found no source location.');
    const root = this.getRoot(request.projectId);
    const path = relative(root, resolve(root, input)).split(sep).join('/');
    await checkedPath(root, path);
    return { path, line, column: 1 };
  }
}
