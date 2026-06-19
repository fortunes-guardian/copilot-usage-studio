import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  costBreakdownUsdForTokens,
  costUsdForTokens,
  modelKey,
  normalizeModel,
  pricingModelForModel,
} from './pricing-utils.mjs';

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
const customizationFileLimit = 1000;
const customizationFileSizeLimit = 1024 * 1024;
const skippedTraversalDirs = new Set([
  '.angular',
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.pnpm-store',
  '.svn',
  '.turbo',
  '.venv',
  '__pycache__',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  'venv',
]);

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
    importedCustomizations: 0,
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

export function defaultCodeUserDirs() {
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

function listDirs(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => join(dir, entry.name));
  } catch (error) {
    diagnostics.warnings.push(`${dir}: directory listing skipped: ${error.message}`);
    return [];
  }
}

function listFiles(dir, suffix) {
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name));
  } catch (error) {
    diagnostics.warnings.push(`${dir}: file listing skipped: ${error.message}`);
    return [];
  }
}

function listDebugLogFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  const pending = [{ path: root, depth: 0 }];
  let visitedDirs = 0;
  const maxDirs = 2000;

  while (pending.length && visitedDirs < maxDirs) {
    const current = pending.pop();
    visitedDirs += 1;
    let entries = [];
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch (error) {
      diagnostics.warnings.push(`${current.path}: debug-log side-file scan skipped: ${error.message}`);
      continue;
    }
    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory() && current.depth < 4 && !skippedTraversalDirs.has(entry.name)) {
        pending.push({ path, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path);
      }
    }
  }
  if (pending.length) {
    diagnostics.warnings.push(`${root}: debug-log side-file scan capped at ${maxDirs} directories.`);
  }

  return files.sort();
}

function listFilesRecursive(root, predicate, limit = memoryFileLimit, options = {}) {
  if (!existsSync(root)) {
    return [];
  }

  const maxDepth = Number(options.maxDepth ?? 8);
  const maxDirs = Number(options.maxDirs ?? 5000);
  const label = options.label ?? 'recursive';
  const files = [];
  const pending = [{ path: root, depth: 0 }];
  let visitedDirs = 0;

  while (pending.length && files.length < limit && visitedDirs < maxDirs) {
    const current = pending.pop();
    visitedDirs += 1;
    let entries = [];

    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch (error) {
      diagnostics.skippedUnreadableMemories += 1;
      diagnostics.warnings.push(`${current.path}: ${label} directory skipped: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < maxDepth && !skippedTraversalDirs.has(entry.name)) {
          pending.push({ path, depth: current.depth + 1 });
        }
      } else if (entry.isFile() && predicate(path)) {
        files.push(path);
        if (files.length >= limit) {
          diagnostics.warnings.push(`${root}: ${label} scan capped at ${limit} files.`);
          break;
        }
      }
    }
  }
  if (pending.length) {
    diagnostics.warnings.push(`${root}: ${label} scan capped at ${maxDirs} directories.`);
  }

  return files;
}

function decodeMemorySessionId(value) {
  try {
    const decoded = Buffer.from(String(value), 'base64').toString('utf8');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)
      ? decoded
      : '';
  } catch {
    return '';
  }
}

function memoryTitle(content, file) {
  const heading = String(content)
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,3}\s+(.+?)\s*#*$/)?.[1]?.trim())
    .find(Boolean);

  if (heading) {
    return heading.slice(0, 160);
  }

  return basename(file, extname(file))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .slice(0, 160);
}

function memoryExcerpt(content) {
  return String(content)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[`*_>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function parseSimpleFrontmatter(content) {
  const text = String(content ?? '');
  if (!text.startsWith('---')) {
    return {};
  }

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }

  const result = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const scalar = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!scalar) {
      continue;
    }

    const key = scalar[1];
    let value = scalar[2].trim();
    if (value === '|') {
      const block = [];
      index += 1;
      while (index < lines.length && /^\s+/.test(lines[index])) {
        block.push(lines[index].replace(/^\s{2}/, ''));
        index += 1;
      }
      index -= 1;
      result[key] = block.join('\n').trim();
      continue;
    }

    const list = [];
    while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])) {
      index += 1;
      list.push(lines[index].replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '').trim());
    }
    result[key] = list.length ? list : value.replace(/^["']|["']$/g, '');
  }

  return result;
}

function markdownTitle(content, file) {
  const frontmatter = parseSimpleFrontmatter(content);
  if (frontmatter.title) {
    return String(frontmatter.title).slice(0, 160);
  }

  return memoryTitle(content, file);
}

