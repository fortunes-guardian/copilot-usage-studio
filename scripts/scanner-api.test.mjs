import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanVsCodeSessions, writeSessionData } from '../lib/scanner-api.mjs';
import { runScannerCli } from './scan-vscode-sessions.mjs';

test('returns normalized session data without writing an output file', async () => {
  const fixture = createWorkspaceFixture('in-memory');
  try {
    writeDebugSession(fixture.workspaceDir, 'session-1', 12_000, 8_000, 500);

    const result = await scanVsCodeSessions({
      roots: [fixture.workspaceDir],
      sqlite: false,
      generatedAt: '2026-06-13T08:00:00.000Z',
    });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.generatedAt, '2026-06-13T08:00:00.000Z');
    assert.equal(result.ingestion.importedSessions, 1);
    assert.equal(result.ingestion.importedDebugLogSessions, 1);
    assert.equal(result.sessions.length, 1);
    assert.deepEqual(result.sessions[0].tokens, {
      input: 4_000,
      cachedInput: 8_000,
      cacheWrite: 0,
      output: 500,
    });
    assert.equal(existsSync(join(fixture.root, 'sessions.json')), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('indexes workspace memories and links session plans without inferring recall', async () => {
  const fixture = createWorkspaceFixture('memories');
  const sessionId = 'adfd2a29-d246-4b89-88da-1c1b5622ae1b';
  const encodedSessionId = Buffer.from(sessionId, 'utf8').toString('base64').replace(/=+$/, '');
  try {
    writeDebugSession(fixture.workspaceDir, sessionId, 1_000, 750, 50);
    const memoryRoot = join(
      fixture.workspaceDir,
      'GitHub.copilot-chat',
      'memory-tool',
      'memories',
    );
    mkdirSync(join(memoryRoot, encodedSessionId), { recursive: true });
    mkdirSync(join(memoryRoot, 'repo'), { recursive: true });
    writeFileSync(
      join(memoryRoot, encodedSessionId, 'plan.md'),
      '# Plan: Small feature\n\nKeep the first version read-only.',
      'utf8',
    );
    writeFileSync(
      join(memoryRoot, 'repo', 'architecture.md'),
      '# Architecture notes\n\nThe scanner owns normalized local evidence.',
      'utf8',
    );

    const result = await scanVsCodeSessions({ roots: [fixture.workspaceDir], sqlite: false });

    assert.equal(result.memories.length, 2);
    assert.equal(result.ingestion.importedMemories, 2);
    assert.equal(result.ingestion.importedPlans, 1);
    const plan = result.memories.find((memory) => memory.kind === 'plan');
    const repositoryMemory = result.memories.find((memory) => memory.scope === 'repository');
    assert.equal(plan.scope, 'session');
    assert.equal(plan.sessionId, sessionId);
    assert.match(plan.content, /read-only/);
    assert.equal(repositoryMemory.kind, 'memory');
    assert.equal(repositoryMemory.sessionId, '');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('keeps diagnostics isolated between API scans', async () => {
  const populated = createWorkspaceFixture('populated');
  const empty = createWorkspaceFixture('empty');
  try {
    writeDebugSession(populated.workspaceDir, 'session-1', 1_000, 250, 50);

    const first = await scanVsCodeSessions({ roots: [populated.workspaceDir], sqlite: false });
    const second = await scanVsCodeSessions({ roots: [empty.workspaceDir], sqlite: false });

    assert.equal(first.ingestion.importedSessions, 1);
    assert.equal(second.ingestion.importedSessions, 0);
    assert.equal(second.ingestion.importedDebugLogSessions, 0);
    assert.equal(second.ingestion.skippedEmptyDebugLogs, 0);
    assert.deepEqual(second.ingestion.scannedRoots, [empty.workspaceDir]);
  } finally {
    rmSync(populated.root, { recursive: true, force: true });
    rmSync(empty.root, { recursive: true, force: true });
  }
});

test('reports scanner progress for large local-runtime imports', async () => {
  const fixture = createWorkspaceFixture('progress');
  try {
    writeDebugSession(fixture.workspaceDir, 'session-1', 1_000, 250, 50);
    const events = [];

    await scanVsCodeSessions({
      roots: [fixture.workspaceDir],
      sqlite: false,
      onProgress: (event) => events.push(event),
    });

    assert.ok(events.some((event) => event.stage === 'roots'));
    assert.ok(events.some((event) => event.stage === 'workspace'));
    assert.ok(events.some((event) => event.stage === 'debug-logs'));
    assert.ok(events.some((event) => event.stage === 'complete'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('writes an API result only when the host explicitly requests persistence', async () => {
  const fixture = createWorkspaceFixture('writer');
  try {
    writeDebugSession(fixture.workspaceDir, 'session-1', 2_000, 1_500, 100);
    const result = await scanVsCodeSessions({ roots: [fixture.workspaceDir], sqlite: false });
    const outputFile = join(fixture.root, 'nested', 'sessions.json');

    const writtenPath = writeSessionData(result, outputFile);
    const persisted = JSON.parse(readFileSync(writtenPath, 'utf8'));

    assert.equal(writtenPath, outputFile);
    assert.equal(persisted.generatedAt, result.generatedAt);
    assert.equal(persisted.sessions[0].id, 'session-1');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('keeps the existing positional CLI contract as a thin API host', async () => {
  const fixture = createWorkspaceFixture('cli');
  try {
    writeDebugSession(fixture.workspaceDir, 'session-1', 2_000, 1_500, 100);
    const outputFile = join(fixture.root, 'cli-sessions.json');
    const messages = [];

    const result = await runScannerCli(
      [outputFile, fixture.workspaceDir],
      { log: (message) => messages.push(message) },
    );

    assert.equal(result.sessions.length, 1);
    assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).sessions.length, 1);
    assert.match(messages[0], /Wrote 1 sessions/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects invalid host options with a clear contract error', async () => {
  await assert.rejects(
    scanVsCodeSessions({ roots: 'not-an-array' }),
    /roots must be an array/,
  );
  await assert.rejects(
    scanVsCodeSessions({ roots: [], usdToEur: 0 }),
    /usdToEur must be a positive number/,
  );
});

function createWorkspaceFixture(name) {
  const root = mkdirTemp(`copilot-usage-studio-api-${name}-`);
  const workspaceDir = join(root, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(
    join(workspaceDir, 'workspace.json'),
    JSON.stringify({ folder: 'file:///tmp/scanner-api-workspace' }),
    'utf8',
  );
  return { root, workspaceDir };
}

function mkdirTemp(prefix) {
  const path = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function writeDebugSession(workspaceDir, sessionId, inputTokens, cachedTokens, outputTokens) {
  const sessionDir = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const records = [
    {
      ts: 1,
      timestamp: '2026-06-13T07:59:00.000Z',
      sid: sessionId,
      type: 'user_message',
      name: 'user message',
      status: 'ok',
      attrs: { content: 'Inspect this workspace.' },
    },
    {
      ts: 2,
      timestamp: '2026-06-13T08:00:00.000Z',
      sid: sessionId,
      type: 'llm_request',
      name: 'panel/editAgent',
      status: 'ok',
      attrs: {
        model: 'gpt-5.4',
        inputTokens,
        cachedTokens,
        outputTokens,
      },
    },
  ];
  writeFileSync(
    join(sessionDir, 'main.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n'),
    'utf8',
  );
}
