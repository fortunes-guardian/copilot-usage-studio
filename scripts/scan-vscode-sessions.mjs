import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  normalizeModel,
} from './pricing-utils.mjs';
import {
  attachMemoryRecalls as attachMemoryRecallsCore,
  createMemoryScanner,
} from './scanner-memory.mjs';
import {
  customizationEvidenceFromDebugLogs as customizationEvidenceFromDebugLogsCore,
  mergeCustomizationRecords,
  statusRank,
} from './scanner-customization-evidence.mjs';
import { createCustomizationInventoryScanner } from './scanner-customization-inventory.mjs';
import { createSessionParser } from './scanner-session-parser.mjs';
import {
  defaultCodeUserDirs,
  listDebugLogFiles as traverseDebugLogFiles,
  listDirs as traverseDirs,
  listFiles as traverseFiles,
  listFilesRecursive as traverseFilesRecursive,
  uniqueResolvedRoots,
  userDirForRoot,
  workspaceDirsForRoot,
} from './scanner-traversal.mjs';
import { parseWorkspace as parseWorkspaceEntry } from './scanner-workspace.mjs';

export { defaultCodeUserDirs } from './scanner-traversal.mjs';

const sessionDataSchemaVersion = 1;
const pricingData = JSON.parse(
  readFileSync(new URL('../data/github-copilot-pricing.json', import.meta.url), 'utf8'),
);
const pricingVersion = pricingData.version;
const pricingSourceUrl = pricingData.sourceUrl;
const fallbackPricingModel = pricingData.fallbackModel;
const traceEventLimit = 1000;
const memoryFileLimit = 5000;
const memoryFileSizeLimit = 1024 * 1024;

const pricing = pricingData.models;

let usdToEur = 1;
let diagnostics = createDiagnostics();
let DatabaseSync = null;
let scanInProgress = false;

