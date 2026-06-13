import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { defaultAppDataDir, helpText, parseCliArgs, runCli } from '../lib/cli.mjs';

test('uses OS-native user data directories', () => {
  assert.equal(
    defaultAppDataDir({ LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' }, 'win32', 'C:\\Users\\dev'),
    'C:\\Users\\dev\\AppData\\Local\\Copilot Usage Studio',
  );
  assert.equal(
    defaultAppDataDir({}, 'darwin', '/Users/dev'),
    '/Users/dev/Library/Application Support/Copilot Usage Studio',
  );
  assert.equal(
    defaultAppDataDir({ XDG_DATA_HOME: '/home/dev/.data' }, 'linux', '/home/dev'),
    '/home/dev/.data/copilot-usage-studio',
  );
});

test('parses default serve and explicit scan options', () => {
  assert.deepEqual(parseCliArgs([]), {
    command: 'serve',
    host: '127.0.0.1',
    port: 4312,
    output: '',
    roots: [],
    scanOnStart: true,
  });
  assert.deepEqual(parseCliArgs(['scan', '--root', 'one', '--root=two', '--output', 'result.json']), {
    command: 'scan',
    host: '127.0.0.1',
    port: 4312,
    output: 'result.json',
    roots: ['one', 'two'],
    scanOnStart: true,
  });
  assert.equal(parseCliArgs(['--help']).command, 'help');
  assert.throws(() => parseCliArgs(['serve', '--port', 'invalid']), /--port must be an integer/);
});

test('scan command writes to the user-owned cache by default', async () => {
  const writes = [];
  const logs = [];
  const sessionData = { sessions: [{ id: 'one' }] };

  const result = await runCli(['scan'], {
    appDataDir: 'C:\\local\\app-data',
    scanner: async () => sessionData,
    writer: (data, output) => writes.push({ data, output }),
    logger: { log: (message) => logs.push(message) },
  });

  assert.equal(result, sessionData);
  assert.deepEqual(writes, [{ data: sessionData, output: join('C:\\local\\app-data', 'sessions.json') }]);
  assert.match(logs[0], /Imported 1 sessions/);
});

test('serve command gives the runtime packaged assets and user-owned data', async () => {
  const listeners = new Map();
  let runtimeOptions;
  const runtime = {
    async listen() {},
    async close() {},
  };

  const result = await runCli(['serve', '--root', '/custom/root', '--no-startup-scan'], {
    appDataDir: '/local/app-data',
    staticDir: process.cwd(),
    hasStaticAssets: () => true,
    runtimeFactory: (options) => {
      runtimeOptions = options;
      return runtime;
    },
    processObject: {
      once: (event, listener) => listeners.set(event, listener),
      exit() {},
    },
    logger: { log() {}, error() {} },
  });

  assert.equal(result, runtime);
  assert.equal(runtimeOptions.dataFile, join('/local/app-data', 'sessions.json'));
  assert.equal(runtimeOptions.seedDataFile, null);
  assert.equal(runtimeOptions.scanOnStart, false);
  assert.deepEqual(runtimeOptions.scanOptions, { roots: ['/custom/root'] });
  assert.equal(listeners.has('SIGINT'), true);
  assert.equal(listeners.has('SIGTERM'), true);
});

test('status, help, and version remain terminal-friendly', async () => {
  const logs = [];
  const status = await runCli(['status', '--port', '4999'], {
    fetch: async (url) => ({ ok: true, json: async () => ({ phase: 'ready', url }) }),
    logger: { log: (message) => logs.push(message) },
  });

  assert.equal(status.phase, 'ready');
  assert.match(status.url, /:4999\/api\/status$/);
  assert.match(helpText(), /npx|copilot-usage-studio|Usage:/);
});
