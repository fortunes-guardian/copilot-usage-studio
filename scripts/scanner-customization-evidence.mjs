import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function timestampForEvent(event) {
  return event?.timestamp ?? new Date(Number(event?.ts ?? 0)).toISOString();
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

function escapeRegExpLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCustomizationChunkMatchers(matchState) {
  const chunkOwners = new Map();
  for (const [customizationId, state] of matchState.entries()) {
    for (const chunk of state.chunks) {
      if (!chunkOwners.has(chunk)) {
        chunkOwners.set(chunk, []);
      }
      chunkOwners.get(chunk).push(customizationId);
    }
  }

  const chunks = [...chunkOwners.keys()].sort((a, b) => b.length - a.length);
  const matchers = [];
  let patternParts = [];
  let patternLength = 0;
  const maxPatternLength = 150_000;

  const flush = () => {
    if (!patternParts.length) {
      return;
    }
    matchers.push({
      regex: new RegExp(patternParts.join('|'), 'g'),
      chunkOwners,
    });
    patternParts = [];
    patternLength = 0;
  };

  for (const chunk of chunks) {
    const escaped = escapeRegExpLiteral(chunk);
    if (patternParts.length && patternLength + escaped.length > maxPatternLength) {
      flush();
    }
    patternParts.push(escaped);
    patternLength += escaped.length + 1;
  }
  flush();

  return matchers;
}

function matchedChunksByCustomization(text, chunkMatchers) {
  if (!text || !chunkMatchers.length) {
    return new Map();
  }

  const matchesByCustomization = new Map();
  for (const matcher of chunkMatchers) {
    matcher.regex.lastIndex = 0;
    let match;
    while ((match = matcher.regex.exec(text)) !== null) {
      const chunk = match[0];
      for (const customizationId of matcher.chunkOwners.get(chunk) ?? []) {
        if (!matchesByCustomization.has(customizationId)) {
          matchesByCustomization.set(customizationId, new Set());
        }
        matchesByCustomization.get(customizationId).add(chunk);
      }
      if (match[0] === '') {
        matcher.regex.lastIndex += 1;
      }
    }
  }

  return new Map(
    [...matchesByCustomization.entries()].map(([customizationId, chunks]) => [
      customizationId,
      [...chunks],
    ]),
  );
}

function matchedChunkPreview(chunks) {
  return [...new Set(chunks)]
    .slice(0, 2)
    .map((chunk) => chunk.length > 220 ? `${chunk.slice(0, 217)}...` : chunk);
}

function extractPayloadText(value, depth = 0) {
  if (value === null || value === undefined || depth > 8) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const parsed = trimmed && /^[\[{"]/.test(trimmed) ? safeJson(trimmed) : null;
    return parsed === null || parsed === value
      ? value
      : `${value}\n${extractPayloadText(parsed, depth + 1)}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractPayloadText(item, depth + 1)).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    return Object.values(value)
      .map((item) => extractPayloadText(item, depth + 1))
      .filter(Boolean)
      .join('\n');
  }
  return '';
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

function readRequestSideFile(sessionDir, file, sideFileCache = new Map()) {
  const sideFilePath = sessionSideFilePath(sessionDir, String(file ?? '').trim());
  if (!sideFilePath || !existsSync(sideFilePath)) {
    return '';
  }
  if (sideFileCache.has(sideFilePath)) {
    return sideFileCache.get(sideFilePath);
  }
  const text = extractPayloadText(readFileSync(sideFilePath, 'utf8'));
  sideFileCache.set(sideFilePath, text);
  return text;
}

function requestTextParts(sessionDir, event, sideFileCache = new Map()) {
  const parts = [
    { source: 'inputMessages', text: extractPayloadText(event.attrs?.inputMessages) },
    { source: 'userRequest', text: extractPayloadText(event.attrs?.userRequest) },
  ];

  for (const fileField of ['systemPromptFile', 'toolsFile']) {
    const file = String(event.attrs?.[fileField] ?? '').trim();
    const text = readRequestSideFile(sessionDir, file, sideFileCache);
    if (text) {
      parts.push({ source: file, text });
    }
  }

  return parts.map((part) => ({
    ...part,
    normalized: normalizeMatchText(part.text),
  }));
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

export function statusRank(status) {
  return {
    sent: 3,
    listed: 2,
    discovered: 1,
    not_seen: 0,
  }[status] ?? 0;
}

export function mergeCustomizationRecords(existing, next) {
  if (!existing) {
    return next;
  }

  const status = statusRank(next.evidenceStatus) > statusRank(existing.evidenceStatus)
    ? next.evidenceStatus
    : existing.evidenceStatus;
  const matchMap = new Map();
  for (const match of [...(existing.matches ?? []), ...(next.matches ?? [])]) {
    const key = [
      match.sessionId,
      match.eventIndex,
      match.modelCallNumber,
      match.source,
      match.status,
    ].join(':');
    matchMap.set(key, match);
  }
  const matches = [...matchMap.values()]
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || b.timestamp.localeCompare(a.timestamp))
    .slice(0, 60);

  return {
    ...existing,
    evidenceStatus: status,
    matches,
    modifiedAt: next.modifiedAt > existing.modifiedAt ? next.modifiedAt : existing.modifiedAt,
  };
}

function recordCustomizationMatch(state, match) {
  state.matches.push(match);
  state.matches.sort(
    (a, b) => statusRank(b.status) - statusRank(a.status) || b.timestamp.localeCompare(a.timestamp),
  );
  state.matches = state.matches.slice(0, 60);
}

export function customizationEvidenceFromDebugLogs(
  debugRoot,
  customizations,
  workspace = '',
  workspaceDir = '',
  onProgress = () => {},
  context = {},
) {
  const diagnostics = context.diagnostics ?? {
    customizationEvidenceScannedSessions: 0,
    customizationEvidenceModelCalls: 0,
    customizationEvidenceTextParts: 0,
    customizationEvidenceMatchedCustomizations: 0,
  };
  const listDirs = context.listDirs ?? (() => []);
  const readJsonl = context.readJsonl ?? (() => []);

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
  const chunkMatchers = buildCustomizationChunkMatchers(matchState);

  const sessionDirs = listDirs(debugRoot);
  for (const [sessionIndex, sessionDir] of sessionDirs.entries()) {
    diagnostics.customizationEvidenceScannedSessions += 1;
    if (sessionIndex > 0 && sessionIndex % 25 === 0) {
      onProgress({
        stage: 'customization-evidence',
        message: `Checked customization evidence in ${sessionIndex}/${sessionDirs.length} debug-log folders for ${workspace}.`,
        workspace,
        workspaceDir,
        index: sessionIndex,
        total: sessionDirs.length,
      });
    }
    const sessionId = basename(sessionDir);
    const main = readJsonl(join(sessionDir, 'main.jsonl'));
    const sideFileCache = new Map();
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
      const requestParts =
        event.type === 'llm_request' ? requestTextParts(sessionDir, event, sideFileCache) : [];
      if (event.type === 'llm_request') {
        diagnostics.customizationEvidenceModelCalls += 1;
        diagnostics.customizationEvidenceTextParts += requestParts.filter((part) => part.normalized).length;
      }
      const matchedChunksForParts = new Map();
      for (const customization of customizations) {
        const state = matchState.get(customization.id);
        if (!state) {
          continue;
        }

        if (event.type === 'llm_request') {
          for (const part of requestParts) {
            let allPartMatches = matchedChunksForParts.get(part.source);
            if (!allPartMatches) {
              allPartMatches = matchedChunksByCustomization(part.normalized, chunkMatchers);
              matchedChunksForParts.set(part.source, allPartMatches);
            }
            const matchedChunks = allPartMatches.get(customization.id) ?? [];
            const listed = !matchedChunks.length && state.terms.some((term) => part.normalized.includes(term));
            if (!matchedChunks.length && !listed) {
              continue;
            }

            const rank = matchedChunks.length ? 3 : 2;
            if (rank === 3 && state.rank < 3) {
              diagnostics.customizationEvidenceMatchedCustomizations += 1;
            }
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
              matchedPreview: matchedChunkPreview(matchedChunks),
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
