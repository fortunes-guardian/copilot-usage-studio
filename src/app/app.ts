import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LedgerData, LedgerSession, ModelBreakdown, TokenBreakdown, TraceEvent } from './ledger.model';
import {
  MODEL_PRICES_USD_PER_MILLION,
  PRICING_EFFECTIVE_DATE,
  PRICING_IMPORTED_AT,
  PRICING_SOURCE_LABEL,
  PRICING_SOURCE_URL,
  PRICING_VERSION,
} from './pricing';

type SessionSize = 'Small' | 'Medium' | 'Large' | 'Very large';
type WarningTone = 'low' | 'info' | 'medium' | 'high';
type SessionSourceFilter = 'all' | 'debug-log' | 'chat-snapshot' | 'exact' | 'estimated';
type ActiveView = 'sessions' | 'compare' | 'analytics' | 'pricing';
type AnalyticsTimeRange = 'all' | '7d' | '30d' | '90d';
type AnalyticsGrouping = 'day' | 'week' | 'month';
type ModelCallSort = 'timeline' | 'largest';

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

interface ComparisonMetric {
  label: string;
  a: number;
  b: number;
  delta: number;
  percent: number | null;
  format: 'currency' | 'number' | 'percent';
  lowerIsBetter: boolean;
  help: string;
}

interface ComparisonDriver {
  title: string;
  value: string;
  tone: WarningTone;
  detail: string;
}

interface AnalyticsMetric {
  label: string;
  value: string;
  help: string;
}

