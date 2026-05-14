import {
  analyticsDistribution,
  analyticsGroupKey,
  analyticsModelRows,
  analyticsOutliers,
  analyticsTrendRows,
  filterAnalyticsSessions,
  sessionSize,
} from './session-analytics';
import { CopilotSession, TokenBreakdown } from './session-data.model';

describe('session analytics helpers', () => {
  it('filters by relative time window, workspace, and model row', () => {
    const sessions = [
      sessionFixture('old', 'Old', 'repo-a', 'GPT-5.4', 'GPT-5.4', '2026-05-01T12:00:00.000Z', 0.02, {
        input: 10_000,
        cachedInput: 0,
        cacheWrite: 0,
        output: 1_000,
      }),
      sessionFixture('new-a', 'New A', 'repo-a', 'GPT-5.4', 'GPT-5.4', '2026-05-20T12:00:00.000Z', 0.03, {
        input: 20_000,
        cachedInput: 0,
        cacheWrite: 0,
        output: 1_000,
      }),
      sessionFixture('new-b', 'New B', 'repo-b', 'Claude Sonnet 4.6', 'Claude Sonnet 4.6', '2026-05-21T12:00:00.000Z', 0.04, {
        input: 30_000,
        cachedInput: 0,
        cacheWrite: 0,
        output: 1_000,
      }),
    ];

    expect(filterAnalyticsSessions(sessions, '7d', 'repo-a', 'GPT-5.4').map((session) => session.id)).toEqual([
      'new-a',
    ]);
  });

  it('keeps cached token buckets visible in model rows', () => {
    const rows = analyticsModelRows(
      [
        sessionFixture('cache-a', 'Cache A', 'repo', 'GPT-5.4', 'GPT-5.4', '2026-05-01T12:00:00.000Z', 0.1, {
          input: 1_000,
          cachedInput: 9_000,
          cacheWrite: 100,
          output: 500,
        }),
        sessionFixture('cache-b', 'Cache B', 'repo', 'GPT-5.4', 'GPT-5.4', '2026-05-01T13:00:00.000Z', 0.2, {
          input: 2_000,
          cachedInput: 8_000,
          cacheWrite: 200,
          output: 700,
        }),
      ],
      0.3,
    );

    expect(rows[0].sessionCount).toBe(2);
    expect(rows[0].input).toBe(3_000);
    expect(rows[0].cachedInput).toBe(17_000);
    expect(rows[0].cacheWrite).toBe(300);
    expect(rows[0].output).toBe(1_200);
  });

  it('groups trend rows by week and buckets distribution by supported size thresholds', () => {
    const sessions = [
      sessionFixture('small', 'Small', 'repo', 'GPT-5.4', 'GPT-5.4', '2026-05-01T12:00:00.000Z', 0.1, {
        input: 50_000,
        cachedInput: 0,
        cacheWrite: 0,
        output: 1_000,
      }),
      sessionFixture('large', 'Large', 'repo', 'GPT-5.4', 'GPT-5.4', '2026-05-03T12:00:00.000Z', 0.2, {
        input: 700_000,
        cachedInput: 0,
        cacheWrite: 0,
        output: 1_000,
      }),
    ];

    expect(analyticsGroupKey('2026-05-03T12:00:00.000Z', 'week')).toEqual({
      key: '2026-04-27',
      label: 'Week of 2026-04-27',
    });
    expect(analyticsTrendRows(sessions, 'week')[0].count).toBe(2);
    expect(analyticsDistribution(sessions, 0.3).map((row) => [row.size, row.count])).toEqual([
      ['Small', 1],
      ['Medium', 0],
      ['Large', 1],
      ['Very large', 0],
    ]);
    expect(sessionSize(1_500_000)).toBe('Very large');
  });

  it('explains input-heavy outliers from imported token mix', () => {
    const normal = sessionFixture('normal', 'Normal', 'repo', 'GPT-5.4', 'GPT-5.4', '2026-05-01T12:00:00.000Z', 0.05, {
      input: 10_000,
      cachedInput: 0,
      cacheWrite: 0,
      output: 10_000,
    });
    const inputHeavy = sessionFixture(
      'input-heavy',
      'Input heavy',
      'repo',
      'GPT-5.4',
      'GPT-5.4',
      '2026-05-01T13:00:00.000Z',
      1.5,
      {
        input: 300_000,
        cachedInput: 100_000,
        cacheWrite: 0,
        output: 1_000,
      },
    );
    const sessions = [normal, inputHeavy];
    const avgCost = sessions.reduce((sum, session) => sum + session.cost.usd, 0) / sessions.length;
    const avgTokens = sessions.reduce((sum, session) => sum + session.traceSummary.totalTokens, 0) / sessions.length;

    expect(analyticsOutliers(sessions, avgCost, avgTokens)[0].reason).toContain('Mostly input/context tokens');
  });
});

function sessionFixture(
  id: string,
  title: string,
  workspace: string,
  model: string,
  pricingModel: string,
  startedAt: string,
  usd: number,
  tokens: TokenBreakdown,
): CopilotSession {
  const totalTokens = tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;

  return {
    id,
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title,
    firstPrompt: title,
    workspace,
    sourcePath: `debug-logs/${id}`,
    model,
    modelBreakdown: [
      {
        model,
        rawModels: [model.toLowerCase()],
        pricingModel,
        turns: 1,
        tokens,
        cost: { usd, eur: usd },
      },
    ],
    startedAt,
    endedAt: startedAt,
    tags: ['debug-log'],
    toolsUsed: [],
    tokens,
    cost: { usd, eur: usd },
    confidence: 'exact',
    traceSummary: {
      modelTurns: 1,
      toolCalls: 0,
      totalTokens,
      errors: 0,
      totalEvents: 1,
    },
    traceEvents: [],
    turns: [{ role: 'user', text: title, tokens: 2 }],
  };
}
