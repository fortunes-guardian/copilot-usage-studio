import { existsSync, readFileSync, statSync } from 'node:fs';
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

function normalizedWordCount(value) {
  return normalizeMatchText(value).split(/\s+/).filter((word) => /[a-z]{2,}/.test(word)).length;
}

function isDistinctiveCustomizationChunk(chunk) {
  const normalized = normalizeMatchText(chunk);
  if (normalized.length < 56 || !/[a-z]/.test(normalized)) {
    return false;
  }
  if (normalizedWordCount(normalized) < 8) {
    return false;
  }
  if (/^(applyto|description|trigger|name|title)\s*[:=]/i.test(normalized)) {
    return false;
  }
  return true;
}

function customizationChunks(content) {
  const lineChunks = String(content ?? '')
    .split(/\r?\n/)
    .map(normalizeMatchText)
    .filter(isDistinctiveCustomizationChunk);
  const normalized = normalizeMatchText(content);
  const chunks = normalized
    .split(/\n{2,}|(?<=\.)\s+/)
    .map((chunk) => chunk.trim())
    .filter(isDistinctiveCustomizationChunk)
    .sort((a, b) => b.length - a.length);

  if (isDistinctiveCustomizationChunk(normalized)) {
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

function hasStrongContentMatch(chunks) {
  const unique = [...new Set(chunks.map(normalizeMatchText).filter(Boolean))];
  const totalCharacters = unique.reduce((sum, chunk) => sum + chunk.length, 0);
  const totalWords = unique.reduce((sum, chunk) => sum + normalizedWordCount(chunk), 0);
  return (
    unique.some((chunk) => chunk.length >= 120 && normalizedWordCount(chunk) >= 16) ||
    (unique.length >= 2 && totalCharacters >= 140 && totalWords >= 20)
  );
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
  ]
    .map(normalizeMatchText)
    .filter((value) => value.length >= 8);
}

function basenameCounts(customizations) {
  const counts = new Map();
  for (const customization of customizations) {
    const name = normalizeMatchText(basename(customization.sourcePath));
    if (!name) {
      continue;
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function readTermsForCustomization(customization, nameCounts) {
  const sourcePath = normalizeMatchText(customization.sourcePath);
  const relativePath = normalizeMatchText(customization.relativePath);
  const fileName = normalizeMatchText(basename(customization.sourcePath));
  const terms = [sourcePath, relativePath].filter((term) => term.length >= 8);
  if (fileName.length >= 8 && nameCounts.get(fileName) === 1) {
    terms.push(fileName);
  }
  return [...new Set(terms)];
}

function looksLikeFileReadEvidence(text) {
  return (
    /(?:\bread\b|read_file|reviewed|opened|summaris|summariz|loaded)/i.test(text) &&
    /\.(?:md|markdown|json|jsonc|ya?ml)\b/i.test(text)
  );
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

function initialMatchState(customization, fileNameCounts, previous) {
  const matches = previous?.matches ?? [];
  return {
    rank: statusRank(previous?.evidenceStatus),
    matches: [...matches],
    chunks: customizationChunks(customization._content),
    terms: customizationTerms(customization),
    readTerms: readTermsForCustomization(customization, fileNameCounts),
    readSessions: new Set(
      matches.filter((match) => statusRank(match.status) >= 2).map((match) => match.sessionId),
    ),
  };
}

function sourceChangedSince(path, since) {
  const sinceMs = Date.parse(String(since ?? ''));
  if (!Number.isFinite(sinceMs)) return true;
  try {
    return statSync(path).mtimeMs > sinceMs;
  } catch {
    return true;
  }
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
    customizationEvidenceCapReason: '',
  };
  const listDirs = context.listDirs ?? (() => []);
  const readJsonl = context.readJsonl ?? (() => []);
  const maxSessions = optionalPositiveLimit(context.maxSessions, 40);
  const maxModelCalls = optionalPositiveLimit(context.maxModelCalls, 300);
  const maxElapsedMs = optionalPositiveLimit(context.maxElapsedMs, 60_000);
  const maxPartChars = positiveInteger(context.maxPartChars, 250_000);
  const startedAt = Date.now();
  let cappedReason = '';

  if (!customizations.length || !existsSync(debugRoot)) {
    return customizations.map((customization) => {
      const { _content, ...publicCustomization } = customization;
      return { ...publicCustomization, evidenceStatus: 'not_seen', matches: [] };
    });
  }

  const fileNameCounts = basenameCounts(customizations);
  const previousById = new Map((context.previousEvidence ?? []).map((item) => [item.id, item]));
  const canIncrement = Boolean(context.incrementalSince) && customizations.every((customization) =>
    previousById.get(customization.id)?.contentHash === customization.contentHash);

  const matchState = new Map(
    customizations.map((customization) => [
      customization.id,
      initialMatchState(
        customization,
        fileNameCounts,
        canIncrement ? previousById.get(customization.id) : null,
      ),
    ]),
  );
  const chunkMatchers = buildCustomizationChunkMatchers(matchState);

  const allSessionDirs = listDirs(debugRoot);
  const candidateSessionDirs = canIncrement
    ? allSessionDirs.filter((sessionDir) =>
      sourceChangedSince(join(sessionDir, 'main.jsonl'), context.incrementalSince))
    : allSessionDirs;
  const sessionDirs = Number.isFinite(maxSessions)
    ? candidateSessionDirs.slice(0, maxSessions)
    : candidateSessionDirs;
  if (candidateSessionDirs.length > sessionDirs.length) {
    const sessionLimitReason = `limited to ${sessionDirs.length}/${candidateSessionDirs.length} changed debug-log folders`;
    diagnostics.warnings?.push?.(
      `Customization evidence scan for ${workspace || workspaceDir || debugRoot} ${sessionLimitReason}.`,
    );
  }

  onProgress({
    stage: 'customization-evidence',
    message: `Checking customization usage in recent Copilot sessions for ${workspace || 'current workspace'}.`,
    workspace,
    workspaceDir,
    index: 0,
    total: sessionDirs.length,
    sessions: 0,
    modelCalls: diagnostics.customizationEvidenceModelCalls,
    matches: diagnostics.customizationEvidenceMatchedCustomizations,
  });

  for (const [sessionIndex, sessionDir] of sessionDirs.entries()) {
    if (Number.isFinite(maxElapsedMs) && Date.now() - startedAt > maxElapsedMs) {
      cappedReason = `stopped after ${Math.round(maxElapsedMs / 1000)}s`;
      diagnostics.customizationEvidenceCapReason = cappedReason;
      diagnostics.warnings?.push?.(
        `Customization evidence scan for ${workspace || workspaceDir || debugRoot} ${cappedReason}.`,
      );
      onProgress({
        stage: 'customization-evidence',
        message: `Customization usage check reached the configured limit for ${workspace || 'current workspace'}.`,
        workspace,
        workspaceDir,
        index: sessionIndex,
        total: allSessionDirs.length,
        capped: true,
        reason: cappedReason,
        matches: diagnostics.customizationEvidenceMatchedCustomizations,
      });
      break;
    }

    diagnostics.customizationEvidenceScannedSessions += 1;
    onProgress({
      stage: 'customization-evidence',
      message: `Checking customization usage in recent Copilot sessions for ${workspace || 'current workspace'}.`,
      workspace,
      workspaceDir,
      index: sessionIndex + 1,
      total: sessionDirs.length,
      sessions: diagnostics.customizationEvidenceScannedSessions,
      modelCalls: diagnostics.customizationEvidenceModelCalls,
      matches: diagnostics.customizationEvidenceMatchedCustomizations,
    });
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
      if (Number.isFinite(maxModelCalls) && diagnostics.customizationEvidenceModelCalls >= maxModelCalls) {
        cappedReason = `limited to ${maxModelCalls} model calls`;
        diagnostics.customizationEvidenceCapReason = cappedReason;
        diagnostics.warnings?.push?.(
          `Customization evidence scan for ${workspace || workspaceDir || debugRoot} ${cappedReason}.`,
        );
        break;
      }
      const eventText = normalizeMatchText(`${event.name ?? ''} ${event.attrs?.details ?? ''}`);
      const requestParts =
        event.type === 'llm_request' ? requestTextParts(sessionDir, event, sideFileCache) : [];
      if (event.type === 'llm_request') {
        diagnostics.customizationEvidenceModelCalls += 1;
        diagnostics.customizationEvidenceTextParts += requestParts.filter((part) => part.normalized).length;
      } else {
        const readEvidenceText = normalizeMatchText(
          `${event.type ?? ''} ${event.name ?? ''} ${extractPayloadText(event.attrs)}`,
        );
        if (looksLikeFileReadEvidence(readEvidenceText)) {
          for (const state of matchState.values()) {
            if (!state.readTerms.some((term) => readEvidenceText.includes(term))) {
              continue;
            }
            if (!state.readSessions.has(sessionId)) {
              state.readSessions.add(sessionId);
              state.rank = Math.max(state.rank, 2);
              recordCustomizationMatch(state, {
                status: 'listed',
                sessionId,
                workspace,
                timestamp: timestampForEvent(event),
                eventIndex: index,
                modelCallNumber: 0,
                source: 'copilotFileRead',
                matchedChunks: 0,
                matchedCharacters: 0,
              });
            }
          }
        }
      }
      const matchedChunksForParts = new Map();
      for (const customization of customizations) {
        const state = matchState.get(customization.id);
        if (!state) {
          continue;
        }

        if (event.type === 'llm_request') {
          if (!state.readSessions.has(sessionId)) {
            continue;
          }
          for (const part of requestParts) {
            if (part.normalized.length > maxPartChars) {
              part.normalized = part.normalized.slice(0, maxPartChars);
            }
            let allPartMatches = matchedChunksForParts.get(part.source);
            if (!allPartMatches) {
              allPartMatches = matchedChunksByCustomization(part.normalized, chunkMatchers);
              matchedChunksForParts.set(part.source, allPartMatches);
            }
            const matchedChunks = allPartMatches.get(customization.id) ?? [];
            if (!matchedChunks.length || !hasStrongContentMatch(matchedChunks)) {
              continue;
            }

            const rank = 3;
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
      if (cappedReason) {
        break;
      }
    }
    if (cappedReason) {
      onProgress({
        stage: 'customization-evidence',
        message: `Customization usage check reached the configured limit for ${workspace || 'current workspace'}.`,
        workspace,
        workspaceDir,
        index: sessionIndex + 1,
        total: allSessionDirs.length,
        capped: true,
        reason: cappedReason,
        sessions: diagnostics.customizationEvidenceScannedSessions,
        modelCalls: diagnostics.customizationEvidenceModelCalls,
        matches: diagnostics.customizationEvidenceMatchedCustomizations,
      });
      break;
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

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function optionalPositiveLimit(value, fallback) {
  if (value === 0 || value === '0' || value === false || value === null) {
    return Number.POSITIVE_INFINITY;
  }
  return positiveInteger(value, fallback);
}
