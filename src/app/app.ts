import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AnalyticsPageComponent } from './analytics-page.component';
import { ComparePageComponent } from './compare-page.component';
import { LedgerDataService } from './ledger-data.service';
import { LedgerStatePanelComponent } from './ledger-state-panel.component';
import { LedgerSession, ModelBreakdown, TokenBreakdown, TraceEvent } from './ledger.model';
import { PricingPageComponent } from './pricing-page.component';
import { SessionOverviewComponent } from './session-overview.component';
import {
  FALLBACK_PRICING_MODEL,
  MODEL_PRICES_USD_PER_MILLION,
  PRICING_SOURCE_URL,
} from './pricing';

type SessionSize = 'Small' | 'Medium' | 'Large' | 'Very large';
type WarningTone = 'low' | 'info' | 'medium' | 'high';
type SessionSourceFilter = 'all' | 'debug-log' | 'chat-snapshot' | 'exact' | 'estimated';
type ActiveView = 'sessions' | 'compare' | 'analytics' | 'pricing';
type ModelCallSort = 'timeline' | 'largest';
type SelectedRunView = 'overview' | 'cost' | 'turns' | 'trace';
type TraceFilter = 'all' | 'model' | 'tool' | 'discovery' | 'message' | 'response' | 'error';

interface SessionWarning {
  label: string;
  tone: WarningTone;
  help: string;
}

interface SessionTriage {
  size: SessionSize;
  sizeTone: WarningTone;
  totalTokens: number;
  warnings: SessionWarning[];
}