function createDiagnostics() {
  return {
    scannedRoots: [],
    scannedWorkspaces: 0,
    scannedStateDbs: 0,
    enrichedFromStateDbs: 0,
    importedDebugLogSessions: 0,
    importedChatSnapshotSessions: 0,
    debugLogSessionsWithTranscripts: 0,
    transcriptEventsAvailable: 0,
    scannedMemoryRoots: 0,
    importedMemories: 0,
    importedPlans: 0,
    scannedCustomizationRoots: 0,
    scannedCustomizationLocations: [],
    customizationEvidenceScannedSessions: 0,
    customizationEvidenceModelCalls: 0,
    customizationEvidenceTextParts: 0,
    customizationEvidenceMatchedCustomizations: 0,
    importedCustomizations: 0,
    workspaceScans: [],
    skippedSystemCustomizations: 0,
    skippedOversizedMemories: 0,
    skippedUnreadableMemories: 0,
    skippedOversizedCustomizations: 0,
    skippedUnreadableCustomizations: 0,
    skippedEmptyDebugLogs: 0,
    skippedChatSnapshotsWithoutRequests: 0,
    skippedDuplicateChatSnapshots: 0,
    warnings: [],
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadSqliteSupport() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    if (String(warning).includes('SQLite is an experimental feature')) {
      return;
    }
    originalEmitWarning.call(process, warning, ...args);
  };

  try {
    const sqlite = await import('node:sqlite');
    return sqlite.DatabaseSync;
  } catch (error) {
    diagnostics.warnings.push(`SQLite enrichment unavailable: ${error.code ?? error.message}`);
    return null;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function readStateValue(db, key) {
  const row = db.prepare('select value from ItemTable where key = ?').get(key);
  if (!row?.value) {
    return null;
  }

  return safeJson(Buffer.from(row.value).toString('utf8'));
}

function sessionIdFromResource(resource) {
  const encoded = String(resource ?? '')
    .split('/')
    .pop();
  if (!encoded) {
    return '';
  }

  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function timestampFromMillis(value) {
  const millis = Number(value);
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : '';
}

function locationLabel(location) {
  const normalized = String(location ?? '').toLowerCase();
  if (normalized === 'panel') {
    return 'Chat Panel';
  }
  if (normalized === 'editor') {
    return 'Editor';
  }
  if (normalized === 'terminal') {
    return 'Terminal';
  }
  return location ? String(location) : 'Chat Panel';
}

function statusLabel(status, lastResponseState) {
  if (Number(status) === 2) {
    return 'Running';
  }
  if (Number(lastResponseState) === 2) {
    return 'Error';
  }
  return 'Idle';
}

function readWorkspaceState(workspaceDir) {
  if (!DatabaseSync) {
    return new Map();
  }

  const stateDb = join(workspaceDir, 'state.vscdb');
  if (!existsSync(stateDb)) {
    return new Map();
  }

  diagnostics.scannedStateDbs += 1;

  try {
    const db = new DatabaseSync(stateDb, { readOnly: true });
    const chatIndex = readStateValue(db, 'chat.ChatSessionStore.index');
    const agentModelCache = readStateValue(db, 'agentSessions.model.cache');
    const agentStateCache = readStateValue(db, 'agentSessions.state.cache');
    db.close();

    const bySession = new Map();
    const entries = Object.values(chatIndex?.entries ?? {});
    for (const entry of entries) {
      if (!entry?.sessionId) {
        continue;
      }

      bySession.set(entry.sessionId, {
        sourcePath: stateDb,
        keys: ['chat.ChatSessionStore.index'],
        title: entry.title,
        initialLocation: entry.initialLocation,
        permissionLevel: entry.permissionLevel,
        hasPendingEdits: Boolean(entry.hasPendingEdits),
        isExternal: Boolean(entry.isExternal),
        lastResponseState: entry.lastResponseState,
        createdAt: timestampFromMillis(entry.timing?.created),
        lastActivityAt: timestampFromMillis(
          entry.timing?.lastRequestEnded ??
            entry.lastMessageDate ??
            entry.timing?.lastRequestStarted,
        ),
      });
    }

    for (const agent of Array.isArray(agentModelCache) ? agentModelCache : []) {
      const sessionId = sessionIdFromResource(agent.resource);
      if (!sessionId) {
        continue;
      }

      const existing = bySession.get(sessionId) ?? { sourcePath: stateDb, keys: [] };
      bySession.set(sessionId, {
        ...existing,
        keys: [...new Set([...(existing.keys ?? []), 'agentSessions.model.cache'])],
        label: agent.label ?? existing.label,
        sessionType: agent.providerLabel ?? existing.sessionType,
        status: statusLabel(agent.status, existing.lastResponseState),
        resource: agent.resource,
        createdAt: existing.createdAt || timestampFromMillis(agent.timing?.created),
        lastActivityAt:
          existing.lastActivityAt ||
          timestampFromMillis(agent.timing?.lastRequestEnded ?? agent.timing?.lastRequestStarted),
      });
    }

    for (const readState of Array.isArray(agentStateCache) ? agentStateCache : []) {
      const sessionId = sessionIdFromResource(readState.resource);
      const existing = bySession.get(sessionId);
      if (!sessionId || !existing) {
        continue;
      }

      bySession.set(sessionId, {
        ...existing,
        keys: [...new Set([...(existing.keys ?? []), 'agentSessions.state.cache'])],
        readAt: timestampFromMillis(readState.read),
      });
    }

    return bySession;
  } catch (error) {
    diagnostics.warnings.push(`${stateDb}: SQLite enrichment skipped: ${error.message}`);
    return new Map();
  }
}

function readJsonl(file) {
  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJson(line))
    .filter(Boolean);
}

function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (character === '\n' || character === '\r') {
        inLineComment = false;
        output += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += character;
  }

  return output;
}

function readJsoncFile(file) {
  if (!existsSync(file)) {
    return {};
  }

  try {
    const json = stripJsonComments(readFileSync(file, 'utf8')).replace(/,\s*([}\]])/g, '$1');
    return safeJson(json) ?? {};
  } catch (error) {
    diagnostics.warnings.push(`${file}: settings file skipped: ${error.message}`);
    return {};
  }
}

