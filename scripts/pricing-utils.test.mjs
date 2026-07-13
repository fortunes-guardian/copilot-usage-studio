import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  costUsdForTokens,
  modelKey,
  modelUsesPricingFallback,
  normalizeModel,
  priceForTokens,
  pricingModelForModel,
} from './pricing-utils.mjs';

const pricingData = JSON.parse(
  readFileSync(new URL('../data/github-copilot-pricing.json', import.meta.url), 'utf8'),
);
const pricing = pricingData.models;
const fallback = pricingData.fallbackModel;

test('normalizes raw VS Code model ids to GitHub pricing rows', () => {
  assert.equal(modelKey('copilot/Claude Sonnet 4.6'), 'claude sonnet 4 6');
  assert.equal(normalizeModel('copilot/claude-sonnet-4.6', pricing), 'Claude Sonnet 4.6');
  assert.equal(normalizeModel('gpt-5.4', pricing), 'GPT-5.4');
  assert.equal(normalizeModel('copilot/gpt-5.6-luna', pricing), 'GPT-5.6 Luna');
  assert.equal(normalizeModel('gpt-5.6-sol', pricing), 'GPT-5.6 Sol');
  assert.equal(normalizeModel('gpt-5.6-terra', pricing), 'GPT-5.6 Terra');
  assert.equal(normalizeModel('claude-sonnet-5', pricing), 'Claude Sonnet 5');
  assert.equal(normalizeModel('kimi-k2.7-code', pricing), 'Kimi K2.7 Code');
  assert.equal(
    normalizeModel('copilot/claude-opus-4.8-fast', pricing),
    'Claude Opus 4.8 (fast mode)',
  );
});

test('keeps unknown model labels but prices them with the explicit fallback row', () => {
  assert.equal(normalizeModel('some-new-model', pricing), 'some-new-model');
  assert.equal(pricingModelForModel('some-new-model', pricing, fallback), 'GPT-5.4');
  assert.equal(modelUsesPricingFallback('some-new-model', 'GPT-5.4', pricing, fallback), true);
  assert.equal(normalizeModel('oswe-vscode-prime', pricing), 'oswe-vscode-prime');
  assert.equal(pricingModelForModel('oswe-vscode-prime', pricing, fallback), 'GPT-5.4');
});

test('does not mark direct model matches as fallback pricing', () => {
  assert.equal(pricingModelForModel('Claude Sonnet 4.6', pricing, fallback), 'Claude Sonnet 4.6');
  assert.equal(
    modelUsesPricingFallback('Claude Sonnet 4.6', 'Claude Sonnet 4.6', pricing, fallback),
    false,
  );
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

test('selects long-context pricing per request using normal plus cached input', () => {
  assert.equal(
    priceForTokens('GPT-5.4', { input: 272_000, cachedInput: 0 }, pricing, fallback).input,
    2.5,
  );
  assert.equal(
    priceForTokens('GPT-5.4', { input: 272_001, cachedInput: 0 }, pricing, fallback).input,
    5,
  );
  assert.equal(
    priceForTokens('GPT-5.4', { input: 100_000, cachedInput: 180_000 }, pricing, fallback)
      .cachedInput,
    0.5,
  );
  assert.equal(
    priceForTokens('Gemini 3.1 Pro', { input: 200_001, cachedInput: 0 }, pricing, fallback).output,
    18,
  );
  assert.equal(
    priceForTokens('GPT-5.6 Luna', { input: 200_001, cachedInput: 0 }, pricing, fallback).output,
    9,
  );
  assert.equal(
    priceForTokens('GPT-5.6 Terra', { input: 272_001, cachedInput: 0 }, pricing, fallback).input,
    5,
  );
});
