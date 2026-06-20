import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalRuntime } from './local-runtime.mjs';
import { scanVsCodeSessions, writeSessionData } from './scanner-api.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

export function defaultAppDataDir(environment = process.env, os = platform(), home = homedir()) {
  if (os === 'win32') {
    return win32.join(
      environment.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'),
      'Copilot Usage Studio',
    );
  }
  if (os === 'darwin') {
    return posix.join(home, 'Library', 'Application Support', 'Copilot Usage Studio');
  }
  return posix.join(
    environment.XDG_DATA_HOME ?? posix.join(home, '.local', 'share'),
    'copilot-usage-studio',
  );
}

export function parseCliArgs(args = process.argv.slice(2)) {
  const command = args[0] && !args[0].startsWith('-') ? args[0] : 'serve';
  const commandArgs = command === 'serve' && command !== args[0] ? args : args.slice(1);
  const options = {
    command,
    host: process.env.COPILOT_USAGE_STUDIO_HOST ?? '127.0.0.1',
    port: Number(process.env.COPILOT_USAGE_STUDIO_PORT ?? 4312),
    output: '',
    roots: [],
    scanOnStart: true,
  };

  if (command === 'help' || command === 'version') {
    return options;
  }
  if (!['serve', 'scan', 'status'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  for (let index = 0; index < commandArgs.length; index += 1) {
    const argument = commandArgs[index];
    if (argument === '--help' || argument === '-h') {
      options.command = 'help';
      continue;
    }
    if (argument === '--version' || argument === '-v') {
      options.command = 'version';
      continue;
    }
    if (argument === '--no-startup-scan') {
      options.scanOnStart = false;
      continue;
    }

    const [flag, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? commandArgs[index + 1];
    if (['--host', '--port', '--output', '--root'].includes(flag) && !value) {
      throw new Error(`${flag} requires a value.`);
    }
    if (['--host', '--port', '--output', '--root'].includes(flag) && inlineValue === undefined) {
      index += 1;
    }

    if (flag === '--host') options.host = value;
    else if (flag === '--port') options.port = Number(value);
    else if (flag === '--output') options.output = value;
    else if (flag === '--root') options.roots.push(value);
    else if (!['--no-startup-scan', '--help', '-h', '--version', '-v'].includes(flag)) {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error('--port must be an integer between 0 and 65535.');
  }
  return options;
}

export async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const options = parseCliArgs(args);
  const logger = dependencies.logger ?? console;
  const appDataDir = dependencies.appDataDir ?? defaultAppDataDir();

  if (options.command === 'help') {
    logger.log(helpText());
    return null;
  }
  if (options.command === 'version') {
    logger.log(packageJson.version);
    return null;
  }
  if (options.command === 'status') {
    const fetchStatus = dependencies.fetch ?? globalThis.fetch;
    const timeoutMs = Number(dependencies.statusTimeoutMs ?? 5000);
    const signal = Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortSignal !== 'undefined'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    let response;
    try {
      response = await fetchStatus(`http://${options.host}:${options.port}/api/status`, { signal });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new Error(
        timedOut
          ? `Local runtime did not respond on ${options.host}:${options.port} within ${timeoutMs}ms.`
          : `Could not reach local runtime on ${options.host}:${options.port}.`,
      );
    }
    if (!response.ok) {
      throw new Error(`Local runtime returned ${response.status}.`);
    }
    const status = await response.json();
    logger.log(JSON.stringify(status, null, 2));
    return status;
  }

  const scanOptions = options.roots.length ? { roots: options.roots } : {};
  if (options.command === 'scan') {
    const scanner = dependencies.scanner ?? scanVsCodeSessions;
    const writer = dependencies.writer ?? writeSessionData;
    const sessionData = await scanner(scanOptions);
    const outputFile = resolve(options.output || join(appDataDir, 'sessions.json'));
    writer(sessionData, outputFile);
    logger.log(`Imported ${sessionData.sessions.length} sessions to ${outputFile}`);
    return sessionData;
  }

  const staticDir = dependencies.staticDir ?? join(packageRoot, 'dist', 'copilot-usage-studio', 'browser');
  const hasStaticAssets = dependencies.hasStaticAssets ?? existsSync;
  if (!hasStaticAssets(join(staticDir, 'index.html'))) {
    throw new Error('Packaged UI assets are missing. Run npm run build before serving from this checkout.');
  }

  const runtimeFactory = dependencies.runtimeFactory ?? createLocalRuntime;
  const runtime = runtimeFactory({
    host: options.host,
    port: options.port,
    dataFile: join(appDataDir, 'sessions.json'),
    seedDataFile: null,
    staticDir,
    scanOnStart: options.scanOnStart,
    scanOptions,
    logger,
  });
  await runtime.listen();
  installShutdownHandlers(runtime, dependencies.processObject ?? process);
  return runtime;
}

export function helpText() {
  return `Copilot Usage Studio ${packageJson.version}

Usage:
  copilot-usage-studio [serve] [options]
  copilot-usage-studio scan [options]
  copilot-usage-studio status [options]

Commands:
  serve    Scan local VS Code data and serve the local UI (default)
  scan     Scan and write the normalized session-data JSON
  status   Read status from a running local runtime

Options:
  --host <host>       Bind host (default: 127.0.0.1)
  --port <port>       Runtime port (default: 4312)
  --root <path>       Custom VS Code User or workspace-storage path; repeatable
  --output <file>     Output file for the scan command
  --no-startup-scan   Serve the last local cache without scanning on startup
  -h, --help          Show help
  -v, --version       Show version`;
}

function installShutdownHandlers(runtime, processObject) {
  const close = async () => {
    await runtime.close();
    processObject.exit(0);
  };
  processObject.once('SIGINT', close);
  processObject.once('SIGTERM', close);
}
