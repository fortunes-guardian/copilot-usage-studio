import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { costUsdForTokens, normalizeModel } from './pricing-utils.mjs';

const file = resolve(process.argv[2] ?? 'public/data/sessions.json');
const sessionData = JSON.parse(readFileSync(file, 'utf8'));
const errors = [];
const warnings = [];
const ids = new Set();
const pricingData = JSON.parse(readFileSync(new URL('../data/github-copilot-pricing.json', import.meta.url), 'utf8'));
const pricing = pricingData.models;
const fallbackPricingModel = pricingData.fallbackModel;

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function expectedCostUsd(model, tokens) {
  return costUsdForTokens(model, tokens, pricing, fallbackPricingModel);
}

function emptyCacheTokenAudit() {
  return {
    modelCalls: 0,
    callsWithCachedTokens: 0,
    invalidCachedTokenSplits: 0,
    rawInputTokens: 0,
    normalInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    maxCachedInputShare: 0,
  };
}

function auditFromTraceEvents(traceEvents = []) {
  return traceEvents
    .filter((event) => event.type === 'llm_request')
    .reduce((audit, event) => {
      const rawInputTokens = Number(event.inputTokens ?? 0);
      const cachedInputTokens = Number(event.cachedInputTokens ?? 0);
      const cacheWriteTokens = Number(event.cacheWriteTokens ?? 0);
      const outputTokens = Number(event.outputTokens ?? 0);

      audit.modelCalls += 1;
      audit.rawInputTokens += rawInputTokens;
      audit.normalInputTokens += Math.max(0, rawInputTokens - cachedInputTokens);
      audit.cachedInputTokens += cachedInputTokens;
      audit.cacheWriteTokens += cacheWriteTokens;
      audit.outputTokens += outputTokens;

      if (cachedInputTokens > 0) {
        audit.callsWithCachedTokens += 1;
      }

      if (cachedInputTokens > rawInputTokens) {
        audit.invalidCachedTokenSplits += 1;
      }

      audit.maxCachedInputShare = Math.max(
        audit.maxCachedInputShare,
        rawInputTokens > 0 ? cachedInputTokens / rawInputTokens : 0,
      );

      return audit;
    }, emptyCacheTokenAudit());
}

function mergeCacheTokenAudits(audits) {
  return audits.reduce((total, audit) => {
    for (const field of [
      'modelCalls',
      'callsWithCachedTokens',
      'invalidCachedTokenSplits',
      'rawInputTokens',
      'normalInputTokens',
      'cachedInputTokens',
      'cacheWriteTokens',
      'outputTokens',
    ]) {
      total[field] += Number(audit?.[field] ?? 0);
    }
    total.maxCachedInputShare = Math.max(total.maxCachedInputShare, Number(audit?.maxCachedInputShare ?? 0));
    return total;
  }, emptyCacheTokenAudit());
}

function compareCacheTokenAudit(actual, expected, label) {
  if (!actual || typeof actual !== 'object') {
    fail(`${label} missing cacheTokenAudit`);
    return;
  }

  for (const field of [
    'modelCalls',
    'callsWithCachedTokens',
    'invalidCachedTokenSplits',
    'rawInputTokens',
    'normalInputTokens',
    'cachedInputTokens',
    'cacheWriteTokens',
    'outputTokens',
  ]) {
    if (Number(actual[field] ?? NaN) !== Number(expected[field] ?? NaN)) {
      fail(`${label} cacheTokenAudit.${field}=${actual[field] ?? 'missing'} does not match expected ${expected[field]}`);
    }
  }

  if (Math.abs(Number(actual.maxCachedInputShare ?? NaN) - expected.maxCachedInputShare) > 0.000000001) {
    fail(
      `${label} cacheTokenAudit.maxCachedInputShare=${actual.maxCachedInputShare ?? 'missing'} does not match expected ${expected.maxCachedInputShare}`,
    );
  }
}

if (sessionData.schemaVersion !== 1) {
  fail(`Expected schemaVersion 1, found ${sessionData.schemaVersion ?? 'missing'}`);
}

if (!Array.isArray(sessionData.sessions)) {
  fail('Expected sessions to be an array');
}

