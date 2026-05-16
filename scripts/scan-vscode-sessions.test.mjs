import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cacheTokenAuditFromLlmRequests,
  eventModelCostFields,
  llmTokenFields,
  mergeCacheTokenAudits,
  sessionFromChatSnapshot,
  sessionFromDebugLog,
} from './scan-vscode-sessions.mjs';

test('splits raw VS Code inputTokens into normal and cached input tokens', () => {
  const tokenFields = llmTokenFields({
    attrs: {
      inputTokens: 23_911,
      cachedTokens: 21_632,
      outputTokens: 285,
    },
  });

  assert.equal(tokenFields.inputTokens, 23_911);
  assert.equal(tokenFields.billableInputTokens, 2_279);
  assert.equal(tokenFields.cachedInputTokens, 21_632);
  assert.equal(tokenFields.outputTokens, 285);
});

test('clamps impossible cachedTokens while preserving the invalid split audit', () => {
  const event = {
    attrs: {
      inputTokens: 100,
      cachedTokens: 125,
      outputTokens: 10,
    },
  };

  assert.equal(llmTokenFields(event).cachedInputTokens, 100);

  const audit = cacheTokenAuditFromLlmRequests([event]);
  assert.equal(audit.modelCalls, 1);
  assert.equal(audit.callsWithCachedTokens, 1);
  assert.equal(audit.invalidCachedTokenSplits, 1);
  assert.equal(audit.rawInputTokens, 100);
  assert.equal(audit.normalInputTokens, 0);
  assert.equal(audit.cachedInputTokens, 100);
  assert.equal(audit.outputTokens, 10);
});

test('prices scanner model fields from the four priced buckets', () => {
  const tokenFields = llmTokenFields({
    attrs: {
      inputTokens: 6_000_000,
      cachedTokens: 2_000_000,
      cacheWriteTokens: 3_000_000,
      outputTokens: 4_000_000,
    },
  });

  const modelCost = eventModelCostFields('claude-sonnet-4.6', tokenFields);

  assert.equal(modelCost.model, 'Claude Sonnet 4.6');
  assert.equal(modelCost.pricingModel, 'Claude Sonnet 4.6');
  assert.equal(modelCost.totalTokens, 13_000_000);
  assert.equal(modelCost.estimatedCost.usd, 83.85);
});

test('merges cache token audits without losing max cached share', () => {
  const merged = mergeCacheTokenAudits([
    {
      modelCalls: 1,
      callsWithCachedTokens: 1,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 100,
      normalInputTokens: 75,
      cachedInputTokens: 25,
      cacheWriteTokens: 0,
      outputTokens: 10,
      maxCachedInputShare: 0.25,
    },
    {
      modelCalls: 1,
      callsWithCachedTokens: 1,
      invalidCachedTokenSplits: 0,
      rawInputTokens: 100,
      normalInputTokens: 10,
      cachedInputTokens: 90,
      cacheWriteTokens: 3,
      outputTokens: 20,
      maxCachedInputShare: 0.9,
    },
  ]);

  assert.equal(merged.modelCalls, 2);
  assert.equal(merged.callsWithCachedTokens, 2);
  assert.equal(merged.rawInputTokens, 200);
  assert.equal(merged.normalInputTokens, 85);
  assert.equal(merged.cachedInputTokens, 115);
  assert.equal(merged.cacheWriteTokens, 3);
  assert.equal(merged.outputTokens, 30);
  assert.equal(merged.maxCachedInputShare, 0.9);
});

