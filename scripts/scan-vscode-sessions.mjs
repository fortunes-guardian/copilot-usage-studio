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
  importedDebugLogSessions: 0,
  importedChatSnapshotSessions: 0,
  skippedEmptyDebugLogs: 0,
  skippedChatSnapshotsWithoutRequests: 0,
  skippedDuplicateChatSnapshots: 0,
  warnings: [],
};

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

function normalizeModel(model) {
  const raw = String(model ?? '')
    .replace(/^copilot\//, '')
    .toLowerCase();
  const known = Object.keys(pricing);
  return (
    known.find((name) => name.toLowerCase() === raw) ??
    known.find((name) => raw.includes(name.toLowerCase())) ??
    'GPT-5.4'
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
  const model = normalizeModel(llmRequests.find((event) => event.attrs?.model)?.attrs?.model);
  const input = llmRequests.reduce((sum, event) => sum + Number(event.attrs?.inputTokens ?? 0), 0);
  const output = llmRequests.reduce(
    (sum, event) => sum + Number(event.attrs?.outputTokens ?? 0),
    0,
  );
  const tokens = { input, cachedInput: 0, cacheWrite: 0, output };
  const usd = costUsd(model, tokens);
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

function parseWorkspace(workspaceDir) {
  diagnostics.scannedWorkspaces += 1;
  const debugRoot = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs');
  const debugSessions = listDirs(debugRoot)
    .map((sessionDir) => sessionFromDebugLog(sessionDir, workspaceDir))
    .filter(Boolean);
  const debugIds = new Set(debugSessions.map((session) => session.id));
  diagnostics.importedDebugLogSessions += debugSessions.length;

  const chatSessions = listFiles(join(workspaceDir, 'chatSessions'), '.jsonl')
    .map((file) => {
      const session = sessionFromChatSnapshot(file, workspaceDir);
      if (session && debugIds.has(session.id)) {
        diagnostics.skippedDuplicateChatSnapshots += 1;
        return null;
      }
      return session;
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
