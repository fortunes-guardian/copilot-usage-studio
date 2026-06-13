import { spawn } from 'node:child_process';

const runtimePort = process.env.COPILOT_USAGE_STUDIO_PORT ?? '4312';
const forwardedArgs = process.argv.slice(2);
if (forwardedArgs.some((argument) => !/^[\w./:=\\-]+$/.test(argument))) {
  throw new Error('Angular dev-server arguments contain unsupported shell characters.');
}
const runtime = spawn(process.execPath, ['scripts/local-runtime.mjs', '--port', runtimePort], {
  stdio: 'inherit',
});
const angular = process.platform === 'win32'
  ? spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', ['npm run start:angular --', ...forwardedArgs].join(' ')],
      { stdio: 'inherit' },
    )
  : spawn('npm', ['run', 'start:angular', '--', ...forwardedArgs], { stdio: 'inherit' });

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  runtime.kill();
  angular.kill();
  process.exitCode = exitCode;
}

runtime.once('exit', (code) => stop(code ?? 1));
angular.once('exit', (code) => stop(code ?? 0));
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
