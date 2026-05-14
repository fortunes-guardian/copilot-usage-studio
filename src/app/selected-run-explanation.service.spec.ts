import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CopilotSession } from './session-data.model';
import { SelectedRunExplanationService } from './selected-run-explanation.service';

describe('SelectedRunExplanationService', () => {
  let service: SelectedRunExplanationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SelectedRunExplanationService);
  });

  it('derives selected-run cost and trace state from root-owned signals', () => {
    const selectedSession = signal<CopilotSession | null>(buildSession());
    const filteredSessions = signal<CopilotSession[]>([buildSession()]);
    const modelCallSort = signal<'timeline' | 'largest'>('largest');
    const traceFilter = signal<
      'all' | 'model' | 'tool' | 'discovery' | 'message' | 'response' | 'error'
    >('all');
    const selectedTraceEventIndex = signal<number | null>(null);

    const state = service.createState({
      filteredSessions,
      selectedSession,
      modelCallSort,
      traceFilter,
      selectedTraceEventIndex,
    });

    expect(state.costExplanation()?.costAnswer.category).toBe('Input/context');
    expect(state.costExplanation()?.modelCallRows[0].index).toBe(3);
    expect(state.flowEvents().map((event) => event.index)).toEqual([0, 1, 2, 3]);
    expect(state.selectedTraceEvent()?.index).toBe(0);
    expect(state.selectedSessionOutsideFilters()).toBe(false);
    expect(state.selectedPricingFallbacks()).toEqual([]);
    expect(state.selectedTriage()?.size).toBe('Medium');

    traceFilter.set('model');
    selectedTraceEventIndex.set(3);

    expect(state.filteredTraceEvents().map((event) => event.index)).toEqual([1, 3]);
    expect(state.selectedTraceEvent()?.index).toBe(3);
    expect(state.selectedTraceEventDetails()?.pricingModel).toBe('Claude Sonnet 4.6');

    modelCallSort.set('timeline');
    filteredSessions.set([]);

    expect(state.costExplanation()?.modelCallRows[0].index).toBe(1);
    expect(state.selectedSessionOutsideFilters()).toBe(true);
  });

  it('returns empty selected-run state when no session is selected', () => {
    const state = service.createState({
      filteredSessions: signal<CopilotSession[]>([]),
      selectedSession: signal<CopilotSession | null>(null),
      modelCallSort: signal<'timeline' | 'largest'>('timeline'),
      traceFilter: signal<
        'all' | 'model' | 'tool' | 'discovery' | 'message' | 'response' | 'error'
      >('all'),
      selectedTraceEventIndex: signal<number | null>(null),
    });

    expect(state.costExplanation()).toBeNull();
    expect(state.flowEvents()).toEqual([]);
    expect(state.filteredTraceEvents()).toEqual([]);
    expect(state.selectedTraceEvent()).toBeNull();
    expect(state.selectedTraceEventDetails()).toBeNull();
    expect(state.selectedSessionOutsideFilters()).toBe(false);
    expect(state.selectedPricingFallbacks()).toEqual([]);
    expect(state.selectedTriage()).toBeNull();
  });

  it('surfaces pricing fallbacks as selected-run assumptions', () => {
    const fallbackSession = buildSession();
    fallbackSession.model = 'gpt-4o';
    fallbackSession.modelBreakdown = [
      {
        model: 'gpt-4o',
        rawModels: ['gpt-4o'],
        turns: 1,
        tokens: { input: 10_000, cachedInput: 0, cacheWrite: 0, output: 500 },
        cost: { usd: 0.01, eur: 0.01 },
        pricingModel: 'GPT-5.4',
      },
    ];

    const state = service.createState({
      filteredSessions: signal<CopilotSession[]>([fallbackSession]),
      selectedSession: signal<CopilotSession | null>(fallbackSession),
      modelCallSort: signal<'timeline' | 'largest'>('timeline'),
      traceFilter: signal<
        'all' | 'model' | 'tool' | 'discovery' | 'message' | 'response' | 'error'
      >('all'),
      selectedTraceEventIndex: signal<number | null>(null),
    });

    expect(state.selectedPricingFallbacks()).toEqual([
      { model: 'gpt-4o', pricingModel: 'GPT-5.4', turns: 1 },
    ]);
    expect(state.costExplanation()?.modelRows[0].usesFallbackPrice).toBe(true);
  });
});

function buildSession(): CopilotSession {
  return {
    id: 'session-1',
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: 'Review branch changes',
    firstPrompt: 'review branch changes',
    workspace: 'copilot-cost-debugger',
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
}
