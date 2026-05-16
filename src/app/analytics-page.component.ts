import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { COPILOT_AI_CREDIT_USD, COPILOT_ALLOWANCE_PLANS } from './pricing';
import {
  AnalyticsGrouping,
  AnalyticsTimeRange,
  SessionSize,
  analyticsDistribution,
  analyticsModelRows,
  analyticsOutliers,
  analyticsTrendRows,
  filterAnalyticsSessions,
  maxBy,
} from './session-analytics';
import { CopilotSession } from './session-data.model';
import { sessionTotalTokens } from './session-cost-utils';

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

interface CreditPlanOption {
  id: string;
  label: string;
  creditsPerUserMonthly: number;
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
  protected readonly selectedCreditPlan = signal('business-standard');
  protected readonly help = {
    analyticsScope:
      'Multi-session analytics start from the sessions currently included by the sidebar filters, then apply the Analytics controls on this page.',
    trendGrouping:
      'Time range chooses which sessions are included. Trend grouping only changes how the included sessions are bucketed in the Recent trend panel.',
    creditWindow:
      'Credit windows are based on imported local sessions, anchored to the latest imported session date. They estimate AI credit usage; they are not a GitHub invoice.',
    creditAllowance:
      'Compares this imported local cohort with the monthly included AI credits for one Copilot license. It is a developer planning view, not an org invoice.',
  };
  protected readonly sizeOptions: SessionSize[] = ['Small', 'Medium', 'Large', 'Very large'];
  protected readonly analyticsTimeOptions: Array<{ value: AnalyticsTimeRange; label: string }> = [
    { value: 'all', label: 'All time' },
    { value: 'current-month', label: 'Current month' },
    { value: 'previous-month', label: 'Previous month' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ];
  protected readonly analyticsGroupingOptions: Array<{ value: AnalyticsGrouping; label: string }> = [
    { value: 'day', label: 'By day' },
    { value: 'week', label: 'By week' },
    { value: 'month', label: 'By month' },
  ];
  protected readonly creditPlanOptions: CreditPlanOption[] = COPILOT_ALLOWANCE_PLANS.map((plan) => ({
    id: plan.id,
    label: plan.label.replace('Copilot ', ''),
    creditsPerUserMonthly: plan.creditsPerUserMonthly,
  }));

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
    return filterAnalyticsSessions(
      this.sessionsInput(),
      this.analyticsTimeRange(),
      this.analyticsWorkspaceFilter(),
      this.analyticsModelFilter(),
    );
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
    const selectedPlan =
      this.creditPlanOptions.find((plan) => plan.id === this.selectedCreditPlan()) ??
      this.creditPlanOptions[0] ?? {
        id: 'business-standard',
        label: 'Business',
        creditsPerUserMonthly: 1900,
      };
    const monthlyAllowance = selectedPlan ? selectedPlan.creditsPerUserMonthly : 0;
    const allowanceShare = monthlyAllowance > 0 ? (totalCredits / monthlyAllowance) * 100 : 0;
    const remainingCredits = monthlyAllowance > 0 ? Math.max(0, monthlyAllowance - totalCredits) : 0;
    const allowanceStatus =
      allowanceShare >= 100
        ? 'Above one-license monthly allowance'
        : allowanceShare >= 75
          ? 'High for one license'
          : allowanceShare >= 40
            ? 'Worth watching'
            : 'Comfortable';
    const highestTokens = maxBy(sessions, (session) => sessionTotalTokens(session));
    const highestCost = maxBy(sessions, (session) => session.cost.usd);
    const modelRows = analyticsModelRows(sessions, totalCost);
    const trendRows = analyticsTrendRows(sessions, this.analyticsGrouping());
    const distribution = analyticsDistribution(sessions, totalCost);
    const outliers = analyticsOutliers(sessions, avgCost, avgTokens);
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
      creditWindowLabel:
        this.analyticsTimeRange() === 'all'
          ? 'All included sessions'
          : this.analyticsTimeOptions.find((option) => option.value === this.analyticsTimeRange())?.label ?? 'Selected window',
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
      selectedPlan,
      monthlyAllowance,
      allowanceShare,
      remainingCredits,
      allowanceStatus,
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

  protected setCreditPlan(value: string): void {
    this.selectedCreditPlan.set(value);
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

}