for (const session of sessionData.sessions ?? []) {
  if (!session.id) {
    fail('Session missing id');
  } else if (ids.has(session.id)) {
    fail(`Duplicate session id: ${session.id}`);
  } else {
    ids.add(session.id);
  }

  for (const field of [
    'title',
    'firstPrompt',
    'workspace',
    'sourcePath',
    'model',
    'sourceKind',
    'tokenSource',
    'sessionType',
    'location',
    'status',
  ]) {
    if (!session[field]) {
      fail(`${session.id ?? 'unknown'} missing ${field}`);
    }
  }

  for (const field of ['modelTurns', 'toolCalls', 'totalTokens', 'errors', 'totalEvents']) {
    if (!Number.isFinite(session.traceSummary?.[field]) || session.traceSummary[field] < 0) {
      fail(`${session.id} has invalid traceSummary.${field}`);
    }
  }

  if (!Array.isArray(session.traceEvents)) {
    fail(`${session.id} missing traceEvents array`);
  }

  for (const event of session.traceEvents ?? []) {
    for (const field of ['inputTokens', 'outputTokens']) {
      if (!Number.isFinite(event[field]) || event[field] < 0) {
        fail(`${session.id} traceEvents.${event.index ?? 'unknown'} has invalid ${field}`);
      }
    }
    for (const field of ['cachedInputTokens', 'cacheWriteTokens']) {
      if (event[field] !== undefined && (!Number.isFinite(event[field]) || event[field] < 0)) {
        fail(`${session.id} traceEvents.${event.index ?? 'unknown'} has invalid ${field}`);
      }
    }
    if (Number(event.cachedInputTokens ?? 0) > Number(event.inputTokens ?? 0)) {
      fail(`${session.id} traceEvents.${event.index ?? 'unknown'} has cachedInputTokens greater than inputTokens`);
    }

    const tokenTotal =
      Number(event.inputTokens ?? 0) + Number(event.outputTokens ?? 0) + Number(event.cacheWriteTokens ?? 0);
    if (tokenTotal > 0) {
      if (!event.model || !event.pricingModel) {
        fail(`${session.id} traceEvents.${event.index ?? 'unknown'} missing model/pricingModel`);
      }
      if (!Number.isFinite(event.totalTokens) || event.totalTokens !== tokenTotal) {
        fail(`${session.id} traceEvents.${event.index ?? 'unknown'} has invalid totalTokens`);
      }
      const expectedEventUsd = expectedCostUsd(event.pricingModel, {
        input: Math.max(0, Number(event.inputTokens ?? 0) - Number(event.cachedInputTokens ?? 0)),
        cachedInput: Number(event.cachedInputTokens ?? 0),
        cacheWrite: Number(event.cacheWriteTokens ?? 0),
        output: event.outputTokens,
      });
      if (Math.abs(expectedEventUsd - Number(event.estimatedCost?.usd)) > 0.000000001) {
        fail(`${session.id} traceEvents.${event.index ?? 'unknown'} estimatedCost.usd does not match token pricing`);
      }
      if (Math.abs(expectedEventUsd * Number(sessionData.usdToEur) - Number(event.estimatedCost?.eur)) > 0.000000001) {
        fail(`${session.id} traceEvents.${event.index ?? 'unknown'} estimatedCost.eur does not match token pricing and usdToEur`);
      }
    }
  }

  const expectedCacheTokenAudit = auditFromTraceEvents(session.traceEvents);
  compareCacheTokenAudit(session.cacheTokenAudit, expectedCacheTokenAudit, session.id);

  if (session.vscodeState) {
    if (!session.vscodeState.sourcePath) {
      fail(`${session.id} vscodeState missing sourcePath`);
    }
    if (!Array.isArray(session.vscodeState.keys) || !session.vscodeState.keys.length) {
      fail(`${session.id} vscodeState missing keys`);
    }
    for (const field of ['hasPendingEdits', 'isExternal']) {
      if (typeof session.vscodeState[field] !== 'boolean') {
        fail(`${session.id} vscodeState.${field} must be boolean`);
      }
    }
  }

  if (!Date.parse(session.startedAt) || !Date.parse(session.endedAt)) {
    fail(`${session.id} has invalid timestamps`);
  }

  const tokens = session.tokens ?? {};
  for (const field of ['input', 'cachedInput', 'cacheWrite', 'output']) {
    if (!Number.isFinite(tokens[field]) || tokens[field] < 0) {
      fail(`${session.id} has invalid token field ${field}`);
    }
  }

  const hasBillableSignal = (tokens.input ?? 0) + (tokens.cachedInput ?? 0) + (tokens.cacheWrite ?? 0) + (tokens.output ?? 0) > 0;
  const hasConversationSignal = Array.isArray(session.turns) && session.turns.length > 0;
  if (!hasBillableSignal && !hasConversationSignal) {
    fail(`${session.id} has neither token totals nor turns; this should have been skipped by ingestion`);
  }

  if (session.sourceKind === 'vscode-copilot-debug-log' && session.tokenSource !== 'llm_request_token_totals') {
    warn(`${session.id} debug log does not use llm_request totals`);
  }

  if (!Array.isArray(session.tags) || !session.tags.length) {
    warn(`${session.id} has no tags`);
  }

  if (!Array.isArray(session.modelBreakdown) || !session.modelBreakdown.length) {
    fail(`${session.id} missing modelBreakdown array`);
  }

  let modelBreakdownUsd = 0;
  for (const entry of session.modelBreakdown ?? []) {
    if (!entry.model) {
      fail(`${session.id} has modelBreakdown entry without model`);
    }
    if (!Array.isArray(entry.rawModels) || !entry.rawModels.length) {
      fail(`${session.id} modelBreakdown.${entry.model ?? 'unknown'} missing rawModels`);
    }
    if (!Number.isFinite(entry.turns) || entry.turns < 0) {
      fail(`${session.id} modelBreakdown.${entry.model ?? 'unknown'} has invalid turns`);
    }
    for (const field of ['input', 'cachedInput', 'cacheWrite', 'output']) {
      if (!Number.isFinite(entry.tokens?.[field]) || entry.tokens[field] < 0) {
        fail(`${session.id} modelBreakdown.${entry.model ?? 'unknown'} has invalid token field ${field}`);
      }
    }
    const normalizedRawModels = new Set(entry.rawModels.map((model) => normalizeModel(model, pricing)));
    if (!normalizedRawModels.has(entry.model) && entry.model !== 'Unknown model') {
      fail(`${session.id} modelBreakdown.${entry.model} does not match raw model ids`);
    }
    const pricingModel = entry.pricingModel ?? entry.model;
    const entryExpectedUsd = expectedCostUsd(pricingModel, entry.tokens ?? {});
    modelBreakdownUsd += entryExpectedUsd;
    if (Math.abs(entryExpectedUsd - Number(entry.cost?.usd)) > 0.000000001) {
      fail(`${session.id} modelBreakdown.${entry.model} cost.usd does not match token pricing`);
    }
  }

  const expectedUsd = session.modelBreakdown?.length
    ? modelBreakdownUsd
    : expectedCostUsd(session.model, tokens);
  const expectedEur = expectedUsd * Number(sessionData.usdToEur);
  if (Math.abs(expectedUsd - Number(session.cost?.usd)) > 0.000000001) {
    fail(`${session.id} cost.usd does not match token pricing`);
  }
  if (Math.abs(expectedEur - Number(session.cost?.eur)) > 0.000000001) {
    fail(`${session.id} cost.eur does not match token pricing and usdToEur`);
  }
}