@Component({
  selector: 'app-root',
  imports: [
    AnalyticsPageComponent,
    DatePipe,
    DecimalPipe,
    FormsModule,
    NgClass,
    ComparePageComponent,
    LedgerStatePanelComponent,
    PricingPageComponent,
    SessionOverviewComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly ledgerData = inject(LedgerDataService);

  protected readonly ledger = this.ledgerData.ledger;
  protected readonly ledgerLoadState = this.ledgerData.loadState;
  protected readonly ledgerLoadError = this.ledgerData.loadError;
  protected readonly selectedId = signal<string | null>(null);
  protected readonly compareA = signal<string | null>(null);
  protected readonly compareB = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly sizeFilter = signal<'all' | SessionSize>('all');
  protected readonly warningFilter = signal<string>('all');
  protected readonly sourceFilter = signal<SessionSourceFilter>('all');
  protected readonly traceView = signal<'logs' | 'flow'>('logs');
  protected readonly traceFilter = signal<TraceFilter>('all');
  protected readonly selectedTraceEventIndex = signal<number | null>(null);
  protected readonly modelCallSort = signal<ModelCallSort>('timeline');
  protected readonly activeView = signal<ActiveView>('sessions');
  protected readonly selectedRunView = signal<SelectedRunView>('overview');
  protected readonly pricingSourceUrl = PRICING_SOURCE_URL;
  protected readonly help = {
    appEstimate:
      'Estimated from local VS Code token counts and GitHub published model prices. This is useful for debugging a run, but it is not your GitHub bill.',
    debugLogs:
      'Best source for cost debugging. These VS Code logs include the model used plus input and output token counts for each model call.',
    chatSnapshots:
      'Useful for seeing chat history, but weaker for cost. They often do not include the full prompt/context token count sent to the model.',
    stateDbs:
      'VS Code local databases. We read them only to improve titles, labels, location, and restored-session details.',
    stateEnriched:
      'This many sessions got better names/details from VS Code state. Cost still comes from debug logs, not SQLite.',
    emptyDebugLogs:
      'Folders VS Code created but never filled with useful chat/model activity. We skip them so they do not look like real zero-cost runs.',
    snapshotsWithoutRequests:
      'Chat files without usable request records. They do not contain enough structure to import safely.',
    inputTokens:
      'Everything sent into the model: prompt, repo context, prior conversation, and tool results.',
    outputTokens: 'Generated model response tokens.',
    cachedInput:
      'Tokens served from a provider cache when that data is available. Current local VS Code debug logs do not show this field.',
    cacheWrite:
      'Provider cache creation tokens when the billing source exposes them. GitHub lists this mainly for Anthropic pricing rows.',
    priceRow:
      'The GitHub model pricing row used to estimate this model. Unknown models keep their display label and show any pricing fallback separately.',
    pricingFallback:
      'The raw model name from VS Code did not match a GitHub price row in the local pricing table, so the estimate uses the displayed fallback price row. Treat this as an explicit estimate assumption.',
  };
  protected readonly sessionTriageHelp =
    'Fast read derived from imported tokens, model mix, cache visibility, context growth, and VS Code state enrichment. These are cost-debugging signals, not billing rows.';
  protected readonly sizeOptions: Array<'all' | SessionSize> = ['all', 'Small', 'Medium', 'Large', 'Very large'];
  protected readonly sourceOptions: Array<{ value: SessionSourceFilter; label: string }> = [
    { value: 'all', label: 'All sources' },
    { value: 'debug-log', label: 'Debug logs' },
    { value: 'chat-snapshot', label: 'Chat snapshots' },
    { value: 'exact', label: 'Exact local data' },
    { value: 'estimated', label: 'Estimated data' },
  ];
  protected readonly traceFilterOptions: Array<{ value: TraceFilter; label: string }> = [
    { value: 'all', label: 'All events' },
    { value: 'model', label: 'Model calls' },
    { value: 'tool', label: 'Tools' },
    { value: 'discovery', label: 'Discovery' },
    { value: 'message', label: 'User messages' },
    { value: 'response', label: 'Agent responses' },
    { value: 'error', label: 'Errors' },
  ];

  protected readonly sessions = computed(() => this.ledger()?.sessions ?? []);
  protected readonly warningOptions = computed(() => {
    const labels = new Set<string>();

    for (const session of this.sessions()) {
      for (const warning of this.sessionTriage(session).warnings) {
        labels.add(warning.label);
      }
    }

    return ['all', ...[...labels].sort()];
  });
  protected readonly costExplanation = computed(() => {
    const session = this.selectedSession();
    const ledger = this.ledger();

    if (!session || !ledger) {
      return null;
    }

    const modelRows = session.modelBreakdown.map((entry) =>
      this.explainModelCost(entry, ledger.usdToEur, session.cost.eur),
    );
    const categoryRows = this.explainCategoryCosts(modelRows);
    const modelCallRows = this.modelCallRows(
      session.traceEvents,
      session.modelBreakdown,
      ledger.usdToEur,
      session.cost.eur,
      this.modelCallSort(),
    );
    const topTokenEvents = this.topTokenEvents(session.traceEvents, session.modelBreakdown, ledger.usdToEur);
    const costDrivers = this.explainCostDrivers(session, modelRows, topTokenEvents);
    const hasCacheData = session.tokens.cachedInput > 0 || session.tokens.cacheWrite > 0;
    const costAnswer = this.costAnswer(session, modelRows, modelCallRows);
    const billingReality = this.billingRealityCheck(session, costAnswer, hasCacheData);
    const turnInsights = this.turnInsights(modelCallRows);

    return {
      hasCacheData,
      sourceStrength:
        session.tokenSource === 'llm_request_token_totals'
          ? 'Exact local token counts'
          : 'Estimated token counts',
      sourceDescription:
        session.tokenSource === 'llm_request_token_totals'
          ? 'Imported from VS Code Copilot debug-log llm_request events. This is the strongest local source for session input and output tokens.'
          : 'Estimated from visible chat/session data. Useful context, but weaker than debug-log llm_request totals.',
      cacheStatus: hasCacheData ? 'Cache tokens included' : 'Cache billing not visible locally',
      cacheDescription: hasCacheData
        ? 'This session includes cached input or cache-write token totals in the generated ledger.'
        : 'The VS Code debug-log events imported for this session expose inputTokens and outputTokens, but not billing cache read/write fields. The estimate therefore prices visible local input/output totals and keeps cache accounting explicit as unavailable.',
      modelRows,
      categoryRows,
      costAnswer,
      billingReality,
      costDrivers,
      modelCallRows,
      topTokenEvents,
      turnInsights,
    };
  });
  protected readonly flowEvents = computed(() => {
    const session = this.selectedSession();
    const ledger = this.ledger();

    if (!session || !ledger) {
      return [];
    }

    return this.flowTraceEvents(session.traceEvents, session.modelBreakdown, ledger.usdToEur);
  });
  protected readonly filteredTraceEvents = computed(() => {
    const session = this.selectedSession();

    if (!session) {
      return [];
    }

    return session.traceEvents.filter((event) => this.matchesTraceFilter(event, this.traceFilter()));
  });
  protected readonly selectedTraceEvent = computed(() => {
    const events = this.filteredTraceEvents();
    const selectedIndex = this.selectedTraceEventIndex();

    return events.find((event) => event.index === selectedIndex) ?? events[0] ?? null;
  });
  protected readonly selectedTraceEventDetails = computed(() => {
    const event = this.selectedTraceEvent();
    const session = this.selectedSession();
    const ledger = this.ledger();

    if (!event || !session || !ledger) {
      return null;
    }

    return this.traceEventDetails(event, session.modelBreakdown, ledger.usdToEur);
  });
  protected readonly filteredSessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    const sizeFilter = this.sizeFilter();
    const warningFilter = this.warningFilter();
    const sourceFilter = this.sourceFilter();
    const sessions = [...this.sessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    return sessions.filter((session) =>
      this.matchesQuery(session, query) &&
      this.matchesSizeFilter(session, sizeFilter) &&
      this.matchesWarningFilter(session, warningFilter) &&
      this.matchesSourceFilter(session, sourceFilter),
    );
  });

  protected readonly selectedSession = computed(() => {
    const id = this.selectedId() ?? this.filteredSessions()[0]?.id;
    return this.sessions().find((session) => session.id === id) ?? null;
  });
  protected readonly selectedSessionOutsideFilters = computed(() => {
    const session = this.selectedSession();

    return Boolean(session && !this.filteredSessions().some((filteredSession) => filteredSession.id === session.id));
  });
  protected readonly selectedPricingFallbacks = computed(() => {
    const session = this.selectedSession();

    if (!session) {
      return [];
    }

    return session.modelBreakdown
      .filter((entry) => this.usesPricingFallback(entry.model, entry.pricingModel))
      .map((entry) => ({
        model: entry.model,
        pricingModel: entry.pricingModel,
        turns: entry.turns,
      }));
  });
  protected readonly selectedTriage = computed(() => {
    const session = this.selectedSession();
    return session ? this.sessionTriage(session) : null;
  });
  protected readonly selectedSizeHelp = computed(() => {
    const triage = this.selectedTriage();
    return triage ? this.sessionSizeHelp(triage) : '';
  });

  protected readonly summary = computed(() => {
    const sessions = this.sessions();
    const totals = sessions.reduce(
      (acc, session) => {
        acc.usd += session.cost.usd;
        acc.eur += session.cost.eur;
        acc.input += session.tokens.input;
        acc.output += session.tokens.output;
        acc.cachedInput += session.tokens.cachedInput;
        acc.cacheWrite += session.tokens.cacheWrite;
        return acc;
      },
      { usd: 0, eur: 0, input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
    );

    return { count: sessions.length, ...totals };
  });

  private initializedFromLedger = false;

  constructor() {
    effect(() => {
      const ledger = this.ledger();

      if (!ledger || this.initializedFromLedger) {
        return;
      }

      this.initializedFromLedger = true;
      this.selectedId.set(ledger.sessions[0]?.id ?? null);
      this.compareA.set(ledger.sessions[0]?.id ?? null);
      this.compareB.set(ledger.sessions[1]?.id ?? null);
    });
  }

  protected selectSession(session: LedgerSession): void {
    this.selectedId.set(session.id);
    this.selectedRunView.set('overview');
    this.selectedTraceEventIndex.set(null);
  }

  protected openFirstFilteredSession(): void {
    const session = this.filteredSessions()[0];

    if (session) {
      this.selectSession(session);
    }
  }

  protected trackBySessionId(_: number, session: LedgerSession): string {
    return session.id;
  }

  protected setQuery(value: string): void {
    this.query.set(value);
  }

  protected setSizeFilter(value: 'all' | SessionSize): void {
    this.sizeFilter.set(value);
  }

  protected setWarningFilter(value: string): void {
    this.warningFilter.set(value);
  }

  protected setSourceFilter(value: SessionSourceFilter): void {
    this.sourceFilter.set(value);
  }

  protected setTraceFilter(value: TraceFilter): void {
    this.traceFilter.set(value);
    this.selectedTraceEventIndex.set(null);
  }

  protected selectTraceEvent(event: TraceEvent): void {
    this.selectedTraceEventIndex.set(event.index);
  }

  protected openTraceEvent(index: number): void {
    this.selectedRunView.set('trace');
    this.traceView.set('logs');
    this.traceFilter.set('all');
    this.selectedTraceEventIndex.set(index);
  }

  protected pricingFallbackReason(model: string, pricingModel: string): string {
    if (model === pricingModel && MODEL_PRICES_USD_PER_MILLION[model]) {
      return 'This model matched a GitHub price row directly.';
    }

    return `${model || 'Unknown model'} is priced with the ${pricingModel} row because that raw model id is not in the local GitHub pricing table.`;
  }

  protected openSession(session: LedgerSession | null): void {
    if (!session) {
      return;
    }

    this.selectedId.set(session.id);
    this.activeView.set('sessions');
    this.selectedRunView.set('overview');
    this.selectedTraceEventIndex.set(null);
  }

  protected sessionTriage(session: LedgerSession): SessionTriage {
    const totalTokens = this.sessionTotalTokens(session);
    const size = this.sessionSize(totalTokens);
    const warnings: SessionWarning[] = [];
    const contextGrowth = this.contextGrowth(session);
    const maxInput = Math.max(
      ...session.traceEvents
        .filter((event) => event.type === 'llm_request')
        .map((event) => event.inputTokens),
      0,
    );

    if (session.tokens.input >= 150_000 || maxInput >= 100_000) {
      warnings.push({
        label: 'High input context',
        tone: 'high',
        help:
          'Large prompt/context payloads are being sent into the model. This usually means repo context, prior conversation, or tool results are driving cost.',
      });
    }

    if (contextGrowth !== null && contextGrowth >= 25) {
      warnings.push({
        label: 'Context growth',
        tone: contextGrowth >= 80 ? 'medium' : 'info',
        help:
          'Expected in many agent runs: later model calls received more input tokens than early calls. It matters because accumulated context is often resent and can become a major cost driver.',
      });
    }

    if (session.modelBreakdown.length > 1) {
      warnings.push({
        label: 'Mixed models',
        tone: 'medium',
        help:
          'This run used more than one model. Cost is the sum of each model row, so model switches can make estimates harder to read at a glance.',
      });
    }

    if (session.tokens.cachedInput === 0 && session.tokens.cacheWrite === 0) {
      warnings.push({
        label: 'Cache unknown',
        tone: 'info',
        help:
          'The local VS Code debug logs imported here do not expose provider cache read/write billing fields. Do not read this as proof that provider-side cache billing was zero.',
      });
    }

    if (session.vscodeState) {
      warnings.push({
        label: 'State enriched',
        tone: 'info',
        help:
          'The title or metadata was improved from VS Code state.vscdb. Pricing still comes from token-bearing debug-log events.',
      });
    }

    return {
      size,
      sizeTone: size === 'Very large' ? 'high' : size === 'Large' ? 'medium' : 'info',
      totalTokens,
      warnings,
    };
  }

  protected sessionSizeHelp(triage: SessionTriage): string {
    return `${triage.size} session based on ${triage.totalTokens.toLocaleString()} imported tokens. Current thresholds: Small under 50k, Medium under 200k, Large under 600k, Very large at 600k or more.`;
  }

  private matchesQuery(session: LedgerSession, query: string): boolean {
    if (!query) {
      return true;
    }

    return [session.firstPrompt, session.title, session.workspace, session.model, session.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query);
  }

  private matchesSizeFilter(session: LedgerSession, value: 'all' | SessionSize): boolean {
    return value === 'all' || this.sessionTriage(session).size === value;
  }

  private matchesWarningFilter(session: LedgerSession, value: string): boolean {
    return value === 'all' || this.sessionTriage(session).warnings.some((warning) => warning.label === value);
  }

  private matchesSourceFilter(session: LedgerSession, value: SessionSourceFilter): boolean {
    if (value === 'all') {
      return true;
    }

    if (value === 'debug-log') {
      return session.sourceKind === 'vscode-copilot-debug-log';
    }

    if (value === 'chat-snapshot') {
      return session.sourceKind === 'vscode-chat-session-snapshot';
    }

    return session.confidence === value;
  }

  protected sourceKindHelp(sourceKind: string): string {
    if (sourceKind === 'vscode-copilot-debug-log') {
      return this.help.debugLogs;
    }

    if (sourceKind === 'vscode-chat-session-snapshot') {
      return this.help.chatSnapshots;
    }

    return 'Imported local session source. Check the generated ledger sourceKind for the exact importer path.';
  }

  protected sourceKindLabel(sourceKind: string): string {
    if (sourceKind === 'vscode-copilot-debug-log') {
      return 'Debug log';
    }

    if (sourceKind === 'vscode-chat-session-snapshot') {
      return 'Chat snapshot';
    }

    return sourceKind;
  }

  protected tokenSourceHelp(tokenSource: string): string {
    if (tokenSource === 'llm_request_token_totals') {
      return 'Strongest local token source: VS Code logged input and output token counts for each model call. Cache billing is still not visible here.';
    }

    if (tokenSource === 'chat-snapshot-output-plus-visible-input-estimate') {
      return 'We estimate from visible chat text and any completion token fields. This is weaker than debug logs.';
    }

    return 'Token source recorded by the scanner. Treat unknown sources as lower confidence until documented.';
  }

  protected tokenSourceLabel(tokenSource: string): string {
    if (tokenSource === 'llm_request_token_totals') {
      return 'Debug-log token counts';
    }

    if (tokenSource === 'chat-snapshot-output-plus-visible-input-estimate') {
      return 'Chat snapshot estimate';
    }

    return tokenSource;
  }

  protected confidenceHelp(confidence: string): string {
    if (confidence === 'exact') {
      return 'Exact for the token fields VS Code logged locally. It is still not a final billing guarantee.';
    }

    if (confidence === 'estimated') {
      return 'Estimated from weaker local data. Useful for direction, but not billing-grade.';
    }

    if (confidence === 'reconciled') {
      return 'Matched to an external billing or usage source while preserving the local estimate.';
    }

    return 'Sample or incomplete data. Use only as rough context.';
  }

  protected confidenceLabel(confidence: string): string {
    if (confidence === 'exact') {
      return 'Exact local data';
    }

    if (confidence === 'estimated') {
      return 'Estimated data';
    }

    if (confidence === 'reconciled') {
      return 'Reconciled data';
    }

    return confidence;
  }

  private explainModelCost(entry: ModelBreakdown, usdToEur: number, sessionCostEur: number) {
    const pricingModel = entry.pricingModel || entry.model;
    const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL];
    const inputEur = this.tokenCostEur(entry.tokens.input, price.input, usdToEur);
    const cachedInputEur = this.tokenCostEur(entry.tokens.cachedInput, price.cachedInput, usdToEur);
    const cacheWriteEur = this.tokenCostEur(entry.tokens.cacheWrite, price.cacheWrite ?? 0, usdToEur);
    const outputEur = this.tokenCostEur(entry.tokens.output, price.output, usdToEur);
    const totalEur = inputEur + cachedInputEur + cacheWriteEur + outputEur;

    return {
      ...entry,
      provider: price.provider,
      releaseStatus: price.releaseStatus,
      category: price.category,
      inputRate: price.input,
      cachedInputRate: price.cachedInput,
      cacheWriteRate: price.cacheWrite ?? 0,
      outputRate: price.output,
      inputEur,
      cachedInputEur,
      cacheWriteEur,
      outputEur,
      totalEur,
      share: sessionCostEur > 0 ? (totalEur / sessionCostEur) * 100 : 0,
      usesFallbackPrice: this.usesPricingFallback(entry.model, pricingModel),
    };
  }

  private explainCategoryCosts(modelRows: ReturnType<App['explainModelCost']>[]) {
    return [
      {
        label: 'Input',
        tokens: this.sumTokens(modelRows, 'input'),
        eur: modelRows.reduce((sum, row) => sum + row.inputEur, 0),
        description: 'Prompt, context, tool, and repository material sent into the model.',
      },
      {
        label: 'Output',
        tokens: this.sumTokens(modelRows, 'output'),
        eur: modelRows.reduce((sum, row) => sum + row.outputEur, 0),
        description: 'Generated model response tokens.',
      },
      {
        label: 'Cached input',
        tokens: this.sumTokens(modelRows, 'cachedInput'),
        eur: modelRows.reduce((sum, row) => sum + row.cachedInputEur, 0),
        description: 'Prompt tokens served from provider cache when that billing signal is available.',
      },
      {
        label: 'Cache write',
        tokens: this.sumTokens(modelRows, 'cacheWrite'),
        eur: modelRows.reduce((sum, row) => sum + row.cacheWriteEur, 0),
        description: 'Provider cache creation tokens. GitHub lists this mainly for Anthropic models.',
      },
    ];
  }

  private costAnswer(
    session: LedgerSession,
    modelRows: ReturnType<App['explainModelCost']>[],
    modelCallRows: ReturnType<App['modelCallRows']>,
  ) {
    const sessionCost = Math.max(session.cost.eur, 0);
    const totalTokens = this.sessionTotalTokens(session);
    const inputEur = modelRows.reduce((sum, row) => sum + row.inputEur, 0);
    const outputEur = modelRows.reduce((sum, row) => sum + row.outputEur, 0);
    const inputShare = sessionCost > 0 ? (inputEur / sessionCost) * 100 : 0;
    const outputShare = sessionCost > 0 ? (outputEur / sessionCost) * 100 : 0;
    const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0] ?? null;
    const topModelShare = topModel && sessionCost > 0 ? (topModel.totalEur / sessionCost) * 100 : 0;
    const topCall = [...modelCallRows].sort((a, b) => b.estimatedEur - a.estimatedEur)[0] ?? null;
    const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedEur / sessionCost) * 100 : 0;
    const category = inputShare >= outputShare ? 'Input/context' : 'Output';
    const categoryShare = Math.max(inputShare, outputShare);
    const costPer1k = totalTokens ? (sessionCost / totalTokens) * 1000 : 0;

    return {
      category,
      categoryShare,
      categoryDetail:
        category === 'Input/context'
          ? 'Most of the estimate comes from tokens sent into the model: prompt, prior chat, repo context, and tool results.'
          : 'Most of the estimate comes from generated model output. Inspect long responses or repeated generation.',
      costPer1k,
      inputShare,
      outputShare,
      topModelLabel: topModel?.model ?? session.model,
      topModelShare,
      topCallLabel: topCall ? `#${topCall.callNumber}` : 'None',
      topCallShare,
      topCallDetail: topCall
        ? `Raw event #${topCall.index}, ${topCall.totalTokens.toLocaleString()} tokens.`
        : 'No token-bearing model call rows were imported.',
    };
  }

  private turnInsights(modelCallRows: ReturnType<App['modelCallRows']>) {
    const totalCost = modelCallRows.reduce((sum, row) => sum + row.estimatedEur, 0);
    const mostExpensive = [...modelCallRows].sort((a, b) => b.estimatedEur - a.estimatedEur)[0] ?? null;
    const largestInput = [...modelCallRows].sort((a, b) => b.inputTokens - a.inputTokens)[0] ?? null;
    const largestOutput = [...modelCallRows].sort((a, b) => b.outputTokens - a.outputTokens)[0] ?? null;
    const averageCost = modelCallRows.length ? totalCost / modelCallRows.length : 0;

    return [
      {
        label: 'Model calls',
        value: modelCallRows.length.toLocaleString(),
        detail: 'Token-bearing llm_request events imported from the VS Code debug log.',
      },
      {
        label: 'Most expensive call',
        value: mostExpensive ? `#${mostExpensive.callNumber} · €${mostExpensive.estimatedEur.toFixed(4)}` : 'None',
        detail: mostExpensive
          ? `${mostExpensive.totalTokens.toLocaleString()} tokens, raw event #${mostExpensive.index}.`
          : 'No priced model call rows are available.',
      },
      {
        label: 'Largest input',
        value: largestInput ? `#${largestInput.callNumber} · ${largestInput.inputTokens.toLocaleString()}` : 'None',
        detail: largestInput
          ? 'This is the biggest prompt/context payload sent into the model.'
          : 'No input token totals were imported.',
      },
      {
        label: 'Largest output',
        value: largestOutput ? `#${largestOutput.callNumber} · ${largestOutput.outputTokens.toLocaleString()}` : 'None',
        detail: largestOutput
          ? 'This is the largest generated response in the imported model calls.'
          : 'No output token totals were imported.',
      },
      {
        label: 'Avg cost / call',
        value: `€${averageCost.toFixed(4)}`,
        detail: 'Useful for spotting whether cost came from one spike or many steady calls.',
      },
    ];
  }

  private billingRealityCheck(
    session: LedgerSession,
    costAnswer: ReturnType<App['costAnswer']>,
    hasCacheData: boolean,
  ) {
    if (hasCacheData) {
      return {
        tone: 'low',
        cacheVisibility: 'Cache fields present',
        confidenceLabel: 'Cache-aware local estimate',
        headline: 'This run includes cache token fields in the ledger.',
        detail:
          'The app can price normal input, cached input, cache write, and output separately for this run. It is still a local estimate, not an invoice.',
      };
    }

    if (costAnswer.outputShare >= 70) {
      return {
        tone: 'low',
        cacheVisibility: 'Cache fields unavailable',
        confidenceLabel: 'Low cache impact likely',
        headline: 'Output dominates this estimate.',
        detail:
          'Missing cached input is less likely to change the main story because generated output remains billed as output. Use the estimate to debug response size and repeated generation first.',
      };
    }

    if (costAnswer.inputShare >= 60) {
      return {
        tone: 'high',
        cacheVisibility: 'Cache fields unavailable',
        confidenceLabel: 'Cache could materially change estimate',
        headline: 'Input/context dominates this estimate.',
        detail:
          'VS Code logged input tokens, but did not split normal input from cached input. If much of this context was cached provider-side, the invoice may be lower than this local full-input estimate.',
      };
    }

    return {
      tone: session.confidence === 'exact' ? 'medium' : 'high',
      cacheVisibility: 'Cache fields unavailable',
      confidenceLabel: session.confidence === 'exact' ? 'Directional billing estimate' : 'Rough billing estimate',
      headline: 'Cache impact is unknown for this token mix.',
      detail:
        'The imported data is still useful for finding the expensive turns and model mix, but it cannot prove how GitHub split input between normal and cached billing buckets.',
    };
  }

  private explainCostDrivers(
    session: LedgerSession,
    modelRows: ReturnType<App['explainModelCost']>[],
    topTokenEvents: ReturnType<App['topTokenEvents']>,
  ) {
    const inputEur = modelRows.reduce((sum, row) => sum + row.inputEur, 0);
    const outputEur = modelRows.reduce((sum, row) => sum + row.outputEur, 0);
    const sessionCost = Math.max(session.cost.eur, 0);
    const inputShare = sessionCost > 0 ? (inputEur / sessionCost) * 100 : 0;
    const outputShare = sessionCost > 0 ? (outputEur / sessionCost) * 100 : 0;
    const topCall = topTokenEvents[0];
    const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedEur / sessionCost) * 100 : 0;
    const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0];
    const topModelShare = topModel && sessionCost > 0 ? (topModel.totalEur / sessionCost) * 100 : 0;
    const contextStats = this.contextStats(session);
    const growth = contextStats?.growth ?? 0;
    const firstAvg = contextStats?.firstAvg ?? 0;
    const lastAvg = contextStats?.lastAvg ?? 0;
    const llmEventCount = contextStats?.count ?? 0;
    const toolCalls = session.traceSummary.toolCalls;
    const toolsPerTurn = session.traceSummary.modelTurns > 0 ? toolCalls / session.traceSummary.modelTurns : 0;
    const mixedModelCount = modelRows.length;

    return [
      {
        title: 'Input context burn',
        value: `${Math.round(inputShare)}%`,
        detail:
          inputShare >= outputShare
            ? `Most cost is prompt/context material sent into the model: ${session.tokens.input.toLocaleString()} input tokens.`
            : `Output is the larger priced category here, but input still contributes ${inputShare.toFixed(0)}% of this estimate.`,
        tone: inputShare >= 75 ? 'high' : inputShare >= 50 ? 'medium' : 'low',
      },
      {
        title: 'Largest model call',
        value: topCall ? `€${topCall.estimatedEur.toFixed(4)}` : 'None',
        detail: topCall
          ? `Raw event index #${topCall.index} used ${topCall.totalTokens.toLocaleString()} tokens and accounts for about ${topCallShare.toFixed(0)}% of this run.`
          : 'No token-bearing model calls were imported for this session.',
        tone: topCallShare >= 25 ? 'high' : topCallShare >= 10 ? 'medium' : 'low',
      },
      {
        title: 'Context growth',
        value: llmEventCount >= 2 ? `${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%` : 'n/a',
        detail:
          llmEventCount >= 2
            ? `Average input moved from ${Math.round(firstAvg).toLocaleString()} tokens at the start to ${Math.round(lastAvg).toLocaleString()} near the end.`
            : 'Not enough model calls to detect whether context grew during the run.',
        tone: growth >= 80 ? 'high' : growth >= 25 ? 'medium' : 'low',
      },
      {
        title: 'Model mix',
        value: mixedModelCount === 1 ? topModel?.model ?? session.model : `${mixedModelCount} models`,
        detail: topModel
          ? `${topModel.model} contributes about ${topModelShare.toFixed(0)}% of estimated cost using the ${topModel.pricingModel} price row.`
          : 'No model breakdown is available for this session.',
        tone: mixedModelCount > 1 || topModelShare >= 80 ? 'medium' : 'low',
      },
      {
        title: 'Tool activity',
        value: toolCalls.toLocaleString(),
        detail:
          toolCalls > 0
            ? `${toolsPerTurn.toFixed(1)} tool calls per model turn. Tool results can increase later prompt/context size when they are sent back to the model.`
            : 'No tool calls were imported for this session.',
        tone: toolsPerTurn >= 4 ? 'high' : toolsPerTurn >= 2 ? 'medium' : 'low',
      },
    ];
  }

  private topTokenEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
    return this.pricedModelCallEvents(events, modelBreakdown, usdToEur)
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 5);
  }

  private modelCallRows(
    events: TraceEvent[],
    modelBreakdown: ModelBreakdown[],
    usdToEur: number,
    sessionCostEur: number,
    sort: ModelCallSort,
  ) {
    const rows = this.pricedModelCallEvents(events, modelBreakdown, usdToEur).map((event, index) => {
      const context = this.nearbyContextForEvent(event, events);

      return {
        ...event,
        callNumber: index + 1,
        share: sessionCostEur > 0 ? (event.estimatedEur / sessionCostEur) * 100 : 0,
        contextLabel: context.label,
        contextDetail: context.detail,
      };
    });

    return sort === 'largest'
      ? [...rows].sort((a, b) => b.estimatedEur - a.estimatedEur || b.totalTokens - a.totalTokens)
      : rows;
  }

  private pricedModelCallEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
    return events
      .filter((event) => event.inputTokens || event.outputTokens)
      .map((event) => {
        const pricingModel = this.pricingModelForEvent(event, modelBreakdown);
        const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL];
        const inputEur = this.tokenCostEur(event.inputTokens, price.input, usdToEur);
        const outputEur = this.tokenCostEur(event.outputTokens, price.output, usdToEur);
        const estimatedEur =
          event.estimatedCost?.eur ??
          inputEur + outputEur;

        return {
          ...event,
          totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
          pricingModel,
          usesFallbackPrice: this.usesPricingFallback(event.model || this.modelFromEventDetail(event.detail), pricingModel),
          inputEur,
          outputEur,
          estimatedEur,
        };
      });
  }

  private flowTraceEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
    return events
      .filter((event) => this.isFlowEvent(event))
      .map((event, index) => {
        const pricingModel = this.pricingModelForEvent(event, modelBreakdown);
        const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL];
        const estimatedEur =
          event.estimatedCost?.eur ??
          this.tokenCostEur(event.inputTokens, price.input, usdToEur) +
            this.tokenCostEur(event.outputTokens, price.output, usdToEur);

        return {
          ...event,
          flowIndex: index + 1,
          totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
          pricingModel,
          estimatedEur,
        };
      });
  }

  private isFlowEvent(event: TraceEvent): boolean {
    return (
      event.type === 'user_message' ||
      event.type === 'llm_request' ||
      event.type.includes('tool') ||
      event.type === 'agent_response'
    );
  }

  private matchesTraceFilter(event: TraceEvent, filter: TraceFilter): boolean {
    if (filter === 'all') {
      return true;
    }

    if (filter === 'model') {
      return Boolean(event.inputTokens || event.outputTokens || event.type === 'llm_request');
    }

    if (filter === 'tool') {
      return event.type.includes('tool') || this.toolLikeEventNames().some((name) => event.name.toLowerCase().includes(name));
    }

    if (filter === 'discovery') {
      return event.type === 'discovery' || event.name.toLowerCase().includes('discovery') || event.detail.toLowerCase().includes('resolved ');
    }

    if (filter === 'message') {
      return event.type === 'user_message';
    }

    if (filter === 'response') {
      return event.type === 'agent_response' || event.type === 'assistant.message';
    }

    return event.status !== 'ok' && event.status !== 'unknown';
  }

  private traceEventDetails(event: TraceEvent, modelBreakdown: ModelBreakdown[], usdToEur: number) {
    const pricingModel = this.pricingModelForEvent(event, modelBreakdown);
    const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL];
    const inputEur = this.tokenCostEur(event.inputTokens, price.input, usdToEur);
    const outputEur = this.tokenCostEur(event.outputTokens, price.output, usdToEur);
    const estimatedEur = event.estimatedCost?.eur ?? inputEur + outputEur;
    const totalTokens = event.totalTokens ?? event.inputTokens + event.outputTokens;
    const rawModel = event.rawModel || event.model || this.modelFromEventDetail(event.detail);
    const normalizedFields = [
      { label: 'Raw index', value: `#${event.index}` },
      { label: 'Timestamp', value: event.timestamp },
      { label: 'Type', value: event.type },
      { label: 'Name', value: event.name },
      { label: 'Status', value: event.status },
      ...(event.model ? [{ label: 'Model', value: event.model }] : []),
      ...(rawModel ? [{ label: 'Raw model', value: rawModel }] : []),
      ...(event.inputTokens || event.outputTokens
        ? [
            { label: 'Input tokens', value: event.inputTokens.toLocaleString() },
            { label: 'Output tokens', value: event.outputTokens.toLocaleString() },
            { label: 'Total tokens', value: totalTokens.toLocaleString() },
            { label: 'Pricing row', value: pricingModel },
            { label: 'Estimated cost', value: `€${estimatedEur.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}` },
          ]
        : []),
      ...(event.ttftMs ? [{ label: 'TTFT', value: `${event.ttftMs.toLocaleString()} ms` }] : []),
      ...(event.maxTokens ? [{ label: 'Max tokens', value: event.maxTokens.toLocaleString() }] : []),
      ...(event.hasReasoning ? [{ label: 'Reasoning text', value: 'Present in debug log payload' }] : []),
    ];

    return {
      normalizedFields,
      attributeFields: event.attributes ?? [],
      detail: event.detail || 'No detail text imported for this event.',
      hasCost: Boolean(event.inputTokens || event.outputTokens),
      inputEur,
      outputEur,
      estimatedEur,
      totalTokens,
      pricingModel,
      usesFallbackPrice: this.usesPricingFallback(rawModel, pricingModel),
    };
  }

  private toolLikeEventNames(): string[] {
    return ['read_file', 'list_dir', 'grep_search', 'semantic_search', 'fetch_webpage', 'apply_patch', 'run_in_terminal'];
  }

  private pricingModelForEvent(event: TraceEvent, modelBreakdown: ModelBreakdown[]): string {
    if (event.pricingModel) {
      return event.pricingModel;
    }

    const sessionPricingModel = modelBreakdown.length === 1 ? modelBreakdown[0].pricingModel : null;
    const parsedModel = event.model ?? this.modelFromEventDetail(event.detail);
    return this.matchPricingModel(parsedModel) ?? sessionPricingModel ?? FALLBACK_PRICING_MODEL;
  }

  private tokenCostEur(tokens: number, usdPerMillion: number, usdToEur: number): number {
    return (tokens / 1_000_000) * usdPerMillion * usdToEur;
  }

  private nearbyContextForEvent(event: TraceEvent, events: TraceEvent[]): { label: string; detail: string } {
    const prior = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.index < event.index &&
          candidate.detail &&
          candidate.type !== 'llm_request' &&
          candidate.type !== 'agent_response',
      );

    if (!prior) {
      return {
        label: 'No nearby context',
        detail: this.compactText(event.detail),
      };
    }

    return {
      label: this.readableEventType(prior.type),
      detail: this.compactText(prior.detail),
    };
  }

  private readableEventType(type: string): string {
    if (type === 'user_message') {
      return 'After user prompt';
    }

    if (type.includes('tool')) {
      return 'After tool event';
    }

    return `After ${type.replace(/_/g, ' ')}`;
  }

  private compactText(value: string, maxLength = 180): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();

    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  private average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  private sessionTotalTokens(session: LedgerSession): number {
    return this.tokenTotal(session.tokens);
  }

  private tokenTotal(tokens: TokenBreakdown): number {
    return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
  }

  private sessionSize(tokens: number): SessionSize {
    if (tokens >= 600_000) {
      return 'Very large';
    }

    if (tokens >= 200_000) {
      return 'Large';
    }

    if (tokens >= 50_000) {
      return 'Medium';
    }

    return 'Small';
  }

  private contextGrowth(session: LedgerSession): number | null {
    return this.contextStats(session)?.growth ?? null;
  }

  private contextStats(session: LedgerSession): { firstAvg: number; lastAvg: number; growth: number; count: number } | null {
    const llmEvents = session.traceEvents
      .filter((event) => event.type === 'llm_request' && (event.inputTokens || event.outputTokens))
      .sort((a, b) => a.index - b.index);

    if (llmEvents.length < 2) {
      return null;
    }

    const firstAvg = this.average(llmEvents.slice(0, 3).map((event) => event.inputTokens));
    const lastAvg = this.average(llmEvents.slice(-3).map((event) => event.inputTokens));

    return {
      firstAvg,
      lastAvg,
      growth: firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0,
      count: llmEvents.length,
    };
  }

  private sumTokens(rows: { tokens: TokenBreakdown }[], field: keyof TokenBreakdown): number {
    return rows.reduce((sum, row) => sum + row.tokens[field], 0);
  }

  private modelFromEventDetail(detail: string): string {
    return String(detail).split(':')[0]?.trim() ?? '';
  }

  private matchPricingModel(rawModel: string): string | null {
    const rawKey = this.modelKey(rawModel);
    if (!rawKey) {
      return null;
    }

    return (
      Object.keys(MODEL_PRICES_USD_PER_MILLION).find((model) => this.modelKey(model) === rawKey) ??
      Object.keys(MODEL_PRICES_USD_PER_MILLION).find((model) => rawKey.includes(this.modelKey(model))) ??
      null
    );
  }

  private usesPricingFallback(model: string | null | undefined, pricingModel: string | null | undefined): boolean {
    const rawModel = model || '';
    const priceRow = pricingModel || rawModel;

    return priceRow !== rawModel || !MODEL_PRICES_USD_PER_MILLION[rawModel];
  }

  private modelKey(model: string): string {
    return String(model ?? '')
      .replace(/^copilot\//i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

}
