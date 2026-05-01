import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const usdToEur = Number(process.env.USD_TO_EUR ?? '0.93');
const outFile = resolve(process.argv[2] ?? 'public/data/sessions.json');
const explicitRoots = process.argv.length > 3 ? process.argv.slice(3) : [];
const ledgerSchemaVersion = 1;

const pricing = {
  'GPT-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'GPT-5 mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'GPT-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.2-Codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.3-Codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'GPT-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'GPT-5.4 mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'GPT-5.4 nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'GPT-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'Claude Haiku 4.5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'Claude Sonnet 4': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Sonnet 4.5': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Sonnet 4.6': { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'Claude Opus 4.5': { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'Gemini 2.5 Pro': { input: 1.25, cachedInput: 0.125, output: 10 },
  'Gemini 3 Flash': { input: 0.5, cachedInput: 0.05, output: 3 },
  'Gemini 3.1 Pro': { input: 2, cachedInput: 0.2, output: 12 },
  'Grok Code Fast 1': { input: 0.2, cachedInput: 0.02, output: 1.5 },
  'Raptor mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  Goldeneye: { input: 1.25, cachedInput: 0.125, output: 10 },
};

const diagnostics = {
  scannedRoots: [],
  scannedWorkspaces: 0,
  scannedStateDbs: 0,
  enrichedFromStateDbs: 0,
  importedDebugLogSessions: 0,
  importedChatSnapshotSessions: 0,
  skippedEmptyDebugLogs: 0,
  skippedChatSnapshotsWithoutRequests: 0,
  skippedDuplicateChatSnapshots: 0,
  warnings: [],
};

let DatabaseSync = null;

function defaultCodeUserDirs() {
  const home = homedir();

  if (platform() === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(appData, 'Code', 'User'), join(appData, 'Code - Insiders', 'User')];
  }

  if (platform() === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Code', 'User'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'),
    ];
  }

  return [join(home, '.config', 'Code', 'User'), join(home, '.config', 'Code - Insiders', 'User')];
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
  const encoded = String(resource ?? '').split('/').pop();
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
          entry.timing?.lastRequestEnded ?? entry.lastMessageDate ?? entry.timing?.lastRequestStarted,
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

function listDirs(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isDirectory());
}

function listFiles(dir, suffix) {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile() && path.endsWith(suffix));
}