const importedSessions = sessionData.ingestion?.importedSessions;
if (Number.isFinite(importedSessions) && importedSessions !== (sessionData.sessions?.length ?? 0)) {
  fail(`ingestion.importedSessions=${importedSessions} does not match sessions.length=${sessionData.sessions?.length ?? 0}`);
}

for (const field of ['scannedStateDbs', 'enrichedFromStateDbs']) {
  if (!Number.isFinite(sessionData.ingestion?.[field]) || sessionData.ingestion[field] < 0) {
    fail(`ingestion.${field} is missing or invalid`);
  }
}

for (const warning of sessionData.ingestion?.warnings ?? []) {
  warn(warning);
}

const expectedIngestionCacheTokenAudit = mergeCacheTokenAudits(
  (sessionData.sessions ?? []).map((session) => session.cacheTokenAudit).filter(Boolean),
);
compareCacheTokenAudit(
  sessionData.ingestion?.cacheTokenAudit,
  expectedIngestionCacheTokenAudit,
  'ingestion',
);

if (warnings.length) {
  console.warn(`Session data verification warnings (${warnings.length}):`);
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (errors.length) {
  console.error(`Session data verification failed (${errors.length}):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const cacheTokenAudit = sessionData.ingestion?.cacheTokenAudit ?? emptyCacheTokenAudit();
console.log(`Session data verification passed: ${sessionData.sessions?.length ?? 0} sessions in ${file}`);
console.log(
  `Cache split audit: ${cacheTokenAudit.callsWithCachedTokens}/${cacheTokenAudit.modelCalls} model calls include cachedTokens; ${cacheTokenAudit.invalidCachedTokenSplits} invalid cached/input splits; ${Number(cacheTokenAudit.normalInputTokens ?? 0).toLocaleString()} normal input + ${Number(cacheTokenAudit.cachedInputTokens ?? 0).toLocaleString()} cached input from ${Number(cacheTokenAudit.rawInputTokens ?? 0).toLocaleString()} raw inputTokens.`,
);
