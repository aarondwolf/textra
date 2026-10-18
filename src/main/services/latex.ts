import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  BuildRequest,
  BuildState,
  FileRef,
  PdfLocation,
  SourceLocation,
  SyncForwardRequest,
  SyncInverseRequest,
  ToolInfo,
} from '../../shared/api';
import { parseDiagnostics } from './diagnostics';

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

const names = ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'bibtex', 'biber', 'synctex'] as const;
const MAX_LOG = 2_000_000;
const MAX_PDF = 64 * 1024 * 1024;

export async function findExecutable(name: string): Promise<string | null> {
  if (!(names as readonly string[]).includes(name)) throw new BuildError('Unsupported tool.');
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const clean = directory.replace(/^"|"$/g, '');
    if (!isAbsolute(clean)) continue;
    const file = join(clean, process.platform === 'win32' ? `${name}.exe` : name);
    try {
      await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      if ((await stat(file)).isFile()) return await realpath(file);
    } catch {
      /* Try the next absolute PATH entry. */
    }
  }
  return null;
}

function probe(executable: string): Promise<string | null> {
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
    }, 4000);
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
  return Promise.all(
    names.map(async (name) => {
      const path = await findExecutable(name);
      return { name, path, version: path ? await probe(path) : null };
    }),
  );
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
  } | null = null;
  private created: string[] = [];
  private stopping: Promise<void> | null = null;
  constructor(
    private readonly getRoot: (id: string) => string,
    private readonly timeoutMs = 120_000,
  ) {}

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
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>((done) => {
        const killer = spawn(
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          { shell: false, windowsHide: true, stdio: 'ignore' },
        );
        const timer = setTimeout(() => {
          killer.kill();
          child.kill();
          done();
        }, 5000);
        killer.on('error', () => {
          clearTimeout(timer);
          child.kill();
          done();
        });
        killer.on('close', () => {
          clearTimeout(timer);
          done();
        });
      });
    } else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
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

  async compile(request: BuildRequest): Promise<BuildState> {
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
      projectId: request.projectId,
      rootFile,
    };
    const timer = setTimeout(() => {
      this.timedOut = true;
      void this.cancel();
    }, this.timeoutMs);
    try {
      await checkedPath(root, rootFile);
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
            [...(miktex ? ['-disable-installer'] : []), basename(rootFile).replace(/\.tex$/i, '')],
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
        };
        this.state.pdfPath = pdfPath;
        this.state.outcome = 'success';
        // Only remove directories created by this service instance, never arbitrary user build folders.
        while (this.created.length > 5) {
          const old = this.created.shift();
          if (old && old !== output && old.startsWith(join(root, 'build', 'textra') + sep))
            await rm(old, { recursive: true, force: true }).catch(() => undefined);
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
    return this.getState();
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
      this.successful.rootFile !== rootFile
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
      ['view', '-i', `${request.line}:1:${source}`, '-o', last.absolute],
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
      ['edit', '-o', `${request.page}:${request.x}:${request.y}:${last.absolute}`],
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