function listDirs(dir) {
  return traverseDirs(dir, traversalOptions());
}

function listFiles(dir, suffix) {
  return traverseFiles(dir, suffix, traversalOptions());
}

function listDebugLogFiles(root) {
  return traverseDebugLogFiles(root, traversalOptions());
}

function listFilesRecursive(root, predicate, limit = memoryFileLimit, options = {}) {
  return traverseFilesRecursive(root, predicate, limit, traversalOptions(options));
}

function traversalOptions(options = {}) {
  return {
    ...options,
    onWarning: (message) => diagnostics.warnings.push(message),
    onUnreadable: options.onUnreadable ?? (() => {
      if (options.label === 'customization') {
        diagnostics.skippedUnreadableCustomizations += 1;
      } else {
        diagnostics.skippedUnreadableMemories += 1;
      }
    }),
  };
}

function memoryScanner() {
  return createMemoryScanner({
    diagnostics: () => diagnostics,
    listDebugLogFiles,
    listFilesRecursive,
    llmTokenFields,
    memoryFileLimit,
    memoryFileSizeLimit,
    normalizeModel: (model) => normalizeModel(model, pricing),
    readJsonl,
    safeJson,
    timestampForEvent,
  });
}

function memoriesFromRoot(root, source, workspace = '') {
  return memoryScanner().memoriesFromRoot(root, source, workspace);
}

export function memoryRecallsFromDebugLog(sessionDir, workspace = '') {
  return memoryScanner().memoryRecallsFromDebugLog(sessionDir, workspace);
}

export function attachMemoryRecalls(memories, sessions) {
  return attachMemoryRecallsCore(memories, sessions);
}

function sessionParser() {
  return createSessionParser({
    diagnostics: () => diagnostics,
    fallbackPricingModel,
    listFiles,
    memoryRecallsFromDebugLog,
    pricing,
    readJsonl,
    safeJson,
    traceEventLimit,
    usdToEur: () => usdToEur,
    workspaceName,
  });
}

export function llmTokenFields(event) {
  return sessionParser().llmTokenFields(event);
}

export function cacheTokenAuditFromLlmRequests(llmRequests) {
  return sessionParser().cacheTokenAuditFromLlmRequests(llmRequests);
}

export function mergeCacheTokenAudits(audits) {
  return sessionParser().mergeCacheTokenAudits(audits);
}

export function eventModelCostFields(rawModel, tokenFields) {
  return sessionParser().eventModelCostFields(rawModel, tokenFields);
}

export function modelBreakdownFromLlmRequests(llmRequests) {
  return sessionParser().modelBreakdownFromLlmRequests(llmRequests);
}

function timestampForEvent(event) {
  return sessionParser().timestampForEvent(event);
}

export function sessionFromDebugLog(sessionDir, workspaceDir) {
  return sessionParser().sessionFromDebugLog(sessionDir, workspaceDir);
}

export function sessionFromChatSnapshot(file, workspaceDir) {
  return sessionParser().sessionFromChatSnapshot(file, workspaceDir);
}

function workspaceName(workspaceDir) {
  const workspaceJson = join(workspaceDir, 'workspace.json');
  const raw = existsSync(workspaceJson) ? safeJson(readFileSync(workspaceJson, 'utf8')) : null;
  const folder = raw?.folder ? decodeURIComponent(String(raw.folder).replace(/^file:\/+/, '')) : '';
  return folder ? basename(folder) : basename(workspaceDir);
}