interface AnalyticsHighlight {
  label: string;
  session: LedgerSession | null;
  value: string;
  help: string;
}

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, FormsModule, NgClass],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly ledger = signal<LedgerData | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly compareA = signal<string | null>(null);
  protected readonly compareB = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly sizeFilter = signal<'all' | SessionSize>('all');
  protected readonly warningFilter = signal<string>('all');
  protected readonly sourceFilter = signal<SessionSourceFilter>('all');
  protected readonly analyticsTimeRange = signal<AnalyticsTimeRange>('all');
  protected readonly analyticsWorkspaceFilter = signal('all');
  protected readonly analyticsModelFilter = signal('all');
  protected readonly analyticsGrouping = signal<AnalyticsGrouping>('day');
  protected readonly traceView = signal<'logs' | 'flow'>('logs');
  protected readonly modelCallSort = signal<ModelCallSort>('timeline');
  protected readonly activeView = signal<ActiveView>('sessions');
  protected readonly pricingVersion = PRICING_VERSION;
  protected readonly pricingSourceLabel = PRICING_SOURCE_LABEL;
  protected readonly pricingSourceUrl = PRICING_SOURCE_URL;
  protected readonly pricingEffectiveDate = PRICING_EFFECTIVE_DATE;
  protected readonly pricingImportedAt = PRICING_IMPORTED_AT;
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
    analyticsScope:
      'Multi-session analytics start from the sessions currently included by the sidebar filters, then apply the Analytics controls on this page.',
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
  protected readonly analyticsTimeOptions: Array<{ value: AnalyticsTimeRange; label: string }> = [
    { value: 'all', label: 'All time' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ];
  protected readonly analyticsGroupingOptions: Array<{ value: AnalyticsGrouping; label: string }> = [
    { value: 'day', label: 'By day' },
    { value: 'week', label: 'By week' },
    { value: 'month', label: 'By month' },
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
  protected readonly pricingRows = computed(() =>
    Object.entries(MODEL_PRICES_USD_PER_MILLION).map(([model, price]) => ({
      model,
      ...price,
      cacheWrite: price.cacheWrite ?? 0,
      usedByImportedSessions: this.sessions().some((session) =>
        session.modelBreakdown.some((entry) => entry.pricingModel === model),
      ),
    })),
  );
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
      costDrivers,
      modelCallRows,
      topTokenEvents,
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
  protected readonly analyticsWorkspaceOptions = computed(() => {
    const workspaces = new Set(this.filteredSessions().map((session) => session.workspace).filter(Boolean));
    const selected = this.analyticsWorkspaceFilter();
    if (selected !== 'all') {
      workspaces.add(selected);
    }

    return ['all', ...[...workspaces].sort()];
  });
  protected readonly analyticsModelOptions = computed(() => {
    const models = new Set<string>();

    for (const session of this.filteredSessions()) {
      for (const row of session.modelBreakdown) {
        models.add(row.pricingModel || row.model);
      }
    }

    const selected = this.analyticsModelFilter();
    if (selected !== 'all') {
      models.add(selected);
    }

    return ['all', ...[...models].sort()];
  });
  protected readonly analyticsSessions = computed(() => {
    const timeRange = this.analyticsTimeRange();
    const workspace = this.analyticsWorkspaceFilter();
    const model = this.analyticsModelFilter();
    const cutoff = this.analyticsCutoff(this.filteredSessions(), timeRange);

    return this.filteredSessions().filter((session) => {
      if (cutoff && new Date(session.startedAt).getTime() < cutoff) {
        return false;
      }

      if (workspace !== 'all' && session.workspace !== workspace) {
        return false;
      }

      if (
        model !== 'all' &&
        !session.modelBreakdown.some((row) => row.pricingModel === model || row.model === model)
      ) {
        return false;
      }

      return true;
    });
  });

  protected readonly selectedSession = computed(() => {
    const id = this.selectedId() ?? this.filteredSessions()[0]?.id;
    return this.sessions().find((session) => session.id === id) ?? null;
  });
  protected readonly selectedTriage = computed(() => {
    const session = this.selectedSession();
    return session ? this.sessionTriage(session) : null;
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

  protected readonly analytics = computed(() => {
    const sessions = this.analyticsSessions();
    const count = sessions.length;
    const sidebarCount = this.filteredSessions().length;
    const totalTokens = sessions.reduce((sum, session) => sum + this.sessionTotalTokens(session), 0);
    const totalCost = sessions.reduce((sum, session) => sum + session.cost.eur, 0);
    const avgTokens = count ? totalTokens / count : 0;
    const avgCost = count ? totalCost / count : 0;
    const costPer1k = totalTokens ? (totalCost / totalTokens) * 1000 : 0;
    const highestTokens = this.maxBy(sessions, (session) => this.sessionTotalTokens(session));
    const highestCost = this.maxBy(sessions, (session) => session.cost.eur);
    const modelRows = this.analyticsModelRows(sessions, totalCost);
    const trendRows = this.analyticsTrendRows(sessions, this.analyticsGrouping());
    const distribution = this.sizeOptions
      .filter((size): size is SessionSize => size !== 'all')
      .map((size) => {
        const bucket = sessions.filter((session) => this.sessionSize(this.sessionTotalTokens(session)) === size);
        const tokens = bucket.reduce((sum, session) => sum + this.sessionTotalTokens(session), 0);
        const cost = bucket.reduce((sum, session) => sum + session.cost.eur, 0);

        return {
          size,
          count: bucket.length,
          tokens,
          cost,
          share: totalCost > 0 ? (cost / totalCost) * 100 : 0,
        };
      });
    const outliers = this.analyticsOutliers(sessions, avgCost, avgTokens);
    const analyticsFiltersActive =
      this.analyticsTimeRange() !== 'all' ||
      this.analyticsWorkspaceFilter() !== 'all' ||
      this.analyticsModelFilter() !== 'all' ||
      this.analyticsGrouping() !== 'day';
    const analyticsExcludedCount = Math.max(sidebarCount - count, 0);

    return {
      count,
      sidebarCount,
      analyticsFiltersActive,
      analyticsExcludedCount,
      emptyTitle:
        sidebarCount === 0
          ? 'No sidebar-filtered sessions'
          : 'No sessions in this Analytics cohort',
      emptyDetail:
        sidebarCount === 0
          ? 'The sidebar search, size, signal, or source filters exclude every imported session.'
          : `${analyticsExcludedCount.toLocaleString()} sidebar-filtered session${analyticsExcludedCount === 1 ? '' : 's'} excluded by the Analytics controls. Reset the Analytics filters to return to the sidebar cohort.`,
      scopeLabel:
        count === this.sessions().length && sidebarCount === this.sessions().length
          ? 'All imported sessions'
          : 'Filtered sessions',
      timeRangeLabel:
        this.analyticsTimeOptions.find((option) => option.value === this.analyticsTimeRange())?.label ?? 'All time',
      workspaceLabel: this.analyticsWorkspaceFilter() === 'all' ? 'All workspaces' : this.analyticsWorkspaceFilter(),
      modelLabel: this.analyticsModelFilter() === 'all' ? 'All models' : this.analyticsModelFilter(),
      groupingLabel:
        this.analyticsGroupingOptions.find((option) => option.value === this.analyticsGrouping())?.label ?? 'By day',
      metrics: [
        {
          label: 'Total estimate',
          value: `€${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          help: 'Sum of local cost estimates for the sessions currently included by the sidebar filters.',
        },
        {
          label: 'Total tokens',
          value: totalTokens.toLocaleString(),
          help: 'Input, output, cache-read, and cache-write token fields combined across included sessions.',
        },
        {
          label: 'Avg cost / run',
          value: `€${avgCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
          help: 'Mean estimated cost per included session.',
        },
        {
          label: 'Avg tokens / run',
          value: Math.round(avgTokens).toLocaleString(),
          help: 'Mean imported token count per included session.',
        },
        {
          label: 'Cost / 1k tokens',
          value: `€${costPer1k.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
          help: 'Estimated EUR per 1,000 imported tokens. This moves when model mix or input/output mix changes.',
        },
      ] satisfies AnalyticsMetric[],
      highlights: [
        {
          label: 'Highest-token run',
          session: highestTokens,
          value: highestTokens ? `${this.sessionTotalTokens(highestTokens).toLocaleString()} tokens` : 'n/a',
          help: 'The included session with the largest imported token total.',
        },
        {
          label: 'Most expensive run',
          session: highestCost,
          value: highestCost ? `€${highestCost.cost.eur.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : 'n/a',
          help: 'The included session with the highest local cost estimate.',
        },
      ] satisfies AnalyticsHighlight[],
      modelRows,
      trendRows,
      distribution,
      outliers,
    };
  });

  protected readonly comparison = computed(() => {
    const ledger = this.ledger();
    const a = this.sessions().find((session) => session.id === this.compareA());
    const b = this.sessions().find((session) => session.id === this.compareB());

    if (!ledger || !a || !b || a.id === b.id) {
      return null;
    }

    const aAnalysis = this.sessionComparisonAnalysis(a, ledger.usdToEur);
    const bAnalysis = this.sessionComparisonAnalysis(b, ledger.usdToEur);
    const totalTokenDelta = bAnalysis.totalTokens - aAnalysis.totalTokens;
    const costDelta = b.cost.eur - a.cost.eur;
    const inputCostDelta = bAnalysis.inputEur - aAnalysis.inputEur;
    const outputCostDelta = bAnalysis.outputEur - aAnalysis.outputEur;
    const toolDelta = b.traceSummary.toolCalls - a.traceSummary.toolCalls;
    const turnDelta = b.traceSummary.modelTurns - a.traceSummary.modelTurns;
    const contextGrowthDelta = bAnalysis.contextGrowth - aAnalysis.contextGrowth;

    return {
      a,
      b,
      aAnalysis,
      bAnalysis,
      costDelta,
      totalTokenDelta,
      percent: this.percentDelta(a.cost.eur, b.cost.eur),
      summary: this.comparisonSummary(costDelta, totalTokenDelta, inputCostDelta, outputCostDelta, toolDelta, turnDelta),
      metrics: [
        {
          label: 'Estimated cost',
          a: a.cost.eur,
          b: b.cost.eur,
          delta: costDelta,
          percent: this.percentDelta(a.cost.eur, b.cost.eur),
          format: 'currency',
          lowerIsBetter: true,
          help: 'Local estimate from imported VS Code token totals and GitHub price rows.',
        },
        {
          label: 'Input tokens',
          a: a.tokens.input,
          b: b.tokens.input,
          delta: b.tokens.input - a.tokens.input,
          percent: this.percentDelta(a.tokens.input, b.tokens.input),
          format: 'number',
          lowerIsBetter: true,
          help: 'Prompt, repo context, prior conversation, and tool results sent into the model.',
        },
        {
          label: 'Output tokens',
          a: a.tokens.output,
          b: b.tokens.output,
          delta: b.tokens.output - a.tokens.output,
          percent: this.percentDelta(a.tokens.output, b.tokens.output),
          format: 'number',
          lowerIsBetter: false,
          help: 'Generated response tokens. More output can be useful, but it still affects cost.',
        },
        {
          label: 'Model turns',
          a: a.traceSummary.modelTurns,
          b: b.traceSummary.modelTurns,
          delta: turnDelta,
          percent: this.percentDelta(a.traceSummary.modelTurns, b.traceSummary.modelTurns),
          format: 'number',
          lowerIsBetter: false,
          help: 'Model request count. More turns often means more accumulated context gets resent.',
        },
        {
          label: 'Tool calls',
          a: a.traceSummary.toolCalls,
          b: b.traceSummary.toolCalls,
          delta: toolDelta,
          percent: this.percentDelta(a.traceSummary.toolCalls, b.traceSummary.toolCalls),
          format: 'number',
          lowerIsBetter: false,
          help: 'Tool activity. Tool results can become later input context.',
        },
        {
          label: 'Context growth',
          a: aAnalysis.contextGrowth,
          b: bAnalysis.contextGrowth,
          delta: contextGrowthDelta,
          percent: null,
          format: 'percent',
          lowerIsBetter: true,
          help: 'How much average input tokens grew from early model calls to late model calls.',
        },
      ] satisfies ComparisonMetric[],
      drivers: this.comparisonDrivers(aAnalysis, bAnalysis, costDelta, inputCostDelta, outputCostDelta, toolDelta, turnDelta),
      modelRows: this.compareModelRows(aAnalysis.modelRows, bAnalysis.modelRows),
    };
  });
  protected readonly abs = Math.abs;

  constructor() {
    this.http.get<LedgerData>('/data/sessions.json').subscribe((ledger) => {
      this.ledger.set(ledger);
      this.selectedId.set(ledger.sessions[0]?.id ?? null);
      this.compareA.set(ledger.sessions[0]?.id ?? null);
      this.compareB.set(ledger.sessions[1]?.id ?? null);
    });
  }

  protected selectSession(session: LedgerSession): void {
    this.selectedId.set(session.id);
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

  protected setAnalyticsTimeRange(value: AnalyticsTimeRange): void {
    this.analyticsTimeRange.set(value);
  }

  protected setAnalyticsWorkspaceFilter(value: string): void {
    this.analyticsWorkspaceFilter.set(value);
  }

  protected setAnalyticsModelFilter(value: string): void {
    this.analyticsModelFilter.set(value);
  }

  protected setAnalyticsGrouping(value: AnalyticsGrouping): void {
    this.analyticsGrouping.set(value);
  }

  protected resetAnalyticsFilters(): void {
    this.analyticsTimeRange.set('all');
    this.analyticsWorkspaceFilter.set('all');
    this.analyticsModelFilter.set('all');
    this.analyticsGrouping.set('day');
  }

  protected openSession(session: LedgerSession | null): void {
    if (!session) {
      return;
    }

    this.selectedId.set(session.id);
    this.activeView.set('sessions');
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
    const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];
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
      usesFallbackPrice: pricingModel !== entry.model || !MODEL_PRICES_USD_PER_MILLION[entry.model],
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

  private sessionComparisonAnalysis(session: LedgerSession, usdToEur: number) {
    const modelRows = session.modelBreakdown.map((entry) => this.explainModelCost(entry, usdToEur, session.cost.eur));
    const contextStats = this.contextStats(session);
    const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0] ?? null;

    return {
      session,
      modelRows,
      totalTokens: this.sessionTotalTokens(session),
      inputEur: modelRows.reduce((sum, row) => sum + row.inputEur, 0),
      outputEur: modelRows.reduce((sum, row) => sum + row.outputEur, 0),
      cachedInputEur: modelRows.reduce((sum, row) => sum + row.cachedInputEur, 0),
      cacheWriteEur: modelRows.reduce((sum, row) => sum + row.cacheWriteEur, 0),
      contextGrowth: contextStats?.growth ?? 0,
      firstInputAvg: contextStats?.firstAvg ?? 0,
      lastInputAvg: contextStats?.lastAvg ?? 0,
      topModel,
      modelNames: new Set(modelRows.map((row) => row.model)),
      pricingRows: new Set(modelRows.map((row) => row.pricingModel)),
    };
  }

  private analyticsModelRows(sessions: LedgerSession[], totalCost: number) {
    const rows = new Map<
      string,
      {
        model: string;
        pricingModel: string;
        turns: number;
        sessions: Set<string>;
        tokens: number;
        input: number;
        output: number;
        cost: number;
      }
    >();

    for (const session of sessions) {
      for (const entry of session.modelBreakdown) {
        const key = `${entry.model}::${entry.pricingModel}`;
        const current =
          rows.get(key) ??
          {
            model: entry.model,
            pricingModel: entry.pricingModel,
            turns: 0,
            sessions: new Set<string>(),
            tokens: 0,
            input: 0,
            output: 0,
            cost: 0,
          };

        current.turns += entry.turns;
        current.sessions.add(session.id);
        current.tokens += this.tokenTotal(entry.tokens);
        current.input += entry.tokens.input;
        current.output += entry.tokens.output;
        current.cost += entry.cost.eur;
        rows.set(key, current);
      }
    }

    return [...rows.values()]
      .map((row) => ({
        ...row,
        sessionCount: row.sessions.size,
        costPer1k: row.tokens ? (row.cost / row.tokens) * 1000 : 0,
        share: totalCost > 0 ? (row.cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);
  }

  private analyticsTrendRows(sessions: LedgerSession[], grouping: AnalyticsGrouping) {
    const rows = new Map<string, { key: string; label: string; count: number; tokens: number; cost: number }>();

    for (const session of sessions) {
      const group = this.analyticsGroupKey(session.startedAt, grouping);
      const current = rows.get(group.key) ?? { ...group, count: 0, tokens: 0, cost: 0 };

      current.count += 1;
      current.tokens += this.sessionTotalTokens(session);
      current.cost += session.cost.eur;
      rows.set(group.key, current);
    }

    return [...rows.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 8);
  }

  private analyticsOutliers(sessions: LedgerSession[], avgCost: number, avgTokens: number) {
    if (!sessions.length) {
      return [];
    }

    const costStd = this.standardDeviation(sessions.map((session) => session.cost.eur));
    const tokenStd = this.standardDeviation(sessions.map((session) => this.sessionTotalTokens(session)));

    return sessions
      .map((session) => {
        const tokens = this.sessionTotalTokens(session);
        const costScore = costStd > 0 ? (session.cost.eur - avgCost) / costStd : 0;
        const tokenScore = tokenStd > 0 ? (tokens - avgTokens) / tokenStd : 0;
        const score = Math.max(costScore, tokenScore);
        const reason = this.analyticsOutlierReason(session, costScore, tokenScore);

        return { session, tokens, score, reason };
      })
      .filter((row) => row.score >= 1 || sessions.length <= 5)
      .sort((a, b) => b.score - a.score || b.session.cost.eur - a.session.cost.eur)
      .slice(0, 5);
  }

  private analyticsCutoff(sessions: LedgerSession[], timeRange: AnalyticsTimeRange): number | null {
    if (timeRange === 'all' || !sessions.length) {
      return null;
    }

    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const latest = Math.max(...sessions.map((session) => new Date(session.startedAt).getTime()).filter(Number.isFinite));

    if (!Number.isFinite(latest)) {
      return null;
    }

    return latest - days * 24 * 60 * 60 * 1000;
  }

  private analyticsGroupKey(startedAt: string, grouping: AnalyticsGrouping): { key: string; label: string } {
    const date = new Date(startedAt);

    if (!Number.isFinite(date.getTime())) {
      return { key: 'unknown', label: 'Unknown date' };
    }

    const day = this.isoDate(date);

    if (grouping === 'day') {
      return { key: day, label: day };
    }

    if (grouping === 'month') {
      return { key: day.slice(0, 7), label: day.slice(0, 7) };
    }

    const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek + 1);

    return { key: this.isoDate(weekStart), label: `Week of ${this.isoDate(weekStart)}` };
  }

  private analyticsOutlierReason(session: LedgerSession, costScore: number, tokenScore: number): string {
    const totalTokens = this.sessionTotalTokens(session);
    const inputShare = totalTokens ? (session.tokens.input / totalTokens) * 100 : 0;
    const topModel = this.maxBy(session.modelBreakdown, (row) => row.cost.eur);
    const topModelShare = topModel && session.cost.eur > 0 ? (topModel.cost.eur / session.cost.eur) * 100 : 0;
    const contextGrowth = this.contextGrowth(session);
    const modelTurns = session.traceSummary.modelTurns;
    const toolCalls = session.traceSummary.toolCalls;
    const traceActivity = modelTurns + toolCalls;
    const isVeryHighOutlier = Math.max(costScore, tokenScore) >= 2;

    if (isVeryHighOutlier && traceActivity <= 3 && totalTokens >= 100_000) {
      return `Suspicious spike: ${totalTokens.toLocaleString()} tokens with only ${traceActivity.toLocaleString()} imported model/tool events. Inspect the largest model call and source log shape.`;
    }

    if (inputShare >= 85 && session.tokens.input >= 100_000) {
      return `Mostly input/context tokens (${inputShare.toFixed(0)}% of imported tokens). Check prompt context, repo reads, prior conversation, and tool results.`;
    }

    if (topModel && topModelShare >= 70) {
      return `${topModel.pricingModel} produced ${topModelShare.toFixed(0)}% of this run's estimate. Model mix is the first thing to inspect.`;
    }

    if (contextGrowth !== null && contextGrowth >= 50) {
      return `Average input grew ${contextGrowth.toFixed(0)}% from early to late model calls, so repeated context is likely driving the increase.`;
    }

    if (toolCalls >= 20) {
      return `${toolCalls.toLocaleString()} tool calls may have added results back into later model input.`;
    }

    if (session.traceSummary.errors === 0 && modelTurns >= 8 && toolCalls >= 8) {
      return `Large but plausible long agent run: ${modelTurns.toLocaleString()} model turns and ${toolCalls.toLocaleString()} tool calls with no imported errors. Compare context growth before treating it as waste.`;
    }

    return costScore >= tokenScore
      ? `Cost is ${costScore.toFixed(1)} standard deviations above this cohort. Check model price rows and output mix.`
      : `Tokens are ${tokenScore.toFixed(1)} standard deviations above this cohort. Check input context and model-turn count.`;
  }

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private comparisonSummary(
    costDelta: number,
    totalTokenDelta: number,
    inputCostDelta: number,
    outputCostDelta: number,
    toolDelta: number,
    turnDelta: number,
  ): string {
    const direction = costDelta > 0 ? 'more expensive' : costDelta < 0 ? 'cheaper' : 'about the same cost';
    const tokenDirection = totalTokenDelta > 0 ? 'more' : totalTokenDelta < 0 ? 'fewer' : 'the same number of';
    const costDriver =
      Math.abs(inputCostDelta) >= Math.abs(outputCostDelta)
        ? 'input/context tokens'
        : 'generated output tokens';
    const activity =
      Math.abs(turnDelta) >= Math.abs(toolDelta)
        ? `${Math.abs(turnDelta).toLocaleString()} ${turnDelta >= 0 ? 'more' : 'fewer'} model turns`
        : `${Math.abs(toolDelta).toLocaleString()} ${toolDelta >= 0 ? 'more' : 'fewer'} tool calls`;

    if (costDelta === 0 && totalTokenDelta === 0) {
      return 'These runs look equivalent on imported cost and token totals. Check logs if behavior differed qualitatively.';
    }

    return `Run B is ${direction}, with ${Math.abs(totalTokenDelta).toLocaleString()} ${tokenDirection} imported tokens. The largest priced movement is ${costDriver}; activity changed by ${activity}.`;
  }

  private comparisonDrivers(
    a: ReturnType<App['sessionComparisonAnalysis']>,
    b: ReturnType<App['sessionComparisonAnalysis']>,
    costDelta: number,
    inputCostDelta: number,
    outputCostDelta: number,
    toolDelta: number,
    turnDelta: number,
  ): ComparisonDriver[] {
    const modelChanged = this.setsDiffer(a.modelNames, b.modelNames) || this.setsDiffer(a.pricingRows, b.pricingRows);
    const contextDelta = b.contextGrowth - a.contextGrowth;
    const topModelChanged = a.topModel?.pricingModel !== b.topModel?.pricingModel;

    return [
      {
        title: 'Cost movement',
        value: costDelta > 0 ? 'Higher' : costDelta < 0 ? 'Lower' : 'Flat',
        tone: costDelta > 0 ? 'high' : costDelta < 0 ? 'info' : 'medium',
        detail:
          costDelta === 0
            ? 'The imported estimate did not materially change between these two runs.'
            : `Run B moved by ${costDelta > 0 ? '+' : '-'}€${Math.abs(costDelta).toFixed(4)}. Cheaper is only better if the run still did the job.`,
      },
      {
        title: 'Priced token driver',
        value: Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'Input' : 'Output',
        tone: Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'high' : 'medium',
        detail:
          Math.abs(inputCostDelta) >= Math.abs(outputCostDelta)
            ? `Input/context cost moved by ${inputCostDelta >= 0 ? '+' : '-'}€${Math.abs(inputCostDelta).toFixed(4)}. This is usually repo context, prior chat, or tool results.`
            : `Output cost moved by ${outputCostDelta >= 0 ? '+' : '-'}€${Math.abs(outputCostDelta).toFixed(4)}. The later run generated more or less text.`,
      },
      {
        title: 'Model pricing',
        value: modelChanged ? 'Changed' : 'Same',
        tone: modelChanged || topModelChanged ? 'medium' : 'info',
        detail: modelChanged
          ? `The model or pricing-row mix changed. A: ${[...a.pricingRows].join(', ')}. B: ${[...b.pricingRows].join(', ')}.`
          : `Both runs used the same imported pricing row mix: ${[...b.pricingRows].join(', ')}.`,
      },
      {
        title: 'Context shape',
        value: `${contextDelta >= 0 ? '+' : ''}${contextDelta.toFixed(0)} pts`,
        tone: contextDelta >= 50 ? 'high' : Math.abs(contextDelta) >= 20 ? 'medium' : 'info',
        detail: `Average input growth moved from ${a.contextGrowth.toFixed(0)}% to ${b.contextGrowth.toFixed(0)}%. This is a cost signal, not proof of a problem.`,
      },
      {
        title: 'Agent activity',
        value: `${turnDelta >= 0 ? '+' : ''}${turnDelta} turns`,
        tone: turnDelta > 3 || toolDelta > 10 ? 'medium' : 'info',
        detail: `Run B has ${Math.abs(turnDelta)} ${turnDelta >= 0 ? 'more' : 'fewer'} model turns and ${Math.abs(toolDelta)} ${toolDelta >= 0 ? 'more' : 'fewer'} tool calls.`,
      },
    ];
  }

  private compareModelRows(
    aRows: ReturnType<App['explainModelCost']>[],
    bRows: ReturnType<App['explainModelCost']>[],
  ) {
    const keys = new Set([...aRows, ...bRows].map((row) => `${row.model}::${row.pricingModel}`));

    return [...keys]
      .map((key) => {
        const [model, pricingModel] = key.split('::');
        const a = aRows.find((row) => row.model === model && row.pricingModel === pricingModel);
        const b = bRows.find((row) => row.model === model && row.pricingModel === pricingModel);
        const aTokens = a ? this.tokenTotal(a.tokens) : 0;
        const bTokens = b ? this.tokenTotal(b.tokens) : 0;

        return {
          model,
          pricingModel,
          aCost: a?.totalEur ?? 0,
          bCost: b?.totalEur ?? 0,
          costDelta: (b?.totalEur ?? 0) - (a?.totalEur ?? 0),
          aTokens,
          bTokens,
          tokenDelta: bTokens - aTokens,
          aTurns: a?.turns ?? 0,
          bTurns: b?.turns ?? 0,
        };
      })
      .sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta));
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
        const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];
        const inputEur = this.tokenCostEur(event.inputTokens, price.input, usdToEur);
        const outputEur = this.tokenCostEur(event.outputTokens, price.output, usdToEur);
        const estimatedEur =
          event.estimatedCost?.eur ??
          inputEur + outputEur;

        return {
          ...event,
          totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
          pricingModel,
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
        const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];
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

  private pricingModelForEvent(event: TraceEvent, modelBreakdown: ModelBreakdown[]): string {
    if (event.pricingModel) {
      return event.pricingModel;
    }

    const sessionPricingModel = modelBreakdown.length === 1 ? modelBreakdown[0].pricingModel : null;
    const parsedModel = event.model ?? this.modelFromEventDetail(event.detail);
    return this.matchPricingModel(parsedModel) ?? sessionPricingModel ?? 'GPT-5.4';
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

  private maxBy<T>(items: T[], valueFor: (item: T) => number): T | null {
    return items.reduce<T | null>((best, item) => (!best || valueFor(item) > valueFor(best) ? item : best), null);
  }

  private standardDeviation(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

    return Math.sqrt(variance);
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

  private percentDelta(a: number, b: number): number | null {
    return a === 0 ? null : ((b - a) / a) * 100;
  }

  private setsDiffer(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
      return true;
    }

    return [...a].some((value) => !b.has(value));
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

  private modelKey(model: string): string {
    return String(model ?? '')
      .replace(/^copilot\//i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }
}
