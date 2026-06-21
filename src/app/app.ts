import { DecimalPipe, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';

import { AnalyticsPageComponent } from './analytics-page.component';
import { ComparePageComponent } from './compare-page.component';
import { CustomizationsPageComponent } from './customizations-page.component';
import { MemoryPageComponent } from './memory-page.component';
import { SessionDataService } from './session-data.service';
import { SessionDataStatePanelComponent } from './session-data-state-panel.component';
import { CopilotSession, TraceEvent } from './session-data.model';
import { PricingPageComponent } from './pricing-page.component';
import { SelectedRunExplanationService } from './selected-run-explanation.service';
import { SessionCostComponent } from './session-cost.component';
import { SessionImportContextComponent } from './session-import-context.component';
import { SessionOverviewComponent } from './session-overview.component';
import { SessionRailComponent } from './session-rail.component';
import { SessionTraceComponent } from './session-trace.component';
import { SessionTurnsComponent } from './session-turns.component';
import { SelectedRunHeaderComponent } from './selected-run-header.component';
import { UsagePageComponent } from './usage-page.component';
import {
  COPILOT_ALLOWANCE_PLANS,
  CopilotAllowancePlan,
  PRICING_SOURCE_URL,
  pricingFallbackReason,
} from './pricing';
import {
  ModelCallSort,
  SessionSize,
  SessionTriage,
  sessionSizeHelp,
  sessionTriage,
  TraceFilter,
} from './session-analysis';
import { sessionUsageUsd } from './session-cost-utils';

type ActiveView =
  | 'sessions'
  | 'usage'
  | 'memory'
  | 'customizations'
  | 'compare'
  | 'analytics'
  | 'pricing';
type SelectedRunView = 'overview' | 'cost' | 'turns' | 'trace';
type ThemeMode = 'light' | 'dark';
type SessionTimeFilter = 'all' | '7d' | '30d' | '90d';

@Component({
  selector: 'app-root',
  imports: [
    AnalyticsPageComponent,
    DecimalPipe,
    ComparePageComponent,
    CustomizationsPageComponent,
    MemoryPageComponent,
    SessionDataStatePanelComponent,
    PricingPageComponent,
    SessionCostComponent,
    SessionImportContextComponent,
    SessionOverviewComponent,
    SessionRailComponent,
    SessionTraceComponent,
    SessionTurnsComponent,
    SelectedRunHeaderComponent,
    UsagePageComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly sessionDataService = inject(SessionDataService);
  private readonly selectedRunExplanationService = inject(SelectedRunExplanationService);
  private readonly document = inject(DOCUMENT);

  protected readonly sessionData = this.sessionDataService.sessionData;
  protected readonly sessionDataLoadState = this.sessionDataService.loadState;
  protected readonly sessionDataLoadError = this.sessionDataService.loadError;
  protected readonly sessionDataRefreshState = this.sessionDataService.refreshState;
  protected readonly sessionDataRefreshMessage = this.sessionDataService.refreshMessage;
  protected readonly runtimeStatus = this.sessionDataService.runtimeStatus;
  protected readonly runtimeStatusAvailable = this.sessionDataService.runtimeStatusAvailable;
  protected readonly selectedId = signal<string | null>(null);
  protected readonly compareA = signal<string | null>(null);
  protected readonly compareB = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly sizeFilter = signal<'all' | SessionSize>('all');
  protected readonly warningFilter = signal<string>('all');
  protected readonly workspaceFilter = signal<string>('all');
  protected readonly modelFilter = signal<string>('all');
  protected readonly timeFilter = signal<SessionTimeFilter>('all');
  protected readonly traceView = signal<'logs' | 'flow'>('logs');
  protected readonly traceFilter = signal<TraceFilter>('all');
  protected readonly selectedTraceEventIndex = signal<number | null>(null);
  protected readonly traceOpenedFromTurns = signal(false);
  protected readonly modelCallSort = signal<ModelCallSort>('timeline');
  protected readonly activeView = signal<ActiveView>(this.readInitialView());
  protected readonly selectedRunView = signal<SelectedRunView>('overview');
  protected readonly sessionRailOpen = signal(false);
  protected readonly theme = signal<ThemeMode>(this.readStoredTheme());
  protected readonly allowancePlan = signal<CopilotAllowancePlan>('business-standard');
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
      'This many sessions got better names/details from VS Code state. Cost still comes from debug logs.',
    emptyDebugLogs:
      'Folders VS Code created but never filled with useful chat/model activity. We skip them so they do not look like real zero-cost runs.',
    snapshotsWithoutRequests:
      'Chat files without usable request records. They do not contain enough structure to import safely.',
    inputTokens:
      'Normal, non-cached input/context tokens priced at the GitHub input rate. Raw VS Code inputTokens can be higher when cachedTokens are present.',
    outputTokens: 'Generated model response tokens.',
    cachedInput:
      'Input/context tokens VS Code reported as cachedTokens. They are part of the raw input sent to the model, but priced with GitHub cached-input rates instead of normal input rates.',
    cacheWrite:
      'Provider cache creation tokens when the billing source exposes them. GitHub lists this mainly for Anthropic pricing rows.',
    priceRow:
      'The GitHub model pricing row used to estimate this model. Unknown models keep their display label and show any pricing fallback separately.',
    pricingFallback:
      'The raw model name from VS Code did not match a GitHub price row in the local pricing table, so the estimate uses the displayed fallback price row. Treat this as an explicit estimate assumption.',
  };
  protected readonly sessionTriageHelp =
    'Fast read derived from imported tokens and model mix. These are cost-debugging signals, not billing rows.';
  protected readonly sizeOptions: Array<'all' | SessionSize> = [
    'all',
    'Small',
    'Medium',
    'Large',
    'Very large',
  ];
  protected readonly timeOptions: Array<{ value: SessionTimeFilter; label: string }> = [
    { value: 'all', label: 'All time' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
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
  protected readonly memories = computed(() => this.sessionData()?.memories ?? []);
  protected readonly customizations = computed(() => this.sessionData()?.customizations ?? []);
  protected readonly ingestion = computed(() => this.sessionData()?.ingestion ?? null);
  protected readonly debugLogGuidance = computed(() => {
    const sessionData = this.sessionData();
    const ingestion = sessionData?.ingestion;
    if (!ingestion || ingestion.importedDebugLogSessions > 0) {
      return null;
    }

    const hasFallbackData = ingestion.importedChatSnapshotSessions > 0 || (sessionData?.sessions.length ?? 0) > 0;

    return {
      title: 'No Agent Debug Log sessions imported',
      body: hasFallbackData
        ? 'Some weaker local data was imported, but exact model-call usage needs VS Code Agent Debug Log file logging.'
        : 'No exact model-call data was found. Enable VS Code Agent Debug Log file logging, run a Copilot chat or agent session, then refresh.',
      setting: 'github.copilot.chat.agentDebugLog.fileLogging.enabled',
    };
  });
  protected readonly warningOptions = computed(() => {
    const labels = new Set<string>();

    for (const session of this.sessions()) {
      for (const warning of this.sessionTriage(session).warnings) {
        labels.add(warning.label);
      }
    }

    return ['all', ...[...labels].sort()];
  });
  protected readonly workspaceOptions = computed(() => [
    'all',
    ...[...new Set(this.sessions().map((session) => session.workspace).filter(Boolean))].sort(),
  ]);
  protected readonly modelOptions = computed(() => [
    'all',
    ...[...new Set(this.sessions().map((session) => session.model).filter(Boolean))].sort(),
  ]);
  private readonly latestSessionTime = computed(() =>
    Math.max(0, ...this.sessions().map((session) => Date.parse(session.startedAt) || 0)),
  );
  protected readonly filteredSessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    const sizeFilter = this.sizeFilter();
    const warningFilter = this.warningFilter();
    const workspaceFilter = this.workspaceFilter();
    const modelFilter = this.modelFilter();
    const timeFilter = this.timeFilter();
    const sessions = [...this.sessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    return sessions.filter(
      (session) =>
        this.matchesQuery(session, query) &&
        this.matchesSizeFilter(session, sizeFilter) &&
        this.matchesWarningFilter(session, warningFilter) &&
        this.matchesWorkspaceFilter(session, workspaceFilter) &&
        this.matchesModelFilter(session, modelFilter) &&
        this.matchesTimeFilter(session, timeFilter),
    );
  });

  protected readonly selectedSession = computed(() => {
    const id = this.selectedId() ?? this.filteredSessions()[0]?.id;
    return this.sessions().find((session) => session.id === id) ?? null;
  });
  protected readonly selectedSessionMemories = computed(() => {
    const sessionId = this.selectedSession()?.id;
    return sessionId ? this.memories().filter((memory) => memory.sessionId === sessionId) : [];
  });
  protected readonly selectedSessionPlanCount = computed(
    () => this.selectedSessionMemories().filter((memory) => memory.kind === 'plan').length,
  );
  private readonly selectedRunExplanationState = this.selectedRunExplanationService.createState({
    filteredSessions: this.filteredSessions,
    selectedSession: this.selectedSession,
    modelCallSort: this.modelCallSort,
    traceFilter: this.traceFilter,
    selectedTraceEventIndex: this.selectedTraceEventIndex,
  });
  protected readonly costExplanation = this.selectedRunExplanationState.costExplanation;
  protected readonly flowEvents = this.selectedRunExplanationState.flowEvents;
  protected readonly filteredTraceEvents = this.selectedRunExplanationState.filteredTraceEvents;
  protected readonly selectedTraceEvent = this.selectedRunExplanationState.selectedTraceEvent;
  protected readonly selectedTraceEventDetails =
    this.selectedRunExplanationState.selectedTraceEventDetails;
  protected readonly selectedSessionOutsideFilters =
    this.selectedRunExplanationState.selectedSessionOutsideFilters;
  protected readonly selectedPricingFallbacks =
    this.selectedRunExplanationState.selectedPricingFallbacks;
  protected readonly selectedTriage = this.selectedRunExplanationState.selectedTriage;

  protected readonly summary = computed(() => {
    const sessions = this.sessions();
    const totals = sessions.reduce(
      (acc, session) => {
        acc.usd += sessionUsageUsd(session);
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

  protected refreshSessionData(): void {
    this.sessionDataService.refresh();
  }

  protected dataUpdatedLabel(): string {
    const generatedAt = this.sessionData()?.generatedAt;
    if (!generatedAt) {
      return 'No imported data';
    }

    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) {
      return 'Imported data ready';
    }

    return `Updated ${date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
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

  protected selectSessionFromRail(session: CopilotSession): void {
    this.selectSession(session);
    this.sessionRailOpen.set(false);
  }

  protected openSessionRail(): void {
    this.sessionRailOpen.set(true);
  }

  protected closeSessionRail(): void {
    this.sessionRailOpen.set(false);
  }

  protected setWorkspaceFilter(value: string): void {
    this.workspaceFilter.set(value);
  }

  protected setModelFilter(value: string): void {
    this.modelFilter.set(value);
  }

  protected setTimeFilter(value: SessionTimeFilter): void {
    this.timeFilter.set(value);
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

    return [
      session.firstPrompt,
      session.title,
      session.workspace,
      session.model,
      session.tags.join(' '),
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  }

  private matchesSizeFilter(session: CopilotSession, value: 'all' | SessionSize): boolean {
    return value === 'all' || this.sessionTriage(session).size === value;
  }

  private matchesWarningFilter(session: CopilotSession, value: string): boolean {
    return (
      value === 'all' ||
      this.sessionTriage(session).warnings.some((warning) => warning.label === value)
    );
  }

  private matchesWorkspaceFilter(session: CopilotSession, value: string): boolean {
    return value === 'all' || session.workspace === value;
  }

  private matchesModelFilter(session: CopilotSession, value: string): boolean {
    return value === 'all' || session.model === value;
  }

  private matchesTimeFilter(session: CopilotSession, value: SessionTimeFilter): boolean {
    if (value === 'all') {
      return true;
    }

    const latest = this.latestSessionTime();
    const startedAt = Date.parse(session.startedAt);
    const days = Number(value.replace('d', ''));

    if (!latest || !Number.isFinite(startedAt) || !Number.isFinite(days)) {
      return false;
    }

    return startedAt >= latest - days * 24 * 60 * 60 * 1000;
  }

  private readStoredTheme(): ThemeMode {
    try {
      return globalThis.localStorage?.getItem('copilot-usage-studio-theme') === 'dark'
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  }

  private readInitialView(): ActiveView {
    try {
      const view = new URL(globalThis.location?.href ?? '').searchParams.get('view');

      return view === 'sessions' ||
        view === 'usage' ||
        view === 'memory' ||
        view === 'customizations' ||
        view === 'compare' ||
        view === 'analytics' ||
        view === 'pricing'
        ? view
        : 'usage';
    } catch {
      return 'usage';
    }
  }

  private persistTheme(theme: ThemeMode): void {
    try {
      globalThis.localStorage?.setItem('copilot-usage-studio-theme', theme);
    } catch {
      // Non-browser test/runtime environments can ignore persistence.
    }
  }
}
