import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { parseWorkspace } from './scanner-workspace.mjs';

test('workspace scanner records empty VS Code storage entries without importing data', () => {
  const root = mkdtempSync(join(tmpdir(), 'cus-workspace-'));
  try {
    const workspaceDir = join(root, 'workspace-a');
    mkdirSync(workspaceDir, { recursive: true });
    const diagnostics = diagnosticsFixture();

    const result = parseWorkspace(workspaceDir, {}, () => {}, dependenciesFixture({ diagnostics }));

    assert.deepEqual(result, { sessions: [], memories: [], customizations: [] });
    assert.equal(diagnostics.scannedWorkspaces, 1);
    assert.equal(diagnostics.workspaceScans.length, 1);
    assert.equal(diagnostics.workspaceScans[0].lastStage, 'empty');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace scanner imports debug logs before chat snapshots and skips duplicate chat ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'cus-workspace-'));
  try {
    const workspaceDir = join(root, 'workspace-b');
    const memoryRoot = join(workspaceDir, 'GitHub.copilot-chat', 'memory-tool', 'memories');
    mkdirSync(memoryRoot, { recursive: true });
    const diagnostics = diagnosticsFixture();
    const progress = [];
    const deps = dependenciesFixture({
      diagnostics,
      debugSessionDirs: ['session-a', 'session-b'].map((id) =>
        join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', id),
      ),
      chatSessionFiles: ['session-a.jsonl', 'session-c.jsonl'].map((id) =>
        join(workspaceDir, 'chatSessions', id),
      ),
      memoryRecords: [{ id: 'memory-1' }],
    });

    const result = parseWorkspace(
      workspaceDir,
      { includeCustomizations: false, workspaceIndex: 2, workspaceTotal: 10 },
      (event) => progress.push(event),
      deps,
    );

    assert.deepEqual(result.sessions.map((session) => session.id), ['session-a', 'session-b', 'session-c']);
    assert.deepEqual(result.memories, [{ id: 'memory-1' }]);
    assert.equal(diagnostics.importedDebugLogSessions, 2);
    assert.equal(diagnostics.importedChatSnapshotSessions, 1);
    assert.equal(diagnostics.skippedDuplicateChatSnapshots, 1);
    assert.equal(diagnostics.workspaceScans[0].debugLogFolders, 2);
    assert.equal(diagnostics.workspaceScans[0].chatSnapshots, 2);
    assert.equal(diagnostics.workspaceScans[0].importedSessions, 3);
    assert.equal(progress.at(0).stage, 'workspace');
    assert.equal(progress.at(0).workspaceIndex, 2);
    assert.equal(progress.at(-1).stage, 'workspace-complete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function diagnosticsFixture() {
  return {
    scannedWorkspaces: 0,
    importedCustomizations: 0,
    importedDebugLogSessions: 0,
    importedChatSnapshotSessions: 0,
    skippedDuplicateChatSnapshots: 0,
    workspaceScans: [],
  };
}

function dependenciesFixture({
  diagnostics = diagnosticsFixture(),
  debugSessionDirs = [],
  chatSessionFiles = [],
  memoryRecords = [],
} = {}) {
  return {
    customizationsFromDebugReferences: () => [],
    customizationsFromDiscoveryFolders: () => [],
    customizationsFromWorkspace: () => ({ bases: [], customizations: [] }),
    customizationEvidenceFromDebugLogs: () => [],
    diagnostics,
    enrichSessionFromWorkspaceState: (session) => ({ ...session, enriched: true }),
    listDirs: (dir) => (dir.includes('debug-logs') ? debugSessionDirs : []),
    listFiles: (dir) => (dir.includes('chatSessions') ? chatSessionFiles : []),
    memoriesFromRoot: () => memoryRecords,
    readWorkspaceState: () => new Map(),
    sessionFromChatSnapshot: (file) => ({ id: basename(file, '.jsonl'), source: 'chat' }),
    sessionFromDebugLog: (dir) => ({ id: basename(dir), source: 'debug' }),
    workspaceName: (workspaceDir) => basename(workspaceDir),
  };
}
