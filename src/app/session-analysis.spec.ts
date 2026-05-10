import { LedgerSession } from './ledger.model';
import { buildCostExplanation, matchesTraceFilter, sessionTriage, traceEventDetails } from './session-analysis';

describe('session analysis', () => {
  const session: LedgerSession = {
    id: 'session-1',
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: 'Review branch changes',
    firstPrompt: 'review branch changes',
    workspace: 'copilot-cost-ledger',
    sourcePath: 'debug-logs/session-1',
    model: 'Claude Sonnet 4.6',
    modelBreakdown: [
      {
        model: 'Claude Sonnet 4.6',
        rawModels: ['claude-sonnet-4.6'],
        turns: 2,
        tokens: { input: 325_000, cachedInput: 0, cacheWrite: 0, output: 25_000 },
        cost: { usd: 1.55, eur: 1.4415 },
        pricingModel: 'Claude Sonnet 4.6',
      },
    ],
    startedAt: '2026-05-01T13:28:17.497Z',
    endedAt: '2026-05-01T13:39:32.374Z',
    tags: ['debug-log', 'llm-request-token-totals'],
    toolsUsed: ['read_file'],
    tokens: { input: 325_000, cachedInput: 0, cacheWrite: 0, output: 25_000 },
    cost: { usd: 1.55, eur: 1.4415 },
    confidence: 'exact',
    traceSummary: {
      modelTurns: 2,
      toolCalls: 1,
      totalTokens: 350_000,
      errors: 0,
      totalEvents: 4,
    },
    traceEvents: [
      {
        index: 0,
        timestamp: '2026-05-01T13:28:17.497Z',
        type: 'user_message',
        name: 'user_message',
        status: 'ok',
        detail: 'review branch changes',
        inputTokens: 0,
        outputTokens: 0,
      },
      {
        index: 1,
        timestamp: '2026-05-01T13:28:20.000Z',
        type: 'llm_request',
        name: 'panel/editAgent',
        status: 'ok',
        detail: 'Claude Sonnet 4.6: 125000 in / 10000 out',
        model: 'Claude Sonnet 4.6',
        pricingModel: 'Claude Sonnet 4.6',
        inputTokens: 125_000,
        outputTokens: 10_000,
        estimatedCost: { usd: 0.62, eur: 0.5766 },
      },
      {
        index: 2,
        timestamp: '2026-05-01T13:31:20.000Z',
        type: 'tool_call',
        name: 'read_file',
        status: 'ok',
        detail: 'read_file package.json',
        inputTokens: 0,
        outputTokens: 0,
      },
      {
        index: 3,
        timestamp: '2026-05-01T13:35:20.000Z',
        type: 'llm_request',
        name: 'panel/editAgent',
        status: 'ok',
        detail: 'Claude Sonnet 4.6: 200000 in / 15000 out',
        model: 'Claude Sonnet 4.6',
        pricingModel: 'Claude Sonnet 4.6',
        inputTokens: 200_000,
        outputTokens: 15_000,
        estimatedCost: { usd: 0.93, eur: 0.8649 },
      },
    ],
    turns: [{ role: 'user', text: 'review branch changes', tokens: 3 }],
  };

  it('builds selected-run cost and turn analysis without Angular state', () => {
    const explanation = buildCostExplanation(session, 'largest');

    expect(explanation.sourceStrength).toBe('Exact local token counts');
    expect(explanation.hasCacheData).toBe(false);
    expect(explanation.modelRows[0].model).toBe('Claude Sonnet 4.6');
    expect(explanation.modelCallRows).toHaveLength(2);
    expect(explanation.modelCallRows[0].index).toBe(3);
    expect(explanation.costAnswer.category).toBe('Input/context');
    expect(explanation.turnInsights[0].value).toBe('2');
  });

  it('keeps triage and trace details evidence-based', () => {
    const triage = sessionTriage(session);
    const eventDetails = traceEventDetails(session.traceEvents[3], session.modelBreakdown);

    expect(triage.size).toBe('Large');
    expect(triage.warnings.map((warning) => warning.label)).toContain('High input context');
    expect(matchesTraceFilter(session.traceEvents[2], 'tool')).toBe(true);
    expect(matchesTraceFilter(session.traceEvents[3], 'model')).toBe(true);
    expect(eventDetails.hasCost).toBe(true);
    expect(eventDetails.pricingModel).toBe('Claude Sonnet 4.6');
  });
});