function workspaceFolderPath(workspaceDir) {
  const workspaceJson = join(workspaceDir, 'workspace.json');
  const raw = existsSync(workspaceJson) ? safeJson(readFileSync(workspaceJson, 'utf8')) : null;
  if (!raw?.folder) {
    return '';
  }

  try {
    const value = String(raw.folder);
    if (!value.startsWith('file:')) {
      return '';
    }
    const folder = decodeURIComponent(value.replace(/^file:\/+/, ''));
    const resolved = platform() === 'win32' ? folder.replace(/^\//, '') : `/${folder.replace(/^\/+/, '')}`;
    return isAbsolute(resolved) && existsSync(resolved) ? resolved : '';
  } catch {
    return '';
  }
}

function normalizedWorkspaceFolderScope(workspaceFolders) {
  if (!Array.isArray(workspaceFolders)) {
    return new Set();
  }
  return new Set(workspaceFolders.map(normalizeWorkspacePath).filter(Boolean));
}

function normalizeWorkspacePath(path) {
  if (!path) {
    return '';
  }
  try {
    return resolve(String(path)).toLowerCase();
  } catch {
    return '';
  }
}

function enrichSessionFromWorkspaceState(session, stateBySessionId) {
  const state = stateBySessionId.get(session.id);
  if (!state) {
    return session;
  }

  diagnostics.enrichedFromStateDbs += 1;

  const title = String(state.title ?? state.label ?? session.title);
  return {
    ...session,
    title: title.slice(0, 80),
    location: locationLabel(state.initialLocation ?? session.location),
    sessionType: state.sessionType ?? session.sessionType,
    status: state.status ?? statusLabel(undefined, state.lastResponseState),
    startedAt: state.createdAt || session.startedAt,
    endedAt: state.lastActivityAt || session.endedAt,
    tags: [
      ...new Set(
        [
          ...session.tags,
          'state-vscdb-enriched',
          state.hasPendingEdits ? 'pending-edits' : '',
          state.isExternal ? 'external' : '',
        ].filter(Boolean),
      ),
    ],
    vscodeState: {
      sourcePath: state.sourcePath,
      keys: state.keys ?? [],
      title: state.title ?? '',
      label: state.label ?? '',
      resource: state.resource ?? '',
      initialLocation: state.initialLocation ?? '',
      permissionLevel: state.permissionLevel ?? '',
      hasPendingEdits: Boolean(state.hasPendingEdits),
      isExternal: Boolean(state.isExternal),
      lastResponseState: Number(state.lastResponseState ?? 0),
      readAt: state.readAt ?? '',
      createdAt: state.createdAt ?? '',
      lastActivityAt: state.lastActivityAt ?? '',
    },
  };
}

function customizationInventoryScanner() {
  return createCustomizationInventoryScanner({
    diagnostics: () => diagnostics,
    listDirs,
    listFilesRecursive,
    readJsonl,
    workspaceFolderPath,
    workspaceName,
  });
}

function customizationsFromWorkspace(workspaceDir, options = {}) {
  return customizationInventoryScanner().customizationsFromWorkspace(workspaceDir, options);
}

function customizationsFromDiscoveryFolders(debugRoot, workspace, options = {}) {
  return customizationInventoryScanner().customizationsFromDiscoveryFolders(debugRoot, workspace, options);
}

function customizationsFromDebugReferences(debugRoot, bases, workspace, options = {}) {
  return customizationInventoryScanner().customizationsFromDebugReferences(debugRoot, bases, workspace, options);
}

function customizationEvidenceFromDebugLogs(
  debugRoot,
  customizations,
  workspace = '',
  workspaceDir = '',
  onProgress = () => {},
  evidenceOptions = {},
) {
  return customizationEvidenceFromDebugLogsCore(debugRoot, customizations, workspace, workspaceDir, onProgress, {
    ...evidenceOptions,
    diagnostics,
    listDirs,
    readJsonl,
  });
}

function workspaceScannerDependencies() {
  return {
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
  };
}

/**
 * Scan local VS Code Copilot storage and return the normalized app data model.
 * This function does not write files, which lets CLI, desktop, extension, and
 * local-server hosts decide how and where the result should be persisted.
 */
export async function scanVsCodeSessions(options = {}) {
  if (scanInProgress) {
    throw new Error('A VS Code session scan is already in progress in this process.');
  }

  const configuredRoots = options.roots === undefined ? defaultCodeUserDirs() : options.roots;
  if (!Array.isArray(configuredRoots)) {
    throw new TypeError('roots must be an array of VS Code user-data or workspace-storage paths.');
  }
  const roots = uniqueResolvedRoots(configuredRoots);
  const conversionRate = Number(options.usdToEur ?? process.env.USD_TO_EUR ?? 1);
  if (!Number.isFinite(conversionRate) || conversionRate <= 0) {
    throw new TypeError('usdToEur must be a positive number.');
  }

  const generatedAt = options.generatedAt
    ? new Date(options.generatedAt).toISOString()
    : new Date().toISOString();
  const previousDiagnostics = diagnostics;
  const previousDatabaseSync = DatabaseSync;
  const previousUsdToEur = usdToEur;

  scanInProgress = true;
  diagnostics = createDiagnostics();
  diagnostics.scannedRoots = roots;
  usdToEur = conversionRate;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const workspaceOptions = {
    includeCustomizations: options.includeCustomizations !== false,
    includeSystemCustomizations: options.includeSystemCustomizations === true,
    customizationEvidence: options.customizationEvidence ?? {},
  };

  try {
    onProgress({
      stage: 'roots',
      message: `Scanning ${roots.length} VS Code root${roots.length === 1 ? '' : 's'}.`,
      roots,
    });
    DatabaseSync = options.sqlite === false ? null : await loadSqliteSupport();
    let workspaceDirs = [
      ...new Set(roots.flatMap((root) => workspaceDirsForRoot(root, traversalOptions()))),
    ];
    const workspaceFolderScope = normalizedWorkspaceFolderScope(options.workspaceFolders);
    if (workspaceFolderScope.size) {
      const scopedWorkspaceDirs = dedupeWorkspaceDirsByFolder(
        workspaceDirs.filter((workspaceDir) =>
          workspaceFolderScope.has(normalizeWorkspacePath(workspaceFolderPath(workspaceDir))),
        ),
      );
      onProgress({
        stage: 'workspace-scope',
        message: `Current workspace scope matched ${scopedWorkspaceDirs.length} VS Code storage entr${scopedWorkspaceDirs.length === 1 ? 'y' : 'ies'}.`,
        total: scopedWorkspaceDirs.length,
      });
      workspaceDirs = scopedWorkspaceDirs;
    } else if (options.requireWorkspaceFolders === true) {
      onProgress({
        stage: 'workspace-scope',
        message: 'No current VS Code workspace folder was provided; skipping broad customization evidence scan.',
        total: 0,
      });
      workspaceDirs = [];
    }
    onProgress({
      stage: 'workspaces',
      message: `Found ${workspaceDirs.length} VS Code storage entr${workspaceDirs.length === 1 ? 'y' : 'ies'}.`,
      total: workspaceDirs.length,
    });
    const workspaceResults = [];
    for (const [index, workspaceDir] of workspaceDirs.entries()) {
      if (index > 0 && index % 50 === 0) {
        onProgress({
          stage: 'workspace-queue',
          message: `Checked ${index}/${workspaceDirs.length} VS Code storage entries.`,
          index,
          total: workspaceDirs.length,
        });
      }
      workspaceResults.push(parseWorkspaceEntry(
        workspaceDir,
        {
          ...workspaceOptions,
          workspaceIndex: index + 1,
          workspaceTotal: workspaceDirs.length,
        },
        onProgress,
        workspaceScannerDependencies(),
      ));
      await yieldToRuntime();
    }
    const sessions = workspaceResults
      .flatMap((result) => result.sessions)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const globalMemoryRoots = [...new Set(
      roots
        .map(userDirForRoot)
        .filter(Boolean)
        .map((userDir) => join(userDir, 'globalStorage', 'github.copilot-chat', 'memory-tool', 'memories')),
    )];
    const memoryMap = new Map();
    onProgress({
      stage: 'memories',
      message: `Indexing memories from ${globalMemoryRoots.length} global root${globalMemoryRoots.length === 1 ? '' : 's'} and VS Code storage.`,
      total: globalMemoryRoots.length,
    });
    for (const memory of [
      ...workspaceResults.flatMap((result) => result.memories),
      ...globalMemoryRoots.flatMap((root) => memoriesFromRoot(root, 'global')),
    ]) {
      memoryMap.set(memory.id, memory);
    }
    const memories = attachMemoryRecalls([...memoryMap.values()], sessions).sort((a, b) =>
      b.modifiedAt.localeCompare(a.modifiedAt),
    );
    const customizationMap = new Map();
    for (const customization of workspaceResults.flatMap((result) => result.customizations)) {
      customizationMap.set(
        customization.id,
        mergeCustomizationRecords(customizationMap.get(customization.id), customization),
      );
    }
    const customizations = [...customizationMap.values()].sort(
      (a, b) =>
        statusRank(b.evidenceStatus) - statusRank(a.evidenceStatus) ||
        b.modifiedAt.localeCompare(a.modifiedAt),
    );
    diagnostics.importedCustomizations = customizations.length;
    const seenIds = new Set();
    for (const session of sessions) {
      if (seenIds.has(session.id)) {
        diagnostics.warnings.push(`Duplicate session id imported: ${session.id}`);
      }
      seenIds.add(session.id);
    }

    onProgress({
      stage: 'complete',
      message: `Scan complete: imported ${sessions.length} session${sessions.length === 1 ? '' : 's'}.`,
      sessions: sessions.length,
      workspaces: workspaceDirs.length,
    });

    return {
      schemaVersion: sessionDataSchemaVersion,
      generatedAt,
      pricingVersion,
      pricingSourceUrl,
      usdToEur,
      ingestion: {
        ...diagnostics,
        importedSessions: sessions.length,
        cacheTokenAudit: mergeCacheTokenAudits(
          sessions.map((session) => session.cacheTokenAudit).filter(Boolean),
        ),
      },
      memories,
      customizations,
      sessions,
    };
  } finally {
    diagnostics = previousDiagnostics;
    DatabaseSync = previousDatabaseSync;
    usdToEur = previousUsdToEur;
    scanInProgress = false;
  }
}

function yieldToRuntime() {
  return new Promise((resolveYield) => setImmediate(resolveYield));
}

function dedupeWorkspaceDirsByFolder(workspaceDirs) {
  const seen = new Set();
  const deduped = [];
  for (const workspaceDir of workspaceDirs) {
    const folder = normalizeWorkspacePath(workspaceFolderPath(workspaceDir));
    const key = folder || normalizeWorkspacePath(workspaceDir);
    if (seen.has(key)) {
      diagnostics.warnings.push(`Duplicate VS Code storage entry skipped for current workspace: ${workspaceDir}`);
      continue;
    }
    seen.add(key);
    deduped.push(workspaceDir);
  }
  return deduped;
}

export function writeSessionData(sessionData, outputFile = 'public/data/sessions.json') {
  const resolvedOutputFile = resolve(outputFile);
  mkdirSync(dirname(resolvedOutputFile), { recursive: true });
  writeFileSync(resolvedOutputFile, JSON.stringify(sessionData, null, 2));
  return resolvedOutputFile;
}

export async function runScannerCli(args = process.argv.slice(2), logger = console, dependencies = {}) {
  const { outputFile, roots } = parseScannerCliArgs(args);
  const scanner = dependencies.scanner ?? scanVsCodeSessions;
  const writer = dependencies.writer ?? writeSessionData;
  const sessionData = await scanner(roots.length ? { roots } : {});
  const resolvedOutputFile = writer(sessionData, outputFile);

  logger.log(`Wrote ${sessionData.sessions.length} sessions to ${resolvedOutputFile}`);
  return sessionData;
}

function parseScannerCliArgs(args) {
  let outputFile = '';
  const roots = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [flag, inlineValue] = argument.split('=', 2);
    if (flag === '--output' || flag === '--root') {
      const value = inlineValue ?? args[index + 1];
      if (!value) {
        throw new Error(`${flag} requires a value.`);
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      if (flag === '--output') {
        outputFile = value;
      } else {
        roots.push(value);
      }
      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (!outputFile) {
      outputFile = argument;
    } else {
      roots.push(argument);
    }
  }

  return {
    outputFile: outputFile || 'public/data/sessions.json',
    roots,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runScannerCli();
}