function titleFromFileName(file) {
  return basename(file, extname(file))
    .replace(/\.instructions$/i, '')
    .replace(/\.skill$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .slice(0, 160);
}

function customizationKind(file) {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  const name = basename(file).toLowerCase();

  if (normalized.includes('/.github/instructions/') || name.endsWith('.instructions.md')) {
    return 'instruction';
  }
  if (normalized.includes('/.github/skills/') || name === 'skill.md' || name.endsWith('.skill.md')) {
    return 'skill';
  }
  if (normalized.includes('/.github/prompts/') || name.endsWith('.prompt.md')) {
    return 'prompt';
  }
  if (normalized.includes('/.github/hooks/')) {
    return 'hook';
  }
  return 'other';
}

function customizationFromFile(file, root, workspace) {
  try {
    const stats = statSync(file);
    if (stats.size > customizationFileSizeLimit) {
      diagnostics.skippedOversizedCustomizations += 1;
      diagnostics.warnings.push(`${file}: customization skipped because it exceeds 1 MiB.`);
      return null;
    }

    const content = readFileSync(file, 'utf8');
    const frontmatter = parseSimpleFrontmatter(content);
    const kind = customizationKind(file);
    const relativePath = relative(root, file);
    const description = String(frontmatter.description ?? '').trim();
    const applyTo = Array.isArray(frontmatter.applyTo)
      ? frontmatter.applyTo.map(String)
      : String(frontmatter.applyTo ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    return {
      id: createHash('sha256').update(resolve(file)).digest('hex').slice(0, 24),
      kind,
      title: frontmatter.title ? markdownTitle(content, file) : titleFromFileName(file),
      name: String(frontmatter.id ?? basename(file, extname(file))).trim(),
      description: description || memoryExcerpt(content).slice(0, 180),
      applyTo,
      triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers.map(String) : [],
      scope: frontmatter.scope ? String(frontmatter.scope) : 'workspace',
      workspace,
      sourcePath: resolve(file),
      relativePath,
      createdAt: stats.birthtimeMs > 0 ? stats.birthtime.toISOString() : '',
      modifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      characterCount: content.length,
      lineCount: content ? content.split(/\r?\n/).length : 0,
      excerpt: memoryExcerpt(content),
      _content: content,
    };
  } catch (error) {
    diagnostics.skippedUnreadableCustomizations += 1;
    diagnostics.warnings.push(`${file}: customization skipped: ${error.message}`);
    return null;
  }
}

function customizationsFromWorkspace(workspaceDir) {
  const folder = workspaceFolderPath(workspaceDir);
  if (!folder) {
    return [];
  }

  const roots = [
    join(folder, '.github', 'instructions'),
    join(folder, '.github', 'skills'),
    join(folder, '.github', 'prompts'),
    join(folder, '.github', 'hooks'),
  ].filter(existsSync);

  return roots.flatMap((root) => {
    diagnostics.scannedCustomizationRoots += 1;
    const files = listFilesRecursive(
      root,
      (file) => extname(file).toLowerCase() === '.md',
      customizationFileLimit,
      { label: 'customization', maxDepth: 5, maxDirs: 300 },
    );
    if (files.length >= customizationFileLimit) {
      diagnostics.warnings.push(`${root}: customization scan capped at ${customizationFileLimit} files.`);
    }

    return files
      .map((file) => customizationFromFile(file, folder, workspaceName(workspaceDir)))
      .filter(Boolean);
  });
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\\r?\\n/g, '\n')
    .replace(/\\\\/g, '/')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function customizationChunks(content) {
  const lineChunks = String(content ?? '')
    .split(/\r?\n/)
    .map(normalizeMatchText)
    .filter((chunk) => chunk.length >= 32 && /[a-z]/.test(chunk));
  const normalized = normalizeMatchText(content);
  const chunks = normalized
    .split(/\n{2,}|(?<=\.)\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 48 && /[a-z]/.test(chunk))
    .sort((a, b) => b.length - a.length);

  if (normalized.length >= 80) {
    chunks.unshift(normalized.slice(0, Math.min(normalized.length, 420)));
  }

  return [...new Set([...lineChunks, ...chunks])].slice(0, 24);
}

function requestTextParts(sessionDir, event) {
  const parts = [
    { source: 'inputMessages', text: event.attrs?.inputMessages },
    { source: 'userRequest', text: event.attrs?.userRequest },
  ];
  const systemPromptFile = String(event.attrs?.systemPromptFile ?? '').trim();
  const systemPromptPath = sessionSideFilePath(sessionDir, systemPromptFile);
  if (systemPromptPath && existsSync(systemPromptPath)) {
    parts.push({ source: systemPromptFile, text: readFileSync(systemPromptPath, 'utf8') });
  }

  return parts.map((part) => ({
    ...part,
    normalized: normalizeMatchText(part.text),
  }));
}

function sessionSideFilePath(sessionDir, file) {
  const value = String(file ?? '').trim();
  if (!value || isAbsolute(value)) {
    return '';
  }

  const root = `${resolve(sessionDir)}${sep}`;
  const candidate = resolve(sessionDir, value);
  return candidate.startsWith(root) ? candidate : '';
}

function customizationTerms(customization) {
  return [
    customization.sourcePath,
    customization.relativePath,
    basename(customization.sourcePath),
    customization.name,
    customization.title,
    customization.description,
    ...customization.applyTo,
    ...customization.triggers,
  ]
    .map(normalizeMatchText)
    .filter((value) => value.length >= 4);
}

function evidenceStatus(rank) {
  return ['not_seen', 'discovered', 'listed', 'sent'][rank] ?? 'not_seen';
}

function statusRank(status) {
  return {
    sent: 3,
    listed: 2,
    discovered: 1,
    not_seen: 0,
  }[status] ?? 0;
}

function recordCustomizationMatch(state, match) {
  state.matches.push(match);
  state.matches.sort(
    (a, b) => statusRank(b.status) - statusRank(a.status) || b.timestamp.localeCompare(a.timestamp),
  );
  state.matches = state.matches.slice(0, 60);
}

function customizationEvidenceFromDebugLogs(debugRoot, customizations, workspace = '') {
  if (!customizations.length || !existsSync(debugRoot)) {
    return customizations.map((customization) => {
      const { _content, ...publicCustomization } = customization;
      return { ...publicCustomization, evidenceStatus: 'not_seen', matches: [] };
    });
  }

  const matchState = new Map(
    customizations.map((customization) => [
      customization.id,
      {
        rank: 0,
        matches: [],
        chunks: customizationChunks(customization._content),
        terms: customizationTerms(customization),
      },
    ]),
  );

  for (const sessionDir of listDirs(debugRoot)) {
    const sessionId = basename(sessionDir);
    const main = readJsonl(join(sessionDir, 'main.jsonl'));
    const modelCallNumbers = new Map();
    let modelCallNumber = 0;
    main.forEach((event, index) => {
      if (event.type === 'llm_request') {
        modelCallNumber += 1;
        modelCallNumbers.set(index, modelCallNumber);
      }
    });

    for (const [index, event] of main.entries()) {
      const eventText = normalizeMatchText(`${event.name ?? ''} ${event.attrs?.details ?? ''}`);
      for (const customization of customizations) {
        const state = matchState.get(customization.id);
        if (!state) {
          continue;
        }

        if (event.type === 'llm_request') {
          const parts = requestTextParts(sessionDir, event);
          for (const part of parts) {
            const matchedChunks = state.chunks.filter((chunk) => part.normalized.includes(chunk));
            const listed = !matchedChunks.length && state.terms.some((term) => part.normalized.includes(term));
            if (!matchedChunks.length && !listed) {
              continue;
            }

            const rank = matchedChunks.length ? 3 : 2;
            state.rank = Math.max(state.rank, rank);
            recordCustomizationMatch(state, {
              status: evidenceStatus(rank),
              sessionId,
              workspace,
              timestamp: timestampForEvent(event),
              eventIndex: index,
              modelCallNumber: modelCallNumbers.get(index) ?? 0,
              source: part.source,
              matchedChunks: matchedChunks.length,
              matchedCharacters: matchedChunks.reduce((sum, chunk) => sum + chunk.length, 0),
            });
          }
          continue;
        }

        if (state.rank < 2 && state.terms.some((term) => eventText.includes(term))) {
          state.rank = Math.max(state.rank, 1);
          recordCustomizationMatch(state, {
            status: 'discovered',
            sessionId,
            workspace,
            timestamp: timestampForEvent(event),
            eventIndex: index,
            modelCallNumber: 0,
            source: String(event.name ?? event.type ?? 'event'),
            matchedChunks: 0,
            matchedCharacters: 0,
          });
        }
      }
    }
  }

  return customizations.map((customization) => {
    const state = matchState.get(customization.id);
    const matches = (state?.matches ?? []).sort(
      (a, b) => statusRank(b.status) - statusRank(a.status) || b.timestamp.localeCompare(a.timestamp),
    );
    const { _content, ...publicCustomization } = customization;
    return {
      ...publicCustomization,
      evidenceStatus: evidenceStatus(state?.rank ?? 0),
      matches,
    };
  });
}

function memoryFromFile(file, root, source, workspace) {
  try {
    const stats = statSync(file);
    if (stats.size > memoryFileSizeLimit) {
      diagnostics.skippedOversizedMemories += 1;
      diagnostics.warnings.push(`${file}: memory skipped because it exceeds 1 MiB.`);
      return null;
    }

    const content = readFileSync(file, 'utf8');
    const relativePath = relative(root, file);
    const segments = relativePath.split(sep).filter(Boolean);
    const sessionId = source === 'workspace' ? decodeMemorySessionId(segments[0]) : '';
    const kind = basename(file).toLowerCase() === 'plan.md' ? 'plan' : 'memory';
    const scope = source === 'global'
      ? 'global'
      : segments[0]?.toLowerCase() === 'repo'
        ? 'repository'
        : sessionId
          ? 'session'
          : 'workspace';

    return {
      id: createHash('sha256').update(resolve(file)).digest('hex').slice(0, 24),
      kind,
      scope,
      title: memoryTitle(content, file),
      excerpt: memoryExcerpt(content),
      content,
      workspace: source === 'global' ? '' : workspace,
      sessionId,
      sourcePath: resolve(file),
      relativePath,
      createdAt: stats.birthtimeMs > 0 ? stats.birthtime.toISOString() : '',
      modifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
      characterCount: content.length,
      lineCount: content ? content.split(/\r?\n/).length : 0,
    };
  } catch (error) {
    diagnostics.skippedUnreadableMemories += 1;
    diagnostics.warnings.push(`${file}: memory skipped: ${error.message}`);
    return null;
  }
}

function memoriesFromRoot(root, source, workspace = '') {
  if (!existsSync(root)) {
    return [];
  }

  diagnostics.scannedMemoryRoots += 1;
  const memories = listFilesRecursive(
    root,
    (file) => extname(file).toLowerCase() === '.md',
    memoryFileLimit,
    { label: 'memory', maxDepth: 8, maxDirs: 2500 },
  )
    .map((file) => memoryFromFile(file, root, source, workspace))
    .filter(Boolean);

  diagnostics.importedMemories += memories.length;
  diagnostics.importedPlans += memories.filter((memory) => memory.kind === 'plan').length;
  return memories;
}

function normalizeMemoryVirtualPath(value) {
  const path = String(value ?? '').trim().replace(/\\/g, '/');
  return path.startsWith('/') ? path : `/${path}`;
}

function virtualPathForMemory(memory) {
  const segments = String(memory.relativePath ?? '').split(/[\\/]+/).filter(Boolean);

  if (memory.scope === 'session') {
    return normalizeMemoryVirtualPath(`/memories/session/${segments.slice(1).join('/')}`);
  }

  return normalizeMemoryVirtualPath(`/memories/${segments.join('/')}`);
}

export function memoryRecallsFromDebugLog(sessionDir, workspace = '') {
  const sessionId = basename(sessionDir);
  const recalls = [];

  for (const file of listDebugLogFiles(sessionDir)) {
    const events = readJsonl(file);
    let modelCallNumber = 0;
    const modelCallNumbers = new Map();

    events.forEach((event, index) => {
      if (event.type === 'llm_request') {
        modelCallNumber += 1;
        modelCallNumbers.set(index, modelCallNumber);
      }
    });

    events.forEach((event, index) => {
      if (event.type !== 'tool_call' || event.name !== 'memory') {
        return;
      }

      const args = safeJson(event.attrs?.args) ?? {};
      if (args.command !== 'view' || !args.path) {
        return;
      }

      const nextModelIndex = events.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && candidate.type === 'llm_request',
      );
      const nextModel = nextModelIndex >= 0 ? events[nextModelIndex] : null;
      const tokenFields = nextModel ? llmTokenFields(nextModel) : null;
      const sourceLog = basename(file);

      recalls.push({
        id: createHash('sha256')
          .update(`${resolve(file)}:${index}:${args.path}`)
          .digest('hex')
          .slice(0, 24),
        sessionId,
        workspace,
        virtualPath: normalizeMemoryVirtualPath(args.path),
        timestamp: timestampForEvent(event),
        sourceLog,
        returnedCharacterCount: String(event.attrs?.result ?? '').length,
        ...(nextModel
          ? {
              followingModelCall: {
                number: modelCallNumbers.get(nextModelIndex) ?? 0,
                model: normalizeModel(nextModel.attrs?.model, pricing),
                inputTokens: tokenFields.inputTokens,
                cachedInputTokens: tokenFields.cachedInputTokens,
                outputTokens: tokenFields.outputTokens,
              },
            }
          : {}),
      });
    });
  }

  return recalls.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function attachMemoryRecalls(memories, sessions) {
  const recalls = sessions.flatMap((session) => session.memoryRecalls ?? []);

  return memories.map((memory) => {
    const virtualPath = virtualPathForMemory(memory);
    const matchingRecalls = recalls.filter((recall) => {
      if (recall.virtualPath !== virtualPath) {
        return false;
      }
      if (memory.scope === 'session') {
        return memory.sessionId === recall.sessionId;
      }
      if (memory.scope === 'repository' || memory.scope === 'workspace') {
        return memory.workspace === recall.workspace;
      }
      return memory.scope === 'global';
    });

    return matchingRecalls.length ? { ...memory, recalls: matchingRecalls } : memory;
  });
}

function costUsd(model, tokens) {
  return costUsdForTokens(model, tokens, pricing, fallbackPricingModel);
}

function costBreakdownUsd(model, tokens) {
  return costBreakdownUsdForTokens(model, tokens, pricing, fallbackPricingModel);
}

function transcriptAvailability(workspaceDir, sessionId) {
  const sourcePath = join(workspaceDir, 'GitHub.copilot-chat', 'transcripts', `${sessionId}.jsonl`);

  if (!existsSync(sourcePath)) {
    return {
      available: false,
      sourcePath: '',
      eventCount: 0,
    };
  }

  const eventCount = readJsonl(sourcePath).length;

  return {
    available: true,
    sourcePath,
    eventCount,
  };
}

function numericAttr(attrs, names) {
  for (const name of names) {
    const value = Number(attrs?.[name] ?? 0);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

export function llmTokenFields(event) {
  const inputTokens = Number(event.attrs?.inputTokens ?? 0);
  const outputTokens = Number(event.attrs?.outputTokens ?? 0);
  const rawCachedInputTokens = numericAttr(event.attrs, [
    'cachedTokens',
    'cachedInputTokens',
    'cacheReadTokens',
  ]);
  const cachedInputTokens = Math.min(inputTokens, rawCachedInputTokens);
  const cacheWriteTokens = numericAttr(event.attrs, ['cacheWriteTokens', 'cachedWriteTokens']);
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  return {
    inputTokens,
    billableInputTokens,
    rawCachedInputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
  };
}

export function cacheTokenAuditFromLlmRequests(llmRequests) {
  return llmRequests.reduce(
    (audit, event) => {
      const tokenFields = llmTokenFields(event);

      audit.modelCalls += 1;
      audit.rawInputTokens += tokenFields.inputTokens;
      audit.normalInputTokens += tokenFields.billableInputTokens;
      audit.cachedInputTokens += tokenFields.cachedInputTokens;
      audit.cacheWriteTokens += tokenFields.cacheWriteTokens;
      audit.outputTokens += tokenFields.outputTokens;

      if (tokenFields.rawCachedInputTokens > 0) {
        audit.callsWithCachedTokens += 1;
      }

      if (tokenFields.rawCachedInputTokens > tokenFields.inputTokens) {
        audit.invalidCachedTokenSplits += 1;
      }

      const rawInputShare =
        tokenFields.inputTokens > 0 ? tokenFields.cachedInputTokens / tokenFields.inputTokens : 0;
      audit.maxCachedInputShare = Math.max(audit.maxCachedInputShare, rawInputShare);

      return audit;
    },
    {
      modelCalls: 0,
      callsWithCachedTokens: 0,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 0,
      normalInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      maxCachedInputShare: 0,
    },
  );
}

export function mergeCacheTokenAudits(audits) {
  return audits.reduce(
    (total, audit) => ({
      modelCalls: total.modelCalls + audit.modelCalls,
      callsWithCachedTokens: total.callsWithCachedTokens + audit.callsWithCachedTokens,
      invalidCachedTokenSplits: total.invalidCachedTokenSplits + audit.invalidCachedTokenSplits,
      rawInputTokens: total.rawInputTokens + audit.rawInputTokens,
      normalInputTokens: total.normalInputTokens + audit.normalInputTokens,
      cachedInputTokens: total.cachedInputTokens + audit.cachedInputTokens,
      cacheWriteTokens: total.cacheWriteTokens + audit.cacheWriteTokens,
      outputTokens: total.outputTokens + audit.outputTokens,
      maxCachedInputShare: Math.max(total.maxCachedInputShare, audit.maxCachedInputShare),
    }),
    {
      modelCalls: 0,
      callsWithCachedTokens: 0,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 0,
      normalInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      maxCachedInputShare: 0,
    },
  );
}

export function eventModelCostFields(rawModel, tokenFields) {
  const normalizedModel = normalizeModel(rawModel, pricing);
  const pricingModel = pricingModelForModel(normalizedModel, pricing, fallbackPricingModel);
  const tokens = {
    input: tokenFields.billableInputTokens,
    cachedInput: tokenFields.cachedInputTokens,
    cacheWrite: tokenFields.cacheWriteTokens,
    output: tokenFields.outputTokens,
  };
  const costBreakdown = costBreakdownUsd(pricingModel, tokens);

  return {
    model: normalizedModel,
    rawModel:
      String(rawModel ?? '')
        .replace(/^copilot\//i, '')
        .trim() || 'unknown',
    pricingModel,
    pricingTier: costBreakdown.tier,
    totalTokens: tokenFields.inputTokens + tokenFields.outputTokens + tokenFields.cacheWriteTokens,
    estimatedCost: { usd: costBreakdown.total, eur: costBreakdown.total * usdToEur },
  };
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  return safeJson(value) ?? value;
}

function charLength(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  return typeof value === 'string' ? value.length : JSON.stringify(value).length;
}

function parseContentFile(file) {
  const envelope = safeJson(readFileSync(file, 'utf8'));
  const content = parseMaybeJson(envelope?.content ?? envelope);

  return {
    file,
    content,
    chars: charLength(content),
  };
}

function modelCapabilityIndex(sessionDir) {
  const file = join(sessionDir, 'models.json');
  if (!existsSync(file)) {
    return new Map();
  }

  const parsed = safeJson(readFileSync(file, 'utf8'));
  const models = Array.isArray(parsed) ? parsed : [];
  const index = new Map();

  for (const model of models) {
    const keys = [model?.id, model?.name, model?.version, model?.capabilities?.family]
      .filter(Boolean)
      .map(modelKey);

    for (const key of keys) {
      if (key) {
        index.set(key, model);
      }
    }
  }

  return index;
}

function modelCapabilityFor(rawModel, capabilityIndex) {
  const key = modelKey(rawModel);

  return (
    capabilityIndex.get(key) ??
    [...capabilityIndex.entries()].find(([candidate]) => key.includes(candidate))?.[1] ??
    null
  );
}

function modelLimitSummaries(sessionDir, llmRequests) {
  const capabilityIndex = modelCapabilityIndex(sessionDir);
  if (!capabilityIndex.size || !llmRequests.length) {
    return [];
  }

  const byModel = new Map();

  for (const event of llmRequests) {
    const rawModel = String(event.attrs?.model ?? '')
      .replace(/^copilot\//i, '')
      .trim();
    const displayModel = normalizeModel(rawModel, pricing);
    const capability = modelCapabilityFor(rawModel || displayModel, capabilityIndex);
    const limits = capability?.capabilities?.limits ?? {};
    const supports = capability?.capabilities?.supports ?? {};
    const current = byModel.get(displayModel) ?? {
      model: displayModel,
      rawModels: new Set(),
      modelId: capability?.id ?? rawModel,
      vendor: capability?.vendor ?? '',
      tokenizer: capability?.capabilities?.tokenizer ?? '',
      contextWindowTokens: Number(limits.max_context_window_tokens ?? 0) || 0,
      promptLimitTokens: Number(limits.max_prompt_tokens ?? 0) || 0,
      outputLimitTokens: Number(limits.max_output_tokens ?? 0) || 0,
      supportedReasoningEfforts: Array.isArray(supports.reasoning_effort)
        ? supports.reasoning_effort
        : [],
      supportedEndpoints: Array.isArray(capability?.supported_endpoints)
        ? capability.supported_endpoints
        : [],
      modelPickerEnabled: Boolean(capability?.model_picker_enabled),
      isChatDefault: Boolean(capability?.is_chat_default),
      isChatFallback: Boolean(capability?.is_chat_fallback),
      modelCalls: 0,
      largestRawInputTokens: 0,
      totalRawInputTokens: 0,
      largestOutputTokens: 0,
    };

    current.rawModels.add(rawModel || 'unknown');
    current.modelCalls += 1;
    current.largestRawInputTokens = Math.max(
      current.largestRawInputTokens,
      Number(event.attrs?.inputTokens ?? 0),
    );
    current.totalRawInputTokens += Number(event.attrs?.inputTokens ?? 0);
    current.largestOutputTokens = Math.max(
      current.largestOutputTokens,
      Number(event.attrs?.outputTokens ?? 0),
    );
    byModel.set(displayModel, current);
  }

  return [...byModel.values()].map((summary) => ({
    ...summary,
    rawModels: [...summary.rawModels],
    promptLimitShare:
      summary.promptLimitTokens > 0
        ? summary.largestRawInputTokens / summary.promptLimitTokens
        : null,
    contextWindowShare:
      summary.contextWindowTokens > 0
        ? summary.largestRawInputTokens / summary.contextWindowTokens
        : null,
    repeatedInputFactor:
      summary.largestRawInputTokens > 0
        ? summary.totalRawInputTokens / summary.largestRawInputTokens
        : 0,
  }));
}

function toolName(tool) {
  return String(tool?.function?.name ?? tool?.name ?? tool?.toolName ?? tool?.id ?? 'unknown_tool');
}

function toolSchemaSize(tool) {
  const descriptionChars = charLength(tool?.function?.description ?? tool?.description);
  const parameterChars = charLength(
    tool?.function?.parameters ?? tool?.parameters ?? tool?.input_schema,
  );

  return {
    name: toolName(tool),
    descriptionChars,
    parameterChars,
    totalChars: charLength(tool),
  };
}

function requestOptions(event) {
  const parsed = parseMaybeJson(event.attrs?.requestOptions);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function reasoningEffort(event) {
  return String(requestOptions(event)?.reasoning?.effort ?? '').trim();
}

function textVerbosity(event) {
  return String(requestOptions(event)?.text?.verbosity ?? '').trim();
}

function requestShapeMetadata(event) {
  const shape = parseMaybeJson(event.attrs?.requestShape);

  if (!shape || typeof shape !== 'object') {
    return null;
  }

  return {
    api: shape.api ? String(shape.api) : '',
    inputItemCount: Number(shape.inputItemCount ?? 0),
    inputItemTypes: Array.isArray(shape.inputItemTypes)
      ? shape.inputItemTypes.filter(Boolean).map(String)
      : [],
    hasPreviousResponseId: Boolean(shape.hasPreviousResponseId),
  };
}

function requestShapeSummary(event) {
  const shape = requestShapeMetadata(event);
  if (!shape) {
    return '';
  }

  const parts = [
    shape.api ? `api: ${shape.api}` : '',
    shape.inputItemCount
      ? `${shape.inputItemCount.toLocaleString()} input item${shape.inputItemCount === 1 ? '' : 's'}`
      : '',
    shape.inputItemTypes.length ? `types: ${shape.inputItemTypes.join(', ')}` : '',
    shape.hasPreviousResponseId ? 'continues previous response' : '',
  ].filter(Boolean);

  return parts.join(' · ');
}

function countedValues(values) {
  const counts = new Map();

  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function toolPayloadSummary(toolEvents) {
  const byName = new Map();

  for (const event of toolEvents) {
    const name = String(
      event.data?.toolName ?? event.attrs?.toolName ?? event.name ?? event.type ?? 'tool',
    );
    const current = byName.get(name) ?? { name, calls: 0, argsChars: 0, resultChars: 0 };
    current.calls += 1;
    current.argsChars += charLength(
      event.attrs?.args ??
        event.attrs?.arguments ??
        event.attrs?.input ??
        event.data?.args ??
        event.data?.arguments ??
        event.data?.input,
    );
    current.resultChars += charLength(
      event.attrs?.result ??
        event.attrs?.output ??
        event.attrs?.stdout ??
        event.data?.result ??
        event.data?.output ??
        event.data?.stdout,
    );
    byName.set(name, current);
  }

  return [...byName.values()]
    .sort(
      (a, b) =>
        b.resultChars + b.argsChars - (a.resultChars + a.argsChars) || a.name.localeCompare(b.name),
    )
    .slice(0, 12);
}

function requestPayloadSummary(sessionDir, llmRequests, toolEvents) {
  const systemPromptFiles = [
    ...new Set(llmRequests.map((event) => event.attrs?.systemPromptFile).filter(Boolean)),
  ];
  const toolsFiles = [
    ...new Set(llmRequests.map((event) => event.attrs?.toolsFile).filter(Boolean)),
  ];
  const systemPrompts = systemPromptFiles
    .map((file) => sessionSideFilePath(sessionDir, file))
    .filter(Boolean)
    .filter(existsSync)
    .map(parseContentFile);
  const toolFileSummaries = toolsFiles
    .map((file) => sessionSideFilePath(sessionDir, file))
    .filter(Boolean)
    .filter(existsSync)
    .map(parseContentFile);
  const tools = toolFileSummaries.flatMap((summary) =>
    Array.isArray(summary.content) ? summary.content : [],
  );
  const toolSchemas = tools.map(toolSchemaSize);
  const mcpToolNames = toolSchemas
    .map((tool) => tool.name)
    .filter((name) => name.startsWith('mcp_'));
  const reasoningEfforts = countedValues(llmRequests.map(reasoningEffort)).map(
    ({ value, count }) => ({
      effort: value,
      count,
    }),
  );
  const subagentLogCount = listFiles(sessionDir, '.jsonl').filter((file) =>
    basename(file).startsWith('runSubagent-'),
  ).length;

  return {
    systemPromptFiles: systemPrompts.length,
    systemPromptChars: systemPrompts.reduce((sum, summary) => sum + summary.chars, 0),
    toolSchemaFiles: toolFileSummaries.length,
    toolSchemaChars: toolFileSummaries.reduce((sum, summary) => sum + summary.chars, 0),
    toolCount: toolSchemas.length,
    mcpToolCount: mcpToolNames.length,
    mcpToolNames: [...new Set(mcpToolNames)].sort(),
    largestToolSchemas: toolSchemas.sort((a, b) => b.totalChars - a.totalChars).slice(0, 8),
    modelCallsWithSystemPromptFile: llmRequests.filter((event) => event.attrs?.systemPromptFile)
      .length,
    modelCallsWithToolsFile: llmRequests.filter((event) => event.attrs?.toolsFile).length,
    reasoningEfforts,
    toolResultCharsByName: toolPayloadSummary(toolEvents),
    subagentLogCount,
  };
}

function contentSummaryFromCache(sessionDir, cache, file) {
  if (!file) {
    return null;
  }

  if (cache.has(file)) {
    return cache.get(file);
  }

  const path = sessionSideFilePath(sessionDir, file);
  const summary = existsSync(path) ? parseContentFile(path) : null;
  cache.set(file, summary);
  return summary;
}

function modelCallSetupPayloadFactory(sessionDir) {
  const cache = new Map();

  return (event) => {
    if (event.type !== 'llm_request') {
      return null;
    }

    const systemPromptFile = String(event.attrs?.systemPromptFile ?? '').trim();
    const toolsFile = String(event.attrs?.toolsFile ?? '').trim();

    if (!systemPromptFile && !toolsFile) {
      return null;
    }

    const systemPrompt = contentSummaryFromCache(sessionDir, cache, systemPromptFile);
    const toolsSummary = contentSummaryFromCache(sessionDir, cache, toolsFile);
    const tools = Array.isArray(toolsSummary?.content) ? toolsSummary.content : [];
    const toolSchemas = tools.map(toolSchemaSize);
    const mcpToolNames = toolSchemas
      .map((tool) => tool.name)
      .filter((name) => name.startsWith('mcp_'));

    return {
      systemPromptFile,
      systemPromptChars: systemPrompt?.chars ?? 0,
      toolsFile,
      toolSchemaChars: toolsSummary?.chars ?? 0,
      toolCount: toolSchemas.length,
      mcpToolCount: mcpToolNames.length,
      mcpToolNames: [...new Set(mcpToolNames)].sort(),
      largestToolSchemas: toolSchemas.sort((a, b) => b.totalChars - a.totalChars).slice(0, 5),
    };
  };
}

function debugEvidence(llmRequests, agentResponses) {
  const inputSeries = llmRequests.map((event) => Number(event.attrs?.inputTokens ?? 0));
  const outputCaps = [
    ...new Set(
      llmRequests.map((event) => Number(event.attrs?.maxTokens ?? 0)).filter((value) => value > 0),
    ),
  ].sort((a, b) => a - b);
  const maxInputTokens = Math.max(0, ...inputSeries);
  const maxRequestTokens = Math.max(0, ...outputCaps);
  const reasoningEvents = agentResponses.filter((event) =>
    String(event.attrs?.reasoning ?? '').trim(),
  ).length;
  const efforts = countedValues(llmRequests.map(reasoningEffort));
  const primaryEffort = efforts[0]?.value ?? '';

  return {
    reasoning: {
      visible: reasoningEvents > 0 || Boolean(primaryEffort),
      level: primaryEffort,
      events: reasoningEvents,
      source: primaryEffort
        ? 'llm_request.attrs.requestOptions.reasoning.effort'
        : reasoningEvents > 0
          ? 'agent_response.attrs.reasoning'
          : '',
      help: primaryEffort
        ? 'VS Code Agent Debug Logs expose the request reasoning effort in llm_request.attrs.requestOptions.reasoning.effort.'
        : reasoningEvents > 0
          ? 'VS Code debug logs include reasoning text on agent_response events, but no request reasoning effort was imported.'
          : 'No reasoning text field was present on imported agent_response events.',
    },
    context: {
      maxInputTokens,
      maxRequestTokens,
      outputCaps,
      requestCapShare: maxRequestTokens > 0 ? maxInputTokens / maxRequestTokens : null,
      source:
        maxRequestTokens > 0
          ? 'llm_request.attrs.inputTokens and attrs.maxTokens'
          : 'llm_request.attrs.inputTokens',
      help:
        maxRequestTokens > 0
          ? 'Compares the largest observed input token count with the request maxTokens field present in VS Code debug logs. This is an observed pressure signal, not a provider context-window guarantee.'
          : 'Largest observed model input token count. The log did not include a request cap to compare against.',
    },
  };
}

export function modelBreakdownFromLlmRequests(llmRequests) {
  const byModel = new Map();

  for (const event of llmRequests) {
    const rawModel = String(event.attrs?.model ?? 'unknown')
      .replace(/^copilot\//i, '')
      .trim();
    const displayModel = normalizeModel(rawModel, pricing);
    const current = byModel.get(displayModel) ?? {
      model: displayModel,
      rawModels: new Set(),
      turns: 0,
      tokens: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
      cost: { usd: 0, eur: 0 },
      costBreakdown: { inputUsd: 0, cachedInputUsd: 0, cacheWriteUsd: 0, outputUsd: 0 },
      pricingTiers: new Set(),
      pricingModel: pricingModelForModel(displayModel, pricing, fallbackPricingModel),
    };

    current.rawModels.add(rawModel || 'unknown');
    current.turns += 1;
    const tokenFields = llmTokenFields(event);
    current.tokens.input += tokenFields.billableInputTokens;
    current.tokens.cachedInput += tokenFields.cachedInputTokens;
    current.tokens.cacheWrite += tokenFields.cacheWriteTokens;
    current.tokens.output += tokenFields.outputTokens;
    const callCost = costBreakdownUsd(current.pricingModel, {
      input: tokenFields.billableInputTokens,
      cachedInput: tokenFields.cachedInputTokens,
      cacheWrite: tokenFields.cacheWriteTokens,
      output: tokenFields.outputTokens,
    });
    current.costBreakdown.inputUsd += callCost.input;
    current.costBreakdown.cachedInputUsd += callCost.cachedInput;
    current.costBreakdown.cacheWriteUsd += callCost.cacheWrite;
    current.costBreakdown.outputUsd += callCost.output;
    current.pricingTiers.add(callCost.tier);
    byModel.set(displayModel, current);
  }

  return [...byModel.values()].map((entry) => {
    const usd =
      entry.costBreakdown.inputUsd +
      entry.costBreakdown.cachedInputUsd +
      entry.costBreakdown.cacheWriteUsd +
      entry.costBreakdown.outputUsd;
    return {
      ...entry,
      rawModels: [...entry.rawModels],
      pricingTiers: [...entry.pricingTiers],
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

  return normalizeModel(fallbackModel, pricing);
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
    return `${event.attrs?.model ?? 'model'}: ${Number(event.attrs?.inputTokens ?? 0).toLocaleString()} raw in / ${Number(
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

function boundedText(value, maxLength = 260) {
  const compact = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function summaryValue(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return boundedText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return boundedText(JSON.stringify(compactObject(value)));
}

function sourceEstimatedCost(event) {
  return summaryValue(event.attrs?.estimatedCost);
}

function sourceUsageFromNanoAiu(event) {
  const nanoAiu = Number(event.attrs?.copilotUsageNanoAiu ?? 0);
  if (!Number.isFinite(nanoAiu) || nanoAiu <= 0) {
    return null;
  }

  const credits = nanoAiu / 1_000_000_000;

  return {
    nanoAiu,
    credits,
    usd: credits * 0.01,
    modelCalls: 1,
  };
}

function sourceUsageSummary(llmRequests) {
  const usages = llmRequests.map(sourceUsageFromNanoAiu).filter(Boolean);
  const nanoAiu = usages.reduce((sum, usage) => sum + usage.nanoAiu, 0);
  const credits = nanoAiu / 1_000_000_000;

  return {
    nanoAiu,
    credits,
    usd: credits * 0.01,
    modelCalls: usages.length,
  };
}

function compactObject(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result = {};
  const skip = new Set(['content', 'response', 'result', 'output', 'stdout', 'stderr']);

  for (const [key, nestedValue] of Object.entries(value)) {
    if (skip.has(key)) {
      continue;
    }

    if (nestedValue === undefined || nestedValue === null) {
      continue;
    }

    result[key] =
      typeof nestedValue === 'object'
        ? boundedText(JSON.stringify(nestedValue), 120)
        : boundedText(nestedValue, 120);

    if (Object.keys(result).length >= 6) {
      break;
    }
  }

  return result;
}

function eventAttributeSummary(event) {
  const attrs = event.attrs ?? {};
  const data = event.data ?? {};
  const candidates = [
    ['category', attrs.category],
    ['source', attrs.source],
    ['model', attrs.model],
    ['debugName', attrs.debugName],
    ['inputTokens', attrs.inputTokens],
    ['cachedTokens', attrs.cachedTokens ?? attrs.cachedInputTokens ?? attrs.cacheReadTokens],
    ['cacheWriteTokens', attrs.cacheWriteTokens ?? attrs.cachedWriteTokens],
    ['outputTokens', attrs.outputTokens],
    ['sourceEstimatedCost', attrs.estimatedCost],
    ['copilotUsageNanoAiu', attrs.copilotUsageNanoAiu],
    ['reasoningEffort', event.type === 'llm_request' ? reasoningEffort(event) : undefined],
    ['textVerbosity', event.type === 'llm_request' ? textVerbosity(event) : undefined],
    ['requestShape', event.type === 'llm_request' ? requestShapeSummary(event) : undefined],
    ['maxTokens', attrs.maxTokens],
    ['ttft', attrs.ttft],
    ['systemPromptFile', attrs.systemPromptFile],
    ['toolsFile', attrs.toolsFile],
    ['vscodeVersion', attrs.vscodeVersion],
    ['copilotVersion', attrs.copilotVersion],
    ['responseId', attrs.responseId],
    ['logVersion', event.v],
    ['toolName', data.toolName ?? attrs.toolName],
    ['details', attrs.details],
    ['content', attrs.content],
    [
      'response',
      event.type === 'agent_response' ? parseAssistantResponse(attrs.response) : undefined,
    ],
    ['data', data && Object.keys(data).length ? data : undefined],
  ];

  const fields = [];
  const seen = new Set();

  for (const [label, value] of candidates) {
    const summarized = summaryValue(value);

    if (!summarized || seen.has(label)) {
      continue;
    }

    fields.push({ label, value: summarized });
    seen.add(label);

    if (fields.length >= 8) {
      break;
    }
  }

  return fields;
}

function capTraceEvents(events) {
  return events.slice(0, traceEventLimit);
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

export function sessionFromDebugLog(sessionDir, workspaceDir) {
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
  const input = llmRequests.reduce(
    (sum, event) => sum + llmTokenFields(event).billableInputTokens,
    0,
  );
  const cachedInput = llmRequests.reduce(
    (sum, event) => sum + llmTokenFields(event).cachedInputTokens,
    0,
  );
  const cacheWrite = llmRequests.reduce(
    (sum, event) => sum + llmTokenFields(event).cacheWriteTokens,
    0,
  );
  const output = llmRequests.reduce((sum, event) => sum + llmTokenFields(event).outputTokens, 0);
  const tokens = { input, cachedInput, cacheWrite, output };
  const usd = modelBreakdown.length
    ? modelBreakdown.reduce((sum, entry) => sum + entry.cost.usd, 0)
    : costUsd(model, tokens);
  const startEvent = main.find((event) => event.type === 'session_start') ?? main[0];
  const debugLogRuntime = {
    logVersion: Number(startEvent?.v ?? 0) || 0,
    vscodeVersion: String(startEvent?.attrs?.vscodeVersion ?? '').trim(),
    copilotVersion: String(startEvent?.attrs?.copilotVersion ?? '').trim(),
  };
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
  const evidence = debugEvidence(llmRequests, assistantEvents, main);
  const payload = requestPayloadSummary(sessionDir, llmRequests, toolEvents);
  const modelLimits = modelLimitSummaries(sessionDir, llmRequests);
  const cacheTokenAudit = cacheTokenAuditFromLlmRequests(llmRequests);
  const sourceUsage = sourceUsageSummary(llmRequests);
  const setupPayloadForEvent = modelCallSetupPayloadFactory(sessionDir);
  const transcript = transcriptAvailability(workspaceDir, sid);
  const memoryRecalls = memoryRecallsFromDebugLog(sessionDir, workspaceName(workspaceDir));

  if (transcript.available) {
    diagnostics.debugLogSessionsWithTranscripts += 1;
    diagnostics.transcriptEventsAvailable += transcript.eventCount;
  }

  if (cacheTokenAudit.invalidCachedTokenSplits > 0) {
    diagnostics.warnings.push(
      `${sessionDir}: ${cacheTokenAudit.invalidCachedTokenSplits} model call(s) reported cachedTokens greater than inputTokens; cached input was clamped for pricing safety`,
    );
  }

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
    ...(debugLogRuntime.logVersion ||
    debugLogRuntime.vscodeVersion ||
    debugLogRuntime.copilotVersion
      ? { debugLogRuntime }
      : {}),
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
      totalTokens: input + cachedInput + cacheWrite + output,
      errors: errorEvents.length,
      totalEvents: main.length,
      reasoningEvents: evidence.reasoning.events,
      maxInputTokens: evidence.context.maxInputTokens,
      maxRequestTokens: evidence.context.maxRequestTokens,
      reasoningEfforts: payload.reasoningEfforts,
    },
    cacheTokenAudit,
    ...(sourceUsage.modelCalls > 0 ? { sourceUsage } : {}),
    transcript,
    advancedSignals: evidence,
    requestPayload: payload,
    modelLimits,
    ...(memoryRecalls.length ? { memoryRecalls } : {}),
    traceEvents: capTraceEvents(
      main.map((event, index) => {
        const tokenFields =
          event.type === 'llm_request'
            ? llmTokenFields(event)
            : {
                inputTokens: 0,
                billableInputTokens: 0,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
                outputTokens: 0,
              };

        const setupPayload = setupPayloadForEvent(event);
        const sourceUsage = sourceUsageFromNanoAiu(event);
        const requestShape = event.type === 'llm_request' ? requestShapeMetadata(event) : null;

        return {
          index,
          timestamp: timestampForEvent(event),
          type: String(event.type ?? 'unknown'),
          name: String(event.name ?? event.type ?? 'unknown'),
          status: String(event.status ?? 'unknown'),
          detail: eventDetail(event),
          attributes: eventAttributeSummary(event),
          inputTokens: tokenFields.inputTokens,
          cachedInputTokens: tokenFields.cachedInputTokens,
          cacheWriteTokens: tokenFields.cacheWriteTokens,
          outputTokens: tokenFields.outputTokens,
          ttftMs: event.type === 'llm_request' ? Number(event.attrs?.ttft ?? 0) : 0,
          maxTokens: event.type === 'llm_request' ? Number(event.attrs?.maxTokens ?? 0) : 0,
          hasReasoning:
            event.type === 'agent_response' && Boolean(String(event.attrs?.reasoning ?? '').trim()),
          reasoningEffort: event.type === 'llm_request' ? reasoningEffort(event) : '',
          ...(requestShape ? { requestShape } : {}),
          ...(event.type === 'llm_request'
            ? eventModelCostFields(event.attrs?.model, tokenFields)
            : {}),
          ...(event.type === 'llm_request' && sourceEstimatedCost(event)
            ? { sourceEstimatedCost: sourceEstimatedCost(event) }
            : {}),
          ...(sourceUsage ? { sourceUsage } : {}),
          ...(setupPayload ? { setupPayload } : {}),
        };
      }),
    ),
    turns: turns.slice(0, 60),
  };
}

export function sessionFromChatSnapshot(file, workspaceDir) {
  const records = readJsonl(file);
  const snapshot =
    records.find((record) => record.kind === 0 && record.v?.requests)?.v ??
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
    pricing,
  );
  const output = requests.reduce((sum, request) => sum + Number(request.completionTokens ?? 0), 0);
  const input = requests.reduce(
    (sum, request) => sum + estimateTokens(request?.message?.text ?? ''),
    0,
  );
  const tokens = { input, cachedInput: 0, cacheWrite: 0, output };
  const usd = costUsd(model, tokens);
  const pricingModel = pricingModelForModel(model, pricing, fallbackPricingModel);
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
        pricingModel,
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
      reasoningEvents: 0,
      maxInputTokens: input,
      maxRequestTokens: 0,
    },
    cacheTokenAudit: {
      modelCalls: 0,
      callsWithCachedTokens: 0,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 0,
      normalInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      maxCachedInputShare: 0,
    },
    transcript: {
      available: false,
      sourcePath: '',
      eventCount: 0,
    },
    advancedSignals: {
      reasoning: {
        visible: false,
        level: '',
        events: 0,
        source: '',
        help: 'Chat snapshots do not expose agent_response reasoning text or a reasoning-level field.',
      },
      context: {
        maxInputTokens: input,
        maxRequestTokens: 0,
        outputCaps: [],
        requestCapShare: null,
        source: 'estimated visible chat text',
        help: 'Chat snapshots only provide visible text context here, so context pressure is not reliable for cost debugging.',
      },
    },
    traceEvents: capTraceEvents(
      requests.flatMap((request, index) => {
        const rawRequestModel =
          request?.modelId ?? request?.inputState?.selectedModel?.identifier ?? model;
        const userInputTokens = estimateTokens(request?.message?.text ?? '');
        const assistantOutputTokens = Number(request.completionTokens ?? 0);

        return [
          {
            index: index * 2,
            timestamp: startedAt,
            type: 'user_message',
            name: 'user_message',
            status: 'ok',
            detail: String(request?.message?.text ?? '').slice(0, 140),
            inputTokens: userInputTokens,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            ...eventModelCostFields(rawRequestModel, {
              inputTokens: userInputTokens,
              billableInputTokens: userInputTokens,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 0,
            }),
          },
          {
            index: index * 2 + 1,
            timestamp: endedAt,
            type: 'assistant_response',
            name: 'assistant_response',
            status: 'ok',
            detail: `${assistantOutputTokens.toLocaleString()} completion tokens`,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: assistantOutputTokens,
            ...eventModelCostFields(rawRequestModel, {
              inputTokens: 0,
              billableInputTokens: 0,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: assistantOutputTokens,
            }),
          },
        ];
      }),
    ),
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

function parseWorkspace(workspaceDir, onProgress = () => {}) {
  diagnostics.scannedWorkspaces += 1;
  const debugRoot = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs');
  const debugSessionDirs = listDirs(debugRoot);
  const chatSessionFiles = listFiles(join(workspaceDir, 'chatSessions'), '.jsonl');
  const memoryRoot = join(workspaceDir, 'GitHub.copilot-chat', 'memory-tool', 'memories');
  const hasMemoryRoot = existsSync(memoryRoot);

  if (!debugSessionDirs.length && !chatSessionFiles.length && !hasMemoryRoot) {
    return {
      sessions: [],
      memories: [],
      customizations: [],
    };
  }

  const workspace = workspaceName(workspaceDir);
  onProgress({
    stage: 'workspace',
    message: `Scanning Copilot data for ${workspace}.`,
    workspace,
    workspaceDir,
  });
  const stateBySessionId =
    debugSessionDirs.length || chatSessionFiles.length ? readWorkspaceState(workspaceDir) : new Map();
  const customizationInventory = debugSessionDirs.length
    ? customizationsFromWorkspace(workspaceDir)
    : [];
  const customizations = debugSessionDirs.length
    ? customizationEvidenceFromDebugLogs(debugRoot, customizationInventory, workspace)
    : [];
  diagnostics.importedCustomizations += customizations.length;

  if (debugSessionDirs.length) {
    onProgress({
      stage: 'debug-logs',
      message: `Scanning ${debugSessionDirs.length} debug-log folder${debugSessionDirs.length === 1 ? '' : 's'} in ${workspace}.`,
      workspace,
      workspaceDir,
      total: debugSessionDirs.length,
    });
  }
  const debugSessions = [];
  for (const [index, sessionDir] of debugSessionDirs.entries()) {
    if (index > 0 && index % 25 === 0) {
      onProgress({
        stage: 'debug-logs',
        message: `Scanned ${index}/${debugSessionDirs.length} debug-log folders in ${workspace}.`,
        workspace,
        workspaceDir,
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
    onProgress({
      stage: 'chat-snapshots',
      message: `Scanning ${chatSessionFiles.length} chat snapshot${chatSessionFiles.length === 1 ? '' : 's'} in ${workspace}.`,
      workspace,
      workspaceDir,
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

  onProgress({
    stage: 'workspace-complete',
    message: `Workspace ${workspace}: imported ${debugSessions.length + chatSessions.length} session${debugSessions.length + chatSessions.length === 1 ? '' : 's'}.`,
    workspace,
    workspaceDir,
    sessions: debugSessions.length + chatSessions.length,
  });

  return {
    sessions: [...debugSessions, ...chatSessions],
    memories: memoriesFromRoot(memoryRoot, 'workspace', workspace),
    customizations,
  };
}

function workspaceDirsFromUserDir(userDir) {
  const workspaceStorage = join(userDir, 'workspaceStorage');
  return listDirs(workspaceStorage);
}

function workspaceDirsForRoot(root) {
  if (existsSync(join(root, 'workspace.json'))) {
    return [root];
  }
  if (basename(root) === 'workspaceStorage') {
    return listDirs(root);
  }
  return workspaceDirsFromUserDir(root);
}

function userDirForRoot(root) {
  if (existsSync(join(root, 'workspaceStorage'))) {
    return root;
  }
  if (basename(root) === 'workspaceStorage') {
    return dirname(root);
  }
  if (basename(dirname(root)) === 'workspaceStorage') {
    return dirname(dirname(root));
  }
  return null;
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
  const roots = [...new Set(configuredRoots.map((root) => resolve(String(root))))];
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

  try {
    onProgress({
      stage: 'roots',
      message: `Scanning ${roots.length} VS Code root${roots.length === 1 ? '' : 's'}.`,
      roots,
    });
    DatabaseSync = options.sqlite === false ? null : await loadSqliteSupport();
    const workspaceDirs = [...new Set(roots.flatMap(workspaceDirsForRoot))];
    onProgress({
      stage: 'workspaces',
      message: `Found ${workspaceDirs.length} VS Code workspace storage folder${workspaceDirs.length === 1 ? '' : 's'}.`,
      total: workspaceDirs.length,
    });
    const workspaceResults = [];
    for (const [index, workspaceDir] of workspaceDirs.entries()) {
      if (index > 0 && index % 50 === 0) {
        onProgress({
          stage: 'workspace-queue',
          message: `Checked ${index}/${workspaceDirs.length} VS Code workspace storage folders.`,
          index,
          total: workspaceDirs.length,
        });
      }
      workspaceResults.push(parseWorkspace(workspaceDir, onProgress));
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
      message: `Indexing memories from ${globalMemoryRoots.length} global root${globalMemoryRoots.length === 1 ? '' : 's'} and workspace storage.`,
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
      customizationMap.set(customization.id, customization);
    }
    const customizations = [...customizationMap.values()].sort(
      (a, b) =>
        statusRank(b.evidenceStatus) - statusRank(a.evidenceStatus) ||
        b.modifiedAt.localeCompare(a.modifiedAt),
    );
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

export function writeSessionData(sessionData, outputFile = 'public/data/sessions.json') {
  const resolvedOutputFile = resolve(outputFile);
  mkdirSync(dirname(resolvedOutputFile), { recursive: true });
  writeFileSync(resolvedOutputFile, JSON.stringify(sessionData, null, 2));
  return resolvedOutputFile;
}

export async function runScannerCli(args = process.argv.slice(2), logger = console) {
  const outputFile = args[0] ?? 'public/data/sessions.json';
  const roots = args.slice(1);
  const sessionData = await scanVsCodeSessions(roots.length ? { roots } : {});
  const resolvedOutputFile = writeSessionData(sessionData, outputFile);

  logger.log(`Wrote ${sessionData.sessions.length} sessions to ${resolvedOutputFile}`);
  return sessionData;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runScannerCli();
}
