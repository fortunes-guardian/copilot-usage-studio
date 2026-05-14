import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { COPILOT_AI_CREDIT_USD, COPILOT_ALLOWANCE_PLANS } from './pricing';
import { CopilotSession } from './session-data.model';
import { sessionTotalTokens, tokenTotal, usesPricingFallback } from './session-cost-utils';

type SessionSize = 'Small' | 'Medium' | 'Large' | 'Very large';
type AnalyticsTimeRange = 'all' | '7d' | '30d' | '90d';
type AnalyticsGrouping = 'day' | 'week' | 'month';

interface AnalyticsMetric {
  label: string;
  value: string;
  help: string;
}

interface AnalyticsHighlight {
  label: string;
  session: CopilotSession | null;
  value: string;
  help: string;
}

@Component({
  selector: 'app-analytics-page',
  imports: [DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './analytics-page.component.html',
  styleUrl: './analytics-page.component.css',
})
export class AnalyticsPageComponent {
  private readonly sessionsInput = signal<CopilotSession[]>([]);
  private readonly totalSessionCountInput = signal(0);

  @Output() readonly openSession = new EventEmitter<CopilotSession>();

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  @Input() set totalSessionCount(value: number | null | undefined) {
    this.totalSessionCountInput.set(value ?? 0);
  }

  protected readonly analyticsTimeRange = signal<AnalyticsTimeRange>('all');
  protected readonly analyticsWorkspaceFilter = signal('all');
  protected readonly analyticsModelFilter = signal('all');
  protected readonly analyticsGrouping = signal<AnalyticsGrouping>('day');
  protected readonly help = {
    analyticsScope:
      'Multi-session analytics start from the sessions currently included by the sidebar filters, then apply the Analytics controls on this page.',
    trendGrouping:
      'Time range chooses which sessions are included. Trend grouping only changes how the included sessions are bucketed in the Recent trend panel.',
  };
  protected readonly sizeOptions: SessionSize[] = ['Small', 'Medium', 'Large', 'Very large'];
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

  protected readonly analyticsWorkspaceOptions = computed(() => {
    const workspaces = new Set(this.sessionsInput().map((session) => session.workspace).filter(Boolean));
    const selected = this.analyticsWorkspaceFilter();
    if (selected !== 'all') {
      workspaces.add(selected);
    }

    return ['all', ...[...workspaces].sort()];
  });

  protected readonly analyticsModelOptions = computed(() => {
    const models = new Set<string>();

    for (const session of this.sessionsInput()) {
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
    const cutoff = this.analyticsCutoff(this.sessionsInput(), timeRange);

    return this.sessionsInput().filter((session) => {
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

  protected readonly analytics = computed(() => {
    const sessions = this.analyticsSessions();
    const count = sessions.length;
    const sidebarCount = this.sessionsInput().length;
    const totalTokens = sessions.reduce((sum, session) => sum + sessionTotalTokens(session), 0);
    const totalCost = sessions.reduce((sum, session) => sum + session.cost.usd, 0);
    const avgTokens = count ? totalTokens / count : 0;
    const avgCost = count ? totalCost / count : 0;
    const costPer1k = totalTokens ? (totalCost / totalTokens) * 1000 : 0;
    const totalCredits = this.aiCredits(totalCost);
    const businessAllowance = COPILOT_ALLOWANCE_PLANS.find((plan) => plan.id === 'business-standard');
    const businessAllowanceShare = businessAllowance
      ? (totalCredits / businessAllowance.creditsPerUserMonthly) * 100
      : 0;
    const highestTokens = this.maxBy(sessions, (session) => sessionTotalTokens(session));
    const highestCost = this.maxBy(sessions, (session) => session.cost.usd);
    const modelRows = this.analyticsModelRows(sessions, totalCost);
    const trendRows = this.analyticsTrendRows(sessions, this.analyticsGrouping());
    const distribution = this.sizeOptions.map((size) => {
      const bucket = sessions.filter((session) => this.sessionSize(sessionTotalTokens(session)) === size);
      const tokens = bucket.reduce((sum, session) => sum + sessionTotalTokens(session), 0);
      const cost = bucket.reduce((sum, session) => sum + session.cost.usd, 0);

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
        count === this.totalSessionCountInput() && sidebarCount === this.totalSessionCountInput()
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
          value: `$${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          help: 'Sum of local USD cost estimates for the current Analytics cohort.',
        },
        {
          label: 'AI credits used',
          value: `${totalCredits.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
          help: `GitHub documents 1 AI credit = $${COPILOT_AI_CREDIT_USD.toFixed(2)} USD. This converts the same local estimate into credits.`,
        },
        {
          label: 'Total tokens',
          value: totalTokens.toLocaleString(),
          help: 'Normal input, cached input, cache write, and output token fields combined across included sessions.',
        },
        {
          label: 'Avg cost / run',
          value: `$${avgCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
          help: 'Mean estimated cost per included session.',
        },
        {
          label: 'Avg tokens / run',
          value: Math.round(avgTokens).toLocaleString(),
          help: 'Mean imported token count per included session.',
        },
        {
          label: 'Cost / 1k tokens',
          value: `$${costPer1k.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
          help: 'Estimated USD per 1,000 imported tokens. This moves when model mix or input/output mix changes.',
        },
      ] satisfies AnalyticsMetric[],
      highlights: [
        {
          label: 'Highest-token run',
          session: highestTokens,
          value: highestTokens ? `${sessionTotalTokens(highestTokens).toLocaleString()} tokens` : 'n/a',
          help: 'The included session with the largest imported token total.',
        },
        {
          label: 'Most expensive run',
          session: highestCost,
          value: highestCost ? `$${highestCost.cost.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : 'n/a',
          help: 'The included session with the highest local cost estimate.',
        },
      ] satisfies AnalyticsHighlight[],
      modelRows,
      trendRows,
      distribution,
      outliers,
      totalCredits,
      businessAllowanceShare,
    };
  });

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

  protected emitOpenSession(session: CopilotSession | null): void {
    if (session) {
      this.openSession.emit(session);
    }
  }

  protected aiCredits(costUsd: number): number {
    return costUsd / COPILOT_AI_CREDIT_USD;
  }

  private analyticsModelRows(sessions: CopilotSession[], totalCost: number) {
    const rows = new Map<
      string,
      {
        model: string;
        pricingModel: string;
        turns: number;
        sessions: Set<string>;
        tokens: number;
        input: number;
        cachedInput: number;
        cacheWrite: number;
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
            cachedInput: 0,
            cacheWrite: 0,
            output: 0,
            cost: 0,
          };

        current.turns += entry.turns;
        current.sessions.add(session.id);
        current.tokens += tokenTotal(entry.tokens);
        current.input += entry.tokens.input;
        current.cachedInput += entry.tokens.cachedInput;
        current.cacheWrite += entry.tokens.cacheWrite;
        current.output += entry.tokens.output;
        current.cost += entry.cost.usd;
        rows.set(key, current);
      }
    }

    return [...rows.values()]
      .map((row) => ({
        ...row,
        sessionCount: row.sessions.size,
        costPer1k: row.tokens ? (row.cost / row.tokens) * 1000 : 0,
        share: totalCost > 0 ? (row.cost / totalCost) * 100 : 0,
        usesFallbackPrice: usesPricingFallback(row.model, row.pricingModel),
      }))
      .sort((a, b) => b.cost - a.cost);
  }

  private analyticsTrendRows(sessions: CopilotSession[], grouping: AnalyticsGrouping) {
    const rows = new Map<string, { key: string; label: string; count: number; tokens: number; cost: number }>();

    for (const session of sessions) {
      const group = this.analyticsGroupKey(session.startedAt, grouping);
      const current = rows.get(group.key) ?? { ...group, count: 0, tokens: 0, cost: 0 };

      current.count += 1;
      current.tokens += sessionTotalTokens(session);
      current.cost += session.cost.usd;
      rows.set(group.key, current);
    }

    return [...rows.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 8);
  }

  private analyticsOutliers(sessions: CopilotSession[], avgCost: number, avgTokens: number) {
    if (!sessions.length) {
      return [];
    }

    const costStd = this.standardDeviation(sessions.map((session) => session.cost.usd));
    const tokenStd = this.standardDeviation(sessions.map((session) => sessionTotalTokens(session)));

    return sessions
      .map((session) => {
        const tokens = sessionTotalTokens(session);
        const costScore = costStd > 0 ? (session.cost.usd - avgCost) / costStd : 0;
        const tokenScore = tokenStd > 0 ? (tokens - avgTokens) / tokenStd : 0;
        const score = Math.max(costScore, tokenScore);
        const reason = this.analyticsOutlierReason(session, costScore, tokenScore);

        return { session, tokens, score, reason };
      })
      .filter((row) => row.score >= 1 || sessions.length <= 5)
      .sort((a, b) => b.score - a.score || b.session.cost.usd - a.session.cost.usd)
      .slice(0, 5);
  }

  private analyticsCutoff(sessions: CopilotSession[], timeRange: AnalyticsTimeRange): number | null {
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

  private analyticsOutlierReason(session: CopilotSession, costScore: number, tokenScore: number): string {
    const totalTokens = sessionTotalTokens(session);
    const inputTokens = session.tokens.input + session.tokens.cachedInput + session.tokens.cacheWrite;
    const inputShare = totalTokens ? (inputTokens / totalTokens) * 100 : 0;
    const topModel = this.maxBy(session.modelBreakdown, (row) => row.cost.usd);
    const topModelShare = topModel && session.cost.usd > 0 ? (topModel.cost.usd / session.cost.usd) * 100 : 0;
    const modelTurns = session.traceSummary.modelTurns;
    const toolCalls = session.traceSummary.toolCalls;
    const traceActivity = modelTurns + toolCalls;
    const isVeryHighOutlier = Math.max(costScore, tokenScore) >= 2;

    if (isVeryHighOutlier && traceActivity <= 3 && totalTokens >= 100_000) {
      return `Suspicious spike: ${totalTokens.toLocaleString()} tokens with only ${traceActivity.toLocaleString()} imported model/tool events. Inspect the largest model call and source log shape.`;
    }

    if (inputShare >= 85 && inputTokens >= 100_000) {
      return `Mostly input/context tokens (${inputShare.toFixed(0)}% of imported tokens). Check prompt context, repo reads, prior conversation, and tool results.`;
    }

    if (topModel && topModelShare >= 70) {
      return `${topModel.pricingModel} produced ${topModelShare.toFixed(0)}% of this run's estimate. Model mix is the first thing to inspect.`;
    }

    if (toolCalls >= 20) {
      return `${toolCalls.toLocaleString()} tool calls may have added results back into later model input.`;
    }

    if (session.traceSummary.errors === 0 && modelTurns >= 8 && toolCalls >= 8) {
      return `Large but plausible long agent run: ${modelTurns.toLocaleString()} model turns and ${toolCalls.toLocaleString()} tool calls with no imported errors. Inspect input/context and tool activity before treating it as waste.`;
    }

    return costScore >= tokenScore
      ? `Cost is ${costScore.toFixed(1)} standard deviations above this cohort. Check model price rows and output mix.`
      : `Tokens are ${tokenScore.toFixed(1)} standard deviations above this cohort. Check input context and model-turn count.`;
  }

  private sessionSize(tokens: number): SessionSize {
    if (tokens >= 1_500_000) {
      return 'Very large';
    }

    if (tokens >= 500_000) {
      return 'Large';
    }

    if (tokens >= 100_000) {
      return 'Medium';
    }

    return 'Small';
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

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}


