import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createLocalRuntime } from '../lib/local-runtime.mjs';

export function parseLocalRuntimeArgs(args = process.argv.slice(2)) {
  const options = {
    host: process.env.COPILOT_DEBUGGER_HOST ?? '127.0.0.1',
    port: Number(process.env.COPILOT_DEBUGGER_PORT ?? 4312),
    dataFile: 'tmp/local-runtime/sessions.json',
    seedDataFile: 'public/data/sessions.json',
    staticDir: 'dist/copilot-cost-debugger/browser',
    scanOnStart: true,
    roots: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [flag, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? args[index + 1];

    if (flag === '--no-startup-scan') {
      options.scanOnStart = false;
      continue;
    }
    if (['--host', '--port', '--data', '--seed', '--static', '--root'].includes(flag) && !value) {
      throw new Error(`${flag} requires a value.`);
    }
    if (['--host', '--port', '--data', '--seed', '--static', '--root'].includes(flag) && inlineValue === undefined) {
      index += 1;
    }
    if (flag === '--host') options.host = value;
    else if (flag === '--port') options.port = Number(value);
    else if (flag === '--data') options.dataFile = value;
    else if (flag === '--seed') options.seedDataFile = value;
    else if (flag === '--static') options.staticDir = value;
    else if (flag === '--root') options.roots.push(value);
    else if (flag !== '--no-startup-scan') throw new Error(`Unknown local runtime option: ${argument}`);
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error('--port must be an integer between 0 and 65535.');
  }

  return options;
}

export async function runLocalRuntimeCli(args = process.argv.slice(2)) {
  const options = parseLocalRuntimeArgs(args);
  const runtime = createLocalRuntime({
    host: options.host,
    port: options.port,
    dataFile: resolve(options.dataFile),
    seedDataFile: resolve(options.seedDataFile),
    staticDir: resolve(options.staticDir),
    scanOnStart: options.scanOnStart,
    scanOptions: options.roots.length ? { roots: options.roots } : {},
  });

  await runtime.listen();
  const close = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return runtime;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runLocalRuntimeCli();
}