function modelKey(model) {
  return String(model ?? '')
    .replace(/^copilot\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeModel(model) {
  const raw = String(model ?? '')
    .replace(/^copilot\//i, '')
    .trim();
  const key = modelKey(raw);
  const known = Object.keys(pricing);
  return (
    known.find((name) => modelKey(name) === key) ??
    known.find((name) => key.includes(modelKey(name))) ??
    (raw || 'Unknown model')
  );
}

function costUsd(model, tokens) {
  const price = pricing[model] ?? pricing['GPT-5.4'];
  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}

function modelBreakdownFromLlmRequests(llmRequests) {
  const byModel = new Map();

  for (const event of llmRequests) {
    const rawModel = String(event.attrs?.model ?? 'unknown')
      .replace(/^copilot\//i, '')
      .trim();
    const displayModel = normalizeModel(rawModel);
    const current = byModel.get(displayModel) ?? {
      model: displayModel,
      rawModels: new Set(),
      turns: 0,
      tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
      cost: { usd: 0, eur: 0 },
      pricingModel: pricing[displayModel] ? displayModel : 'GPT-5.4',
    };

    current.rawModels.add(rawModel || 'unknown');
    current.turns += 1;
    current.tokens.input += Number(event.attrs?.inputTokens ?? 0);
    current.tokens.output += Number(event.attrs?.outputTokens ?? 0);
    byModel.set(displayModel, current);
  }

  return [...byModel.values()].map((entry) => {
    const usd = costUsd(entry.pricingModel, entry.tokens);
    return {
      ...entry,
      rawModels: [...entry.rawModels],
      cost: { usd, eur: usd * usdToEur },
    };
  });
}

function sessionModelLabel(modelBreakdown, fallbackModel) {
  if (modelBreakdown.length === 1) {
    return modelBreakdown[0].model;
  }

  if (modelBreakdown.length > 1) {
    return `Mixed (${modelBreakdown.map((entry) => entry.model).join(', ')})`;
  }

  return normalizeModel(fallbackModel);
}

function estimateTokens(text) {
  const compact = String(text ?? '').trim();
  if (!compact) {
    return 0;
  }

  return Math.max(1, Math.round(Math.max(compact.split(/\s+/).length * 1.35, compact.length / 4)));
}

function timestampForEvent(event) {
  return event?.timestamp ?? new Date(Number(event?.ts ?? 0)).toISOString();
}

function eventDetail(event) {
  if (event.type === 'llm_request') {
    return `${event.attrs?.model ?? 'model'}: ${Number(event.attrs?.inputTokens ?? 0).toLocaleString()} in / ${Number(
      event.attrs?.outputTokens ?? 0,
    ).toLocaleString()} out`;
  }

  if (String(event.type ?? '').includes('tool')) {
    return String(event.data?.toolName ?? event.attrs?.toolName ?? event.name ?? event.type);
  }

  if (event.type === 'user_message') {
    return String(event.attrs?.content ?? '').slice(0, 140);
  }

  if (event.type === 'agent_response') {
    return parseAssistantResponse(event.attrs?.response).slice(0, 140);
  }

  return String(event.attrs?.details ?? event.name ?? event.type ?? '').slice(0, 140);
}

function workspaceName(workspaceDir) {
  const workspaceJson = join(workspaceDir, 'workspace.json');
  const raw = existsSync(workspaceJson) ? safeJson(readFileSync(workspaceJson, 'utf8')) : null;
  const folder = raw?.folder ? decodeURIComponent(String(raw.folder).replace(/^file:\/+/, '')) : '';
  return folder ? basename(folder) : basename(workspaceDir);
}

function parseAssistantResponse(raw) {
  const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!Array.isArray(parsed)) {
    return String(raw ?? '');
  }

  return parsed
    .flatMap((message) => message?.parts ?? [])
    .map((part) => {
      const content =
        typeof part?.content === 'string'
          ? (safeJson(part.content) ?? part.content)
          : part?.content;
      return typeof content === 'object' && content?.text ? content.text : String(content ?? '');
    })
    .filter(Boolean)
    .join('\n');
}

function sessionFromDebugLog(sessionDir, workspaceDir) {
  const main = readJsonl(join(sessionDir, 'main.jsonl'));
  if (!main.length) {
    diagnostics.skippedEmptyDebugLogs += 1;
    return null;
  }

  const sid = basename(sessionDir);
  const userMessages = main.filter((event) => event.type === 'user_message');
  const llmRequests = main.filter((event) => event.type === 'llm_request');
  const assistantEvents = main.filter(
    (event) => event.type === 'agent_response' || event.type === 'assistant.message',
  );
  const toolEvents = main.filter((event) => String(event.type ?? '').includes('tool'));
  const errorEvents = main.filter((event) => event.status && event.status !== 'ok');

  if (!userMessages.length && !llmRequests.length && !assistantEvents.length) {
    diagnostics.skippedEmptyDebugLogs += 1;
    return null;
  }

  const firstUserMessage = userMessages[0]?.attrs?.content ?? 'Untitled Copilot session';
  const modelBreakdown = modelBreakdownFromLlmRequests(llmRequests);
  const model = sessionModelLabel(
    modelBreakdown,
    llmRequests.find((event) => event.attrs?.model)?.attrs?.model,
  );
  const input = llmRequests.reduce((sum, event) => sum + Number(event.attrs?.inputTokens ?? 0), 0);
  const output = llmRequests.reduce(
    (sum, event) => sum + Number(event.attrs?.outputTokens ?? 0),
    0,
  );
  const tokens = { input, cachedInput: 0, cacheWrite: 0, output };
  const usd = modelBreakdown.length
    ? modelBreakdown.reduce((sum, entry) => sum + entry.cost.usd, 0)
    : costUsd(model, tokens);
  const startEvent = main.find((event) => event.type === 'session_start') ?? main[0];
  const lastEvent = main[main.length - 1];
  const startedAt =
    startEvent?.timestamp ??
    new Date(
      Number(startEvent?.ts ?? statSync(join(sessionDir, 'main.jsonl')).mtimeMs),
    ).toISOString();
  const endedAt =
    lastEvent?.timestamp ??
    new Date(
      Number(lastEvent?.ts ?? statSync(join(sessionDir, 'main.jsonl')).mtimeMs),
    ).toISOString();

  const turns = [
    ...userMessages.map((event) => ({
      role: 'user',
      text: String(event.attrs?.content ?? ''),
      tokens: estimateTokens(event.attrs?.content),
    })),
    ...assistantEvents.map((event) => {
      const text =
        event.type === 'assistant.message'
          ? event.data?.content
          : parseAssistantResponse(event.attrs?.response);
      return { role: 'assistant', text: String(text ?? ''), tokens: estimateTokens(text) };
    }),
  ].filter((turn) => turn.text.trim());

  return {
    id: sid,
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: llmRequests.length
      ? 'llm_request_token_totals'
      : 'debug-log-visible-text-estimate',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: firstUserMessage.slice(0, 80),
    firstPrompt: firstUserMessage.slice(0, 240),
    workspace: workspaceName(workspaceDir),
    sourcePath: sessionDir,
    model,
    modelBreakdown,
    startedAt,
    endedAt,
    tags: ['debug-log', llmRequests.length ? 'llm-request-token-totals' : 'estimated-visible-text'],
    toolsUsed: [
      ...new Set(
        toolEvents
          .map((event) => event.data?.toolName ?? event.attrs?.toolName ?? event.name)
          .filter(Boolean),
      ),
    ],
    tokens,
    cost: { usd, eur: usd * usdToEur },
    confidence: llmRequests.length ? 'exact' : 'estimated',
    traceSummary: {
      modelTurns: llmRequests.length,
      toolCalls: toolEvents.length,
      totalTokens: input + output,
      errors: errorEvents.length,
      totalEvents: main.length,
    },
    traceEvents: main
      .map((event, index) => ({
        index,
        timestamp: timestampForEvent(event),
        type: String(event.type ?? 'unknown'),
        name: String(event.name ?? event.type ?? 'unknown'),
        status: String(event.status ?? 'unknown'),
        detail: eventDetail(event),
        inputTokens: event.type === 'llm_request' ? Number(event.attrs?.inputTokens ?? 0) : 0,
        outputTokens: event.type === 'llm_request' ? Number(event.attrs?.outputTokens ?? 0) : 0,
      }))
      .slice(0, 200),
    turns: turns.slice(0, 60),
  };
}

function sessionFromChatSnapshot(file, workspaceDir) {
  const records = readJsonl(file);
  const snapshot =
    records.find((record) => record.kind === 0 && record.v?.requests) ??
    records[0]?.v ??
    records[0];
  const requests = snapshot?.requests ?? [];

  if (!requests.length) {
    diagnostics.skippedChatSnapshotsWithoutRequests += 1;
    return null;
  }

  const firstRequest = requests[0];
  const firstPrompt =
    firstRequest?.message?.text ?? snapshot?.customTitle ?? 'Untitled Copilot session';
  const model = normalizeModel(
    firstRequest?.modelId ?? firstRequest?.inputState?.selectedModel?.identifier,
  );
  const output = requests.reduce((sum, request) => sum + Number(request.completionTokens ?? 0), 0);
  const input = requests.reduce(
    (sum, request) => sum + estimateTokens(request?.message?.text ?? ''),
    0,
  );
  const tokens = { input, cachedInput: 0, cacheWrite: 0, output };
  const usd = costUsd(model, tokens);
  const startedAt = new Date(Number(snapshot.creationDate ?? statSync(file).mtimeMs)).toISOString();
  const endedAt = statSync(file).mtime.toISOString();

  return {
    id: basename(file, '.jsonl'),
    sourceKind: 'vscode-chat-session-snapshot',
    tokenSource: 'chat-snapshot-output-plus-visible-input-estimate',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: String(snapshot.customTitle ?? firstPrompt).slice(0, 80),
    firstPrompt: String(firstPrompt).slice(0, 240),
    workspace: workspaceName(workspaceDir),
    sourcePath: file,
    model,
    modelBreakdown: [
      {
        model,
        rawModels: [
          String(
            firstRequest?.modelId ?? firstRequest?.inputState?.selectedModel?.identifier ?? model,
          ),
        ],
        turns: requests.length,
        tokens,
        cost: { usd, eur: usd * usdToEur },
        pricingModel: pricing[model] ? model : 'GPT-5.4',
      },
    ],
    startedAt,
    endedAt,
    tags: ['chat-session', 'estimated-input'],
    toolsUsed: [],
    tokens,
    cost: { usd, eur: usd * usdToEur },
    confidence: 'estimated',
    traceSummary: {
      modelTurns: requests.length,
      toolCalls: 0,
      totalTokens: input + output,
      errors: 0,
      totalEvents: records.length,
    },
    traceEvents: requests
      .flatMap((request, index) => [
        {
          index: index * 2,
          timestamp: startedAt,
          type: 'user_message',
          name: 'user_message',
          status: 'ok',
          detail: String(request?.message?.text ?? '').slice(0, 140),
          inputTokens: estimateTokens(request?.message?.text ?? ''),
          outputTokens: 0,
        },
        {
          index: index * 2 + 1,
          timestamp: endedAt,
          type: 'assistant_response',
          name: 'assistant_response',
          status: 'ok',
          detail: `${Number(request.completionTokens ?? 0).toLocaleString()} completion tokens`,
          inputTokens: 0,
          outputTokens: Number(request.completionTokens ?? 0),
        },
      ])
      .slice(0, 200),
    turns: requests
      .flatMap((request) => [
        {
          role: 'user',
          text: String(request?.message?.text ?? ''),
          tokens: estimateTokens(request?.message?.text),
        },
        {
          role: 'assistant',
          text: (request?.response ?? [])
            .map((part) => part.value ?? part.generatedTitle ?? part.kind ?? '')
            .filter(Boolean)
            .join('\n'),
          tokens: Number(request.completionTokens ?? 0),
        },
      ])
      .filter((turn) => turn.text.trim())
      .slice(0, 60),
  };
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
      ...new Set([
        ...session.tags,
        'state-vscdb-enriched',
        state.hasPendingEdits ? 'pending-edits' : '',
        state.isExternal ? 'external' : '',
      ].filter(Boolean)),
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

function parseWorkspace(workspaceDir) {
  diagnostics.scannedWorkspaces += 1;
  const stateBySessionId = readWorkspaceState(workspaceDir);
  const debugRoot = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs');
  const debugSessions = listDirs(debugRoot)
    .map((sessionDir) => sessionFromDebugLog(sessionDir, workspaceDir))
    .filter(Boolean)
    .map((session) => enrichSessionFromWorkspaceState(session, stateBySessionId));
  const debugIds = new Set(debugSessions.map((session) => session.id));
  diagnostics.importedDebugLogSessions += debugSessions.length;

  const chatSessions = listFiles(join(workspaceDir, 'chatSessions'), '.jsonl')
    .map((file) => {
      const session = sessionFromChatSnapshot(file, workspaceDir);
      if (session && debugIds.has(session.id)) {
        diagnostics.skippedDuplicateChatSnapshots += 1;
        return null;
      }
      return session ? enrichSessionFromWorkspaceState(session, stateBySessionId) : null;
    })
    .filter(Boolean);
  diagnostics.importedChatSnapshotSessions += chatSessions.length;

  return [...debugSessions, ...chatSessions];
}

function workspaceDirsFromUserDir(userDir) {
  const workspaceStorage = join(userDir, 'workspaceStorage');
  return listDirs(workspaceStorage);
}

const userDirs = explicitRoots.length ? explicitRoots : defaultCodeUserDirs();
DatabaseSync = await loadSqliteSupport();
diagnostics.scannedRoots = userDirs;
const workspaceDirs = userDirs.flatMap((root) => {
  if (basename(dirname(root)) === 'workspaceStorage' || existsSync(join(root, 'workspace.json'))) {
    return [root];
  }
  return workspaceDirsFromUserDir(root);
});

const sessions = workspaceDirs
  .flatMap(parseWorkspace)
  .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
const seenIds = new Set();
for (const session of sessions) {
  if (seenIds.has(session.id)) {
    diagnostics.warnings.push(`Duplicate session id imported: ${session.id}`);
  }
  seenIds.add(session.id);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify(
    {
      schemaVersion: ledgerSchemaVersion,
      generatedAt: new Date().toISOString(),
      pricingVersion: 'github-copilot-usage-pricing-2026-06-01',
      usdToEur,
      ingestion: {
        ...diagnostics,
        importedSessions: sessions.length,
      },
      sessions,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${sessions.length} sessions to ${outFile}`);