test('imports exact debug-log token totals from a session fixture', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('exact-debug-log');
  try {
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'session_start', 'session_start'),
      event(2, 'user_message', 'user message', {
        attrs: { content: 'Review the latest branch changes.' },
      }),
      event(3, 'llm_request', 'panel/editAgent', {
        attrs: {
          model: 'gpt-5.4',
          inputTokens: 23_911,
          cachedTokens: 21_632,
          outputTokens: 285,
          estimatedCost: { currency: 'USD', total: 0.02 },
          ttft: 398,
          requestOptions: JSON.stringify({ reasoning: { effort: 'high' } }),
        },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);

    assert.equal(session.tokenSource, 'llm_request_token_totals');
    assert.equal(session.confidence, 'exact');
    assert.deepEqual(session.tokens, {
      input: 2_279,
      cachedInput: 21_632,
      cacheWrite: 0,
      output: 285,
    });
    assert.equal(session.traceSummary.totalTokens, 24_196);
    assert.equal(session.cacheTokenAudit.rawInputTokens, 23_911);
    assert.equal(session.cacheTokenAudit.normalInputTokens, 2_279);
    assert.equal(session.cacheTokenAudit.cachedInputTokens, 21_632);
    assert.equal(session.traceEvents[2].inputTokens, 23_911);
    assert.equal(session.traceEvents[2].cachedInputTokens, 21_632);
    assert.equal(session.traceEvents[2].reasoningEffort, 'high');
    assert.equal(session.traceEvents[2].sourceEstimatedCost, '{"currency":"USD","total":"0.02"}');
    assert.deepEqual(session.transcript, {
      available: false,
      sourcePath: '',
      eventCount: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('records optional transcript availability without using it for pricing', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('debug-log-with-transcript');
  const transcriptDir = join(workspaceDir, 'GitHub.copilot-chat', 'transcripts');
  try {
    mkdirSync(transcriptDir, { recursive: true });
    writeJsonl(join(transcriptDir, 'debug-log-with-transcript.jsonl'), [
      { type: 'assistant.turn_start' },
      { type: 'tool.execution_complete', toolName: 'read_file' },
    ]);
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'user_message', 'user message', { attrs: { content: 'Read one file.' } }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: { model: 'gpt-5.4', inputTokens: 10_000, cachedTokens: 7_500, outputTokens: 100 },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);

    assert.equal(session.transcript.available, true);
    assert.equal(session.transcript.eventCount, 2);
    assert.match(session.transcript.sourcePath, /debug-log-with-transcript\.jsonl$/);
    assert.deepEqual(session.tokens, {
      input: 2_500,
      cachedInput: 7_500,
      cacheWrite: 0,
      output: 100,
    });
    assert.equal(session.traceSummary.totalTokens, 10_100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('imports mixed-model debug-log sessions without flattening model rows', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('mixed-model-debug-log');
  try {
    writeJsonl(join(sessionDir, 'main.jsonl'), [
      event(1, 'user_message', 'user message', { attrs: { content: 'Compare two approaches.' } }),
      event(2, 'llm_request', 'panel/editAgent', {
        attrs: { model: 'gpt-5.4', inputTokens: 10_000, outputTokens: 500 },
      }),
      event(3, 'llm_request', 'panel/editAgent', {
        attrs: { model: 'claude-sonnet-4.6', inputTokens: 12_000, cachedTokens: 2_000, outputTokens: 700 },
      }),
    ]);

    const session = sessionFromDebugLog(sessionDir, workspaceDir);
    const rows = session.modelBreakdown;

    assert.equal(session.model, 'Mixed (GPT-5.4, Claude Sonnet 4.6)');
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.model === 'GPT-5.4').tokens.input, 10_000);
    assert.equal(rows.find((row) => row.model === 'Claude Sonnet 4.6').tokens.input, 10_000);
    assert.equal(rows.find((row) => row.model === 'Claude Sonnet 4.6').tokens.cachedInput, 2_000);
    assert.equal(session.tokens.input, 20_000);
    assert.equal(session.tokens.cachedInput, 2_000);
    assert.equal(session.traceSummary.modelTurns, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skips empty debug-log sessions instead of inventing weak estimates', () => {
  const { root, sessionDir, workspaceDir } = tempSessionFixture('empty-debug-log');
  try {
    writeFileSync(join(sessionDir, 'main.jsonl'), '', 'utf8');

    assert.equal(sessionFromDebugLog(sessionDir, workspaceDir), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps chat snapshots visibly estimated and cache-empty', () => {
  const { root, workspaceDir } = tempWorkspaceFixture('weak-chat-snapshot');
  const snapshotFile = join(workspaceDir, 'chatSessions', 'snapshot-1.jsonl');
  mkdirSync(join(workspaceDir, 'chatSessions'), { recursive: true });

  try {
    writeJsonl(snapshotFile, [
      {
        kind: 0,
        v: {
          creationDate: Date.UTC(2026, 4, 1),
          customTitle: 'Visible chat only',
          requests: [
            {
              modelId: 'gpt-5.4',
              message: { text: 'Summarize this file.' },
              completionTokens: 120,
              response: [{ value: 'Done.' }],
            },
          ],
        },
      },
    ]);

    const session = sessionFromChatSnapshot(snapshotFile, workspaceDir);

    assert.equal(session.sourceKind, 'vscode-chat-session-snapshot');
    assert.equal(session.tokenSource, 'chat-snapshot-output-plus-visible-input-estimate');
    assert.equal(session.confidence, 'estimated');
    assert.equal(session.tokens.cachedInput, 0);
    assert.equal(session.cacheTokenAudit.modelCalls, 0);
    assert.equal(session.transcript.available, false);
    assert.equal(session.traceEvents.length, 2);
    assert.equal(session.traceEvents[0].type, 'user_message');
    assert.equal(session.traceEvents[1].outputTokens, 120);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempSessionFixture(name) {
  const fixture = tempWorkspaceFixture(name);
  const sessionDir = join(fixture.workspaceDir, 'GitHub.copilot-chat', 'debug-logs', name);
  mkdirSync(sessionDir, { recursive: true });

  return { ...fixture, sessionDir };
}

function tempWorkspaceFixture(name) {
  const root = mkdtempSync(join(tmpdir(), `copilot-cost-debugger-${name}-`));
  const workspaceDir = join(root, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(workspaceDir, 'workspace.json'), JSON.stringify({ folder: 'file:///tmp/example-workspace' }), 'utf8');

  return { root, workspaceDir };
}

function writeJsonl(file, records) {
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n'), 'utf8');
}

function event(ts, type, name, extra = {}) {
  return {
    ts,
    timestamp: new Date(ts).toISOString(),
    sid: 'fixture-session',
    type,
    name,
    status: 'ok',
    attrs: {},
    ...extra,
  };
}
