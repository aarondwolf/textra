import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectError } from './projects';

export async function findCodeExecutable(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA)
      candidates.push(join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe'));
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (base) candidates.push(join(base, 'Microsoft VS Code/Code.exe'));
    }
  } else if (process.platform === 'darwin')
    candidates.push('/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
  else candidates.push('/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code');
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      /* Optional application. */
    }
  }
  return null;
}

export async function openInExternalEditor(target: string): Promise<void> {
  const executable = await findCodeExecutable();
  if (!executable)
    throw new ProjectError(
      'TOOL_NOT_FOUND',
      'Visual Studio Code was not found in a standard installation location.',
    );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--reuse-window', target], {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () =>
      reject(new ProjectError('TOOL_FAILED', 'Visual Studio Code could not be started.')),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
