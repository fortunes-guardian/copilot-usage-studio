import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function parseWorkspace(workspaceDir, options = {}, onProgress = () => {}, dependencies = {}) {
  const {
    customizationsFromDebugReferences,
    customizationsFromDiscoveryFolders,
    customizationsFromWorkspace,
    customizationEvidenceFromDebugLogs,
    diagnostics,
    enrichSessionFromWorkspaceState,
    listDirs,
    listFiles,
    memoriesFromRoot,
    readWorkspaceState,
    sessionFromChatSnapshot,
    sessionFromDebugLog,
    workspaceName,
  } = dependencies;

  assertWorkspaceDependencies(dependencies);

  const includeCustomizations = options.includeCustomizations !== false;
  const customizationOptions = {
    includeSystemCustomizations: options.includeSystemCustomizations === true,
  };
  diagnostics.scannedWorkspaces += 1;
  const workspace = workspaceName(workspaceDir);
  const workspaceStartedAt = Date.now();
  const workspaceStartedAtIso = new Date(workspaceStartedAt).toISOString();
  const workspaceProgressBase = {
    workspace,
    workspaceDir,
    workspaceIndex: options.workspaceIndex ?? null,
    workspaceTotal: options.workspaceTotal ?? null,
  };
  const workspaceScan = {
    ...workspaceProgressBase,
    startedAt: workspaceStartedAtIso,
    completedAt: '',
    durationMs: 0,
    debugLogFolders: 0,
    chatSnapshots: 0,
    hasMemoryRoot: false,
    customizationInventory: 0,
    importedSessions: 0,
    importedMemories: 0,
    importedCustomizations: 0,
    lastStage: 'starting',
  };
  if (diagnostics.workspaceScans.length < 500) {
    diagnostics.workspaceScans.push(workspaceScan);
  }
  const progress = (stage, message, extra = {}) => {
    workspaceScan.lastStage = stage;
    onProgress({
      stage,
      message,
      ...workspaceProgressBase,
      elapsedMs: Date.now() - workspaceStartedAt,
      ...extra,
    });
  };
  const debugRoot = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs');
  const debugSessionDirs = listDirs(debugRoot);
  const chatSessionFiles = listFiles(join(workspaceDir, 'chatSessions'), '.jsonl');
  const memoryRoot = join(workspaceDir, 'GitHub.copilot-chat', 'memory-tool', 'memories');
  const hasMemoryRoot = existsSync(memoryRoot);
  workspaceScan.debugLogFolders = debugSessionDirs.length;
  workspaceScan.chatSnapshots = chatSessionFiles.length;
  workspaceScan.hasMemoryRoot = hasMemoryRoot;

  if (!debugSessionDirs.length && !chatSessionFiles.length && !hasMemoryRoot) {
    workspaceScan.completedAt = new Date().toISOString();
    workspaceScan.durationMs = Date.now() - workspaceStartedAt;
    workspaceScan.lastStage = 'empty';
    return {
      sessions: [],
      memories: [],
      customizations: [],
    };
  }

  progress('workspace', `Checking VS Code storage entry for ${workspace}.`, {
    debugLogFolders: debugSessionDirs.length,
    chatSnapshots: chatSessionFiles.length,
    hasMemoryRoot,
  });
  progress('workspace-state', `Reading workspace metadata for ${workspace}.`);
  const stateBySessionId =
    debugSessionDirs.length || chatSessionFiles.length ? readWorkspaceState(workspaceDir) : new Map();
  let customizations = [];
  if (includeCustomizations) {
    progress('customizations', `Indexing customizations for ${workspace}.`);
    const customizationWorkspace = customizationsFromWorkspace(workspaceDir, customizationOptions);
    const customizationMap = new Map();
    for (const customization of [
      ...customizationWorkspace.customizations,
      ...customizationsFromDiscoveryFolders(debugRoot, workspace, customizationOptions),
      ...customizationsFromDebugReferences(debugRoot, customizationWorkspace.bases, workspace, customizationOptions),
    ]) {
      customizationMap.set(customization.id, customization);
    }
    const customizationInventory = [...customizationMap.values()];
    workspaceScan.customizationInventory = customizationInventory.length;
    progress(
      'customization-evidence',
      debugSessionDirs.length
        ? `Checking customization evidence in ${debugSessionDirs.length} debug-log folder${debugSessionDirs.length === 1 ? '' : 's'} for ${workspace}.`
        : `No debug-log evidence available for ${workspace}; customizations are inventory-only.`,
      {
        total: debugSessionDirs.length,
        customizationInventory: customizationInventory.length,
      },
    );
    customizations = customizationEvidenceFromDebugLogs(
      debugRoot,
      customizationInventory,
      workspace,
      workspaceDir,
      onProgress,
    );
    workspaceScan.importedCustomizations = customizations.length;
    diagnostics.importedCustomizations += customizations.length;
  }

  if (debugSessionDirs.length) {
    progress('debug-logs', `Scanning ${debugSessionDirs.length} debug-log folder${debugSessionDirs.length === 1 ? '' : 's'} in ${workspace}.`, {
      total: debugSessionDirs.length,
    });
  }
  const debugSessions = [];
  for (const [index, sessionDir] of debugSessionDirs.entries()) {
    if (index > 0 && index % 25 === 0) {
      progress('debug-logs', `Scanned ${index}/${debugSessionDirs.length} debug-log folders in ${workspace}.`, {
        index,
        total: debugSessionDirs.length,
      });
    }
    const session = sessionFromDebugLog(sessionDir, workspaceDir);
    if (session) {
      debugSessions.push(enrichSessionFromWorkspaceState(session, stateBySessionId));
    }
  }
  const debugIds = new Set(debugSessions.map((session) => session.id));
  diagnostics.importedDebugLogSessions += debugSessions.length;

  if (chatSessionFiles.length) {
    progress('chat-snapshots', `Scanning ${chatSessionFiles.length} chat snapshot${chatSessionFiles.length === 1 ? '' : 's'} in ${workspace}.`, {
      total: chatSessionFiles.length,
    });
  }
  const chatSessions = [];
  for (const file of chatSessionFiles) {
    const session = sessionFromChatSnapshot(file, workspaceDir);
    if (session && debugIds.has(session.id)) {
      diagnostics.skippedDuplicateChatSnapshots += 1;
      continue;
    }
    if (session) {
      chatSessions.push(enrichSessionFromWorkspaceState(session, stateBySessionId));
    }
  }
  diagnostics.importedChatSnapshotSessions += chatSessions.length;
  const memories = memoriesFromRoot(memoryRoot, 'workspace', workspace);
  workspaceScan.importedSessions = debugSessions.length + chatSessions.length;
  workspaceScan.importedMemories = memories.length;
  workspaceScan.completedAt = new Date().toISOString();
  workspaceScan.durationMs = Date.now() - workspaceStartedAt;

  progress('workspace-complete', `VS Code storage entry for ${workspace}: imported ${debugSessions.length + chatSessions.length} session${debugSessions.length + chatSessions.length === 1 ? '' : 's'} in ${workspaceScan.durationMs}ms.`, {
    sessions: debugSessions.length + chatSessions.length,
    memories: memories.length,
    customizations: customizations.length,
    durationMs: workspaceScan.durationMs,
  });

  return {
    sessions: [...debugSessions, ...chatSessions],
    memories,
    customizations,
  };
}

function assertWorkspaceDependencies(dependencies) {
  for (const name of [
    'customizationsFromDebugReferences',
    'customizationsFromDiscoveryFolders',
    'customizationsFromWorkspace',
    'customizationEvidenceFromDebugLogs',
    'diagnostics',
    'enrichSessionFromWorkspaceState',
    'listDirs',
    'listFiles',
    'memoriesFromRoot',
    'readWorkspaceState',
    'sessionFromChatSnapshot',
    'sessionFromDebugLog',
    'workspaceName',
  ]) {
    if (!dependencies[name]) {
      throw new TypeError(`parseWorkspace missing dependency: ${name}`);
    }
  }
}
