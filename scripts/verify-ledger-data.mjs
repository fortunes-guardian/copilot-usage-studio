import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] ?? 'public/data/sessions.json');
const ledger = JSON.parse(readFileSync(file, 'utf8'));
const errors = [];
const warnings = [];
const ids = new Set();
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

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
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
  const raw = String(model ?? '').replace(/^copilot\//i, '').trim();
  const key = modelKey(raw);
  const known = Object.keys(pricing);
  return (
    known.find((name) => modelKey(name) === key) ??
    known.find((name) => key.includes(modelKey(name))) ??
    (raw || 'Unknown model')
  );
}

function expectedCostUsd(model, tokens) {
  const price = pricing[model] ?? pricing['GPT-5.4'];
  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}

if (ledger.schemaVersion !== 1) {
  fail(`Expected schemaVersion 1, found ${ledger.schemaVersion ?? 'missing'}`);
}

if (!Array.isArray(ledger.sessions)) {
  fail('Expected sessions to be an array');
}

for (const session of ledger.sessions ?? []) {
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
    const normalizedRawModels = new Set(entry.rawModels.map(normalizeModel));
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
  const expectedEur = expectedUsd * Number(ledger.usdToEur);
  if (Math.abs(expectedUsd - Number(session.cost?.usd)) > 0.000000001) {
    fail(`${session.id} cost.usd does not match token pricing`);
  }
  if (Math.abs(expectedEur - Number(session.cost?.eur)) > 0.000000001) {
    fail(`${session.id} cost.eur does not match token pricing and usdToEur`);
  }
}

const importedSessions = ledger.ingestion?.importedSessions;
if (Number.isFinite(importedSessions) && importedSessions !== (ledger.sessions?.length ?? 0)) {
  fail(`ingestion.importedSessions=${importedSessions} does not match sessions.length=${ledger.sessions?.length ?? 0}`);
}

for (const field of ['scannedStateDbs', 'enrichedFromStateDbs']) {
  if (!Number.isFinite(ledger.ingestion?.[field]) || ledger.ingestion[field] < 0) {
    fail(`ingestion.${field} is missing or invalid`);
  }
}

for (const warning of ledger.ingestion?.warnings ?? []) {
  warn(warning);
}

if (warnings.length) {
  console.warn(`Ledger verification warnings (${warnings.length}):`);
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (errors.length) {
  console.error(`Ledger verification failed (${errors.length}):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Ledger verification passed: ${ledger.sessions?.length ?? 0} sessions in ${file}`);
