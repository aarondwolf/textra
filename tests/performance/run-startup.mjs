import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const options = process.argv.slice(2);
if (options.some((option) => option !== '--unsynced-profile'))
  throw new Error('Supported startup benchmark option: --unsynced-profile');
const profileLocation = options.includes('--unsynced-profile') ? 'os-temp' : 'workspace';

const command = fileURLToPath(
  new URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
);
const child = spawn(
  process.execPath,
  [command, 'test', 'tests/e2e/startup.spec.ts', '--grep', 'startup benchmark'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TEXTRA_STARTUP_BENCHMARK: '1',
      TEXTRA_STARTUP_PROFILE_LOCATION: profileLocation,
    },
  },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
