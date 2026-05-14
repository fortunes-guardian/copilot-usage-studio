import { estimateCostUsd } from './pricing';
import { explainModelCost, sessionTotalTokens, tokenTotal } from './session-cost-utils';
import { CopilotSession, ModelBreakdown } from './session-data.model';

describe('session cost utilities', () => {
  it('keeps normal input, cached input, cache write, and output as distinct priced buckets', () => {
    const tokens = {
      input: 1_000_000,
      cachedInput: 2_000_000,
      cacheWrite: 3_000_000,
      output: 4_000_000,
    };
    const entry: ModelBreakdown = {
      model: 'Claude Sonnet 4.6',
      rawModels: ['claude-sonnet-4.6'],
      pricingModel: 'Claude Sonnet 4.6',
      turns: 1,
      tokens,
      cost: { usd: 0, eur: 0 },
    };

    const priced = explainModelCost(entry, 75.6);

    expect(priced.inputUsd).toBe(3);
    expect(priced.cachedInputUsd).toBe(0.6);
    expect(priced.cacheWriteUsd).toBe(11.25);
    expect(priced.outputUsd).toBe(60);
    expect(priced.totalUsd).toBe(74.85);
    expect(priced.share).toBeCloseTo(99.0079);
    expect(tokenTotal(tokens)).toBe(10_000_000);
    expect(estimateCostUsd('Claude Sonnet 4.6', tokens)).toBe(priced.totalUsd);
  });

  it('does not treat cached input as free or subtract it from output cost', () => {
    const tokens = {
      input: 2_279,
      cachedInput: 21_632,
      cacheWrite: 0,
      output: 285,
    };

    expect(estimateCostUsd('GPT-5.4', tokens)).toBeCloseTo(0.0153805);
  });

  it('counts session tokens as normal input plus cached input plus cache write plus output', () => {
    const session = {
      tokens: {
        input: 2_279,
        cachedInput: 21_632,
        cacheWrite: 11,
        output: 285,
      },
    } as CopilotSession;

    expect(sessionTotalTokens(session)).toBe(24_207);
  });
});
