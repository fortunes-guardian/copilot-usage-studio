import { DecimalPipe, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';

import { AnalyticsPageComponent } from './analytics-page.component';
import { ComparePageComponent } from './compare-page.component';
import { SessionDataService } from './session-data.service';
import { SessionDataStatePanelComponent } from './session-data-state-panel.component';
import { CopilotSession, TraceEvent } from './session-data.model';
import { PricingPageComponent } from './pricing-page.component';
import { SessionCostComponent } from './session-cost.component';
import { SessionImportContextComponent } from './session-import-context.component';
import { SessionOverviewComponent } from './session-overview.component';
import { SessionRailComponent, SessionSourceFilter } from './session-rail.component';
import { SessionTraceComponent } from './session-trace.component';
import { SessionTurnsComponent } from './session-turns.component';
import { SelectedRunHeaderComponent } from './selected-run-header.component';
import {
  COPILOT_AI_CREDIT_USD,
  COPILOT_ALLOWANCE_PLANS,
  CopilotAllowancePlan,
  PRICING_SOURCE_URL,
  pricingFallbackReason,
} from './pricing';
import {
  buildCostExplanation,
  flowTraceEvents,
  matchesTraceFilter,
  ModelCallSort,
  SessionSize,
  SessionTriage,
  sessionSizeHelp,
  sessionTriage,
  traceEventDetails,
  TraceFilter,
  usesPricingFallback,
} from './session-analysis';

type ActiveView = 'sessions' | 'compare' | 'analytics' | 'pricing';
type SelectedRunView = 'overview' | 'cost' | 'turns' | 'trace';
type ThemeMode = 'light' | 'dark';

@Component({
  selector: 'app-root',
  imports: [
    AnalyticsPageComponent,
    DecimalPipe,
    ComparePageComponent,
    SessionDataStatePanelComponent,
    PricingPageComponent,
    SessionCostComponent,
    SessionImportContextComponent,
    SessionOverviewComponent,
    SessionRailComponent,
    SessionTraceComponent,
    SessionTurnsComponent,
    SelectedRunHeaderComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly sessionDataService = inject(SessionDataService);
  private readonly document = inject(DOCUMENT);

  protected readonly sessionData = this.sessionDataService.sessionData;
  protected readonly sessionDataLoadState = this.sessionDataService.loadState;
  protected readonly sessionDataLoadError = this.sessionDataService.loadError;
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
  protected readonly traceOpenedFromTurns = signal(false);
  protected readonly modelCallSort = signal<ModelCallSort>('timeline');
  protected readonly activeView = signal<ActiveView>('sessions');
  protected readonly selectedRunView = signal<SelectedRunView>('overview');
  protected readonly theme = signal<ThemeMode>(this.readStoredTheme());
  protected readonly allowancePlan = signal<CopilotAllowancePlan>('business-standard');
  protected readonly allowancePlans = COPILOT_ALLOWANCE_PLANS;
  protected readonly pricingSourceUrl = PRICING_SOURCE_URL;
  protected readonly help = {
    appEstimate:
      'Estimated from imported local token counts and GitHub published model prices. This is useful for debugging a run, but it is not your GitHub bill.',
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
      'Input/context tokens reported by VS Code as cachedTokens on model calls. These are priced separately from normal input when present.',
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

  protected readonly sessions = computed(() => this.sessionData()?.sessions ?? []);
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
    const sessionData = this.sessionData();

    if (!session || !sessionData) {
      return null;
    }

    return buildCostExplanation(session, this.modelCallSort());
  });
  protected readonly flowEvents = computed(() => {
    const session = this.selectedSession();
    const sessionData = this.sessionData();

    if (!session || !sessionData) {
      return [];
    }

    return flowTraceEvents(session.traceEvents, session.modelBreakdown);
  });
  protected readonly filteredTraceEvents = computed(() => {
    const session = this.selectedSession();

    if (!session) {
      return [];
    }

    return session.traceEvents.filter((event) => matchesTraceFilter(event, this.traceFilter()));
  });
  protected readonly selectedTraceEvent = computed(() => {
    const events = this.filteredTraceEvents();
    const selectedIndex = this.selectedTraceEventIndex();

    return events.find((event) => event.index === selectedIndex) ?? events[0] ?? null;
  });
  protected readonly selectedTraceEventDetails = computed(() => {
    const event = this.selectedTraceEvent();
    const session = this.selectedSession();
    const sessionData = this.sessionData();

    if (!event || !session || !sessionData) {
      return null;
    }

    return traceEventDetails(event, session.modelBreakdown);
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
      .filter((entry) => usesPricingFallback(entry.model, entry.pricingModel))
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
  protected readonly selectedAllowance = computed(() =>
    COPILOT_ALLOWANCE_PLANS.find((plan) => plan.id === this.allowancePlan()) ?? COPILOT_ALLOWANCE_PLANS[0],
  );
  protected readonly selectedAllowanceUsage = computed(() => {
    const session = this.selectedSession();
    const allowance = this.selectedAllowance();
    const credits = session ? session.cost.usd / COPILOT_AI_CREDIT_USD : 0;
    const share = allowance.creditsPerUserMonthly > 0 ? (credits / allowance.creditsPerUserMonthly) * 100 : 0;

    return {
      credits,
      share,
      remaining: Math.max(allowance.creditsPerUserMonthly - credits, 0),
      over: Math.max(credits - allowance.creditsPerUserMonthly, 0),
    };
  });

  protected readonly summary = computed(() => {
    const sessions = this.sessions();
    const totals = sessions.reduce(
      (acc, session) => {
        acc.usd += session.cost.usd;
        acc.input += session.tokens.input;
        acc.output += session.tokens.output;
        acc.cachedInput += session.tokens.cachedInput;
        acc.cacheWrite += session.tokens.cacheWrite;
        return acc;
      },
      { usd: 0, input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
    );

    return { count: sessions.length, ...totals };
  });

  private initializedFromSessionData = false;

  constructor() {
    effect(() => {
      const sessionData = this.sessionData();

      if (!sessionData || this.initializedFromSessionData) {
        return;
      }

      this.initializedFromSessionData = true;
      this.selectedId.set(sessionData.sessions[0]?.id ?? null);
      this.compareA.set(sessionData.sessions[0]?.id ?? null);
      this.compareB.set(sessionData.sessions[1]?.id ?? null);
    });

    effect(() => {
      const theme = this.theme();
      this.document.documentElement.dataset['theme'] = theme;
      this.document.documentElement.style.colorScheme = theme;
      this.persistTheme(theme);
    });
  }

  protected toggleTheme(): void {
    this.theme.set(this.theme() === 'light' ? 'dark' : 'light');
  }

  protected themeLabel(): string {
    return this.theme() === 'light' ? 'Light' : 'Dark';
  }

  protected selectSession(session: CopilotSession): void {
    this.selectedId.set(session.id);
    this.selectedRunView.set('overview');
    this.selectedTraceEventIndex.set(null);
    this.traceOpenedFromTurns.set(false);
  }

  protected openFirstFilteredSession(): void {
    const session = this.filteredSessions()[0];

    if (session) {
      this.selectSession(session);
    }
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

  protected setAllowancePlan(value: string): void {
    if (COPILOT_ALLOWANCE_PLANS.some((plan) => plan.id === value)) {
      this.allowancePlan.set(value as CopilotAllowancePlan);
    }
  }

  protected setTraceFilter(value: TraceFilter): void {
    this.traceFilter.set(value);
    this.selectedTraceEventIndex.set(null);
    this.traceOpenedFromTurns.set(false);
  }

  protected selectTraceEvent(event: TraceEvent): void {
    this.selectedTraceEventIndex.set(event.index);
    this.traceOpenedFromTurns.set(false);
  }

  protected openTraceEvent(index: number): void {
    this.selectedRunView.set('trace');
    this.traceView.set('logs');
    this.traceFilter.set('all');
    this.selectedTraceEventIndex.set(index);
    this.traceOpenedFromTurns.set(true);
  }

  protected readonly pricingFallbackReason = pricingFallbackReason;

  protected openSession(session: CopilotSession | null): void {
    if (!session) {
      return;
    }

    this.selectedId.set(session.id);
    this.activeView.set('sessions');
    this.selectedRunView.set('overview');
    this.selectedTraceEventIndex.set(null);
    this.traceOpenedFromTurns.set(false);
  }

  protected sessionTriage(session: CopilotSession): SessionTriage {
    return sessionTriage(session);
  }

  protected sessionSizeHelp(triage: SessionTriage): string {
    return sessionSizeHelp(triage);
  }

  private matchesQuery(session: CopilotSession, query: string): boolean {
    if (!query) {
      return true;
    }

    return [session.firstPrompt, session.title, session.workspace, session.model, session.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query);
  }

  private matchesSizeFilter(session: CopilotSession, value: 'all' | SessionSize): boolean {
    return value === 'all' || this.sessionTriage(session).size === value;
  }

  private matchesWarningFilter(session: CopilotSession, value: string): boolean {
    return value === 'all' || this.sessionTriage(session).warnings.some((warning) => warning.label === value);
  }

  private matchesSourceFilter(session: CopilotSession, value: SessionSourceFilter): boolean {
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

  protected tokenSourceHelp(tokenSource: string): string {
    if (tokenSource === 'llm_request_token_totals') {
      return 'Strongest local token source: VS Code logged input/output token counts for each model call. When cachedTokens is present, ingestion prices that cached input separately.';
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

  private readStoredTheme(): ThemeMode {
    try {
      return globalThis.localStorage?.getItem('copilot-cost-debugger-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  private persistTheme(theme: ThemeMode): void {
    try {
      globalThis.localStorage?.setItem('copilot-cost-debugger-theme', theme);
    } catch {
      // Non-browser test/runtime environments can ignore persistence.
    }
  }

}


