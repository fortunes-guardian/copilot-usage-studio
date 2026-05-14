import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  costUsdForTokens,
  modelKey,
  modelUsesPricingFallback,
  normalizeModel,
  pricingModelForModel,
} from './pricing-utils.mjs';

const pricingData = JSON.parse(readFileSync(new URL('../data/github-copilot-pricing.json', import.meta.url), 'utf8'));
const pricing = pricingData.models;
const fallback = pricingData.fallbackModel;

test('normalizes raw VS Code model ids to GitHub pricing rows', () => {
  assert.equal(modelKey('copilot/Claude Sonnet 4.6'), 'claude sonnet 4 6');
  assert.equal(normalizeModel('copilot/claude-sonnet-4.6', pricing), 'Claude Sonnet 4.6');
  assert.equal(normalizeModel('gpt-5.4', pricing), 'GPT-5.4');
});

test('keeps unknown model labels but prices them with the explicit fallback row', () => {
  assert.equal(normalizeModel('some-new-model', pricing), 'some-new-model');
  assert.equal(pricingModelForModel('some-new-model', pricing, fallback), 'GPT-5.4');
  assert.equal(modelUsesPricingFallback('some-new-model', 'GPT-5.4', pricing, fallback), true);
});

test('does not mark direct model matches as fallback pricing', () => {
  assert.equal(pricingModelForModel('Claude Sonnet 4.6', pricing, fallback), 'Claude Sonnet 4.6');
  assert.equal(modelUsesPricingFallback('Claude Sonnet 4.6', 'Claude Sonnet 4.6', pricing, fallback), false);
});

test('prices with the provided fallback row when a pricing id is unknown', () => {
  const fallbackCost = costUsdForTokens(
    'GPT-5.4',
    { input: 1_000_000, cachedInput: 1_000_000, cacheWrite: 0, output: 1_000_000 },
    pricing,
    fallback,
  );
  const unknownCost = costUsdForTokens(
    'missing-row',
    { input: 1_000_000, cachedInput: 1_000_000, cacheWrite: 0, output: 1_000_000 },
    pricing,
    fallback,
  );

  assert.equal(unknownCost, fallbackCost);
});
