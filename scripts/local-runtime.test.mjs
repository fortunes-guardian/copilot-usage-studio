import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalRuntime } from '../lib/local-runtime.mjs';
import { parseLocalRuntimeArgs } from './local-runtime.mjs';

test('serves cached data, refreshes through the scanner, and reports status', async () => {
  const fixture = runtimeFixture('refresh');
  const cached = sessionData('cached-session', '2026-06-13T08:00:00.000Z');
  const refreshed = sessionData('new-session', '2026-06-13T09:00:00.000Z');
  writeFileSync(fixture.dataFile, JSON.stringify(cached), 'utf8');
  let scans = 0;
  const runtime = createLocalRuntime({
    port: 0,
    dataFile: fixture.dataFile,
    seedDataFile: null,
    staticDir: fixture.staticDir,
    scanOnStart: false,
    scanner: async () => {
      scans += 1;
      return refreshed;
    },
    logger: silentLogger(),
  });

  try {
    const address = await runtime.listen();
    const origin = `http://127.0.0.1:${address.port}`;

    const initialStatus = await jsonRequest(`${origin}/api/status`);
    assert.equal(initialStatus.phase, 'ready');
    assert.equal(initialStatus.sessionCount, 1);
    assert.equal((await jsonRequest(`${origin}/api/sessions`)).sessions[0].id, 'cached-session');
    assert.equal((await jsonRequest(`${origin}/data/sessions.json`)).sessions[0].id, 'cached-session');

    const refreshResponse = await jsonRequest(`${origin}/api/scan`, { method: 'POST' });
    assert.equal(scans, 1);
    assert.equal(refreshResponse.sessionData.sessions[0].id, 'new-session');
    assert.equal(refreshResponse.status.phase, 'ready');
    assert.equal((await jsonRequest(`${origin}/api/sessions`)).sessions[0].id, 'new-session');
    assert.equal(JSON.parse(readFileSync(fixture.dataFile, 'utf8')).sessions[0].id, 'new-session');
  } finally {
    await runtime.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('keeps the last valid snapshot when a refresh fails', async () => {
  const fixture = runtimeFixture('failure');
  const cached = sessionData('safe-session', '2026-06-13T08:00:00.000Z');
  writeFileSync(fixture.dataFile, JSON.stringify(cached), 'utf8');
  const runtime = createLocalRuntime({
    port: 0,
    dataFile: fixture.dataFile,
    seedDataFile: null,
    staticDir: fixture.staticDir,
    scanOnStart: false,
    scanner: async () => {
      throw new Error('fixture scan failed');
    },
    logger: silentLogger(),
  });

  try {
    const address = await runtime.listen();
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}/api/scan`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.status.hasData, true);
    assert.equal(body.status.lastError, 'fixture scan failed');
    assert.equal((await jsonRequest(`${origin}/api/sessions`)).sessions[0].id, 'safe-session');
  } finally {
    await runtime.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('holds a fresh-install data request until the startup scan completes', async () => {
  const fixture = runtimeFixture('first-run');
  let finishScan;
  const runtime = createLocalRuntime({
    port: 0,
    dataFile: fixture.dataFile,
    seedDataFile: null,
    staticDir: fixture.staticDir,
    scanner: () => new Promise((resolveScan) => {
      finishScan = resolveScan;
    }),
    logger: silentLogger(),
  });

  try {
    const address = await runtime.listen();
    const origin = `http://127.0.0.1:${address.port}`;
    const pendingData = fetch(`${origin}/data/sessions.json`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    finishScan(sessionData('first-session', '2026-06-13T10:00:00.000Z'));

    const response = await pendingData;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sessions[0].id, 'first-session');
  } finally {
    await runtime.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('serves the production UI and falls back to index for application routes', async () => {
  const fixture = runtimeFixture('static');
  const runtime = createLocalRuntime({
    port: 0,
    dataFile: fixture.dataFile,
    seedDataFile: null,
    staticDir: fixture.staticDir,
    scanOnStart: false,
    logger: silentLogger(),
  });

  try {
    const address = await runtime.listen();
    const origin = `http://127.0.0.1:${address.port}`;
    assert.equal(await (await fetch(`${origin}/`)).text(), '<main>runtime fixture</main>');
    assert.equal(await (await fetch(`${origin}/sessions`)).text(), '<main>runtime fixture</main>');
  } finally {
    await runtime.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('parses local runtime host options', () => {
  const options = parseLocalRuntimeArgs([
    '--host=0.0.0.0',
    '--port',
    '4400',
    '--root',
    'first-root',
    '--root=second-root',
    '--no-startup-scan',
  ]);

  assert.equal(options.host, '0.0.0.0');
  assert.equal(options.port, 4400);
  assert.deepEqual(options.roots, ['first-root', 'second-root']);
  assert.equal(options.scanOnStart, false);
  assert.throws(() => parseLocalRuntimeArgs(['--root']), /--root requires a value/);
});

function runtimeFixture(name) {
  const root = mkdtempSync(join(tmpdir(), `copilot-usage-studio-runtime-${name}-`));
  const staticDir = join(root, 'static');
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<main>runtime fixture</main>', 'utf8');
  return { root, staticDir, dataFile: join(root, 'sessions.json') };
}

function sessionData(id, generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    pricingVersion: 'fixture-pricing',
    pricingSourceUrl: 'https://example.test/pricing',
    usdToEur: 1,
    ingestion: { importedSessions: 1 },
    sessions: [{ id }],
  };
}

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  assert.equal(response.ok, true, `${response.status} ${response.statusText}`);
  return response.json();
}
