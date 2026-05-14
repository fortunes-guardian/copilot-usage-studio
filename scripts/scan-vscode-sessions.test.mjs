import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cacheTokenAuditFromLlmRequests,
  eventModelCostFields,
  llmTokenFields,
  mergeCacheTokenAudits,
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
