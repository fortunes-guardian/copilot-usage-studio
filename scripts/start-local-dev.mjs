import { spawn } from 'node:child_process';

const runtimePort = process.env.COPILOT_USAGE_STUDIO_PORT ?? '4312';
const forwardedArgs = process.argv.slice(2);
if (forwardedArgs.some((argument) => !/^[\w./:=\\-]+$/.test(argument))) {
  throw new Error('Angular dev-server arguments contain unsupported shell characters.');
}
const runtime = spawn(process.execPath, ['scripts/local-runtime.mjs', '--port', runtimePort, '--backend-only'], {
  stdio: 'inherit',
});
console.log('Starting Copilot Usage Studio in local development mode...');
console.log(`Backend API: http://127.0.0.1:${runtimePort}/ (internal data service, not the app)`);
console.log('Open the Angular app URL after it finishes building, usually http://localhost:4200/.');

const angular = process.platform === 'win32'
  ? spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', ['npm run start:angular --', ...forwardedArgs].join(' ')],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
  : spawn('npm', ['run', 'start:angular', '--', ...forwardedArgs], { stdio: ['ignore', 'pipe', 'pipe'] });

let angularOutput = '';
let announcedAppUrl = false;
function handleAngularOutput(chunk, stream) {
  const text = chunk.toString();
  stream.write(text);
  if (announcedAppUrl) return;
  angularOutput = stripAnsi(`${angularOutput}${text}`).slice(-4000);
  const match = angularOutput.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+\//);
  if (match) {
    announcedAppUrl = true;
    console.log(`\nApp ready: ${match[0]}`);
  }
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

angular.stdout.on('data', (chunk) => handleAngularOutput(chunk, process.stdout));
angular.stderr.on('data', (chunk) => handleAngularOutput(chunk, process.stderr));

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
