import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { COPILOT_AI_CREDIT_USD } from './pricing';
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
import { sessionTotalTokens, sessionUsageCredits, sessionUsageUsd } from './session-cost-utils';

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

  @Output() readonly openSession = new EventEmitter<CopilotSession>();

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  protected readonly analyticsTimeRange = signal<AnalyticsTimeRange>('all');
  protected readonly analyticsWorkspaceFilter = signal('all');
  protected readonly analyticsModelFilter = signal('all');
  protected readonly analyticsGrouping = signal<AnalyticsGrouping>('day');
  protected readonly help = {
    analyticsScope:
      'Insights use imported sessions and the time, workspace, and model filters on this page.',
    trendGrouping:
      'Time range chooses which sessions are included. Grouping only changes how those sessions are bucketed in the trend panel.',
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
    const importedCount = this.sessionsInput().length;
    const totalTokens = sessions.reduce((sum, session) => sum + sessionTotalTokens(session), 0);
    const totalCost = sessions.reduce((sum, session) => sum + sessionUsageUsd(session), 0);
    const avgTokens = count ? totalTokens / count : 0;
    const avgCost = count ? totalCost / count : 0;
    const highestTokens = maxBy(sessions, (session) => sessionTotalTokens(session));
    const highestCost = maxBy(sessions, (session) => sessionUsageUsd(session));
    const modelRows = analyticsModelRows(sessions, totalCost);
    const trendRows = analyticsTrendRows(sessions, this.analyticsGrouping());
    const distribution = analyticsDistribution(sessions, totalCost);
    const outliers = analyticsOutliers(sessions, avgCost, avgTokens);
    const analyticsFiltersActive =
      this.analyticsTimeRange() !== 'all' ||
      this.analyticsWorkspaceFilter() !== 'all' ||
      this.analyticsModelFilter() !== 'all' ||
      this.analyticsGrouping() !== 'day';
    const analyticsExcludedCount = Math.max(importedCount - count, 0);

    return {
      count,
      importedCount,
      analyticsFiltersActive,
      analyticsExcludedCount,
      emptyTitle:
        importedCount === 0
          ? 'No imported sessions'
          : 'No sessions in this Insights cohort',
      emptyDetail:
        importedCount === 0
          ? 'Import VS Code sessions to explore model mix, run sizes, trends, and outliers.'
          : `${analyticsExcludedCount.toLocaleString()} imported session${analyticsExcludedCount === 1 ? '' : 's'} excluded by the Insights controls. Reset the filters to return to all imported sessions.`,
      timeRangeLabel:
        this.analyticsTimeOptions.find((option) => option.value === this.analyticsTimeRange())?.label ?? 'All time',
      workspaceLabel: this.analyticsWorkspaceFilter() === 'all' ? 'All workspaces' : this.analyticsWorkspaceFilter(),
      modelLabel: this.analyticsModelFilter() === 'all' ? 'All models' : this.analyticsModelFilter(),
      groupingLabel:
        this.analyticsGroupingOptions.find((option) => option.value === this.analyticsGrouping())?.label ?? 'By day',
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
          value: highestCost ? `$${sessionUsageUsd(highestCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : 'n/a',
          help: 'The included session with the highest GitHub source usage, falling back to token estimate when source usage is absent.',
        },
      ] satisfies AnalyticsHighlight[],
      modelRows,
      trendRows,
      distribution,
      outliers,
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

  protected usageUsd(session: CopilotSession): number {
    return sessionUsageUsd(session);
  }

  protected usageCredits(session: CopilotSession): number {
    return sessionUsageCredits(session);
  }
}


