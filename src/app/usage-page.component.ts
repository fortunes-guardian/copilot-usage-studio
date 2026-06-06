import { DecimalPipe, DatePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { COPILOT_ALLOWANCE_PLANS, CopilotAllowancePlan } from './pricing';
import { analyticsUsageWindows } from './session-analytics';
import { sessionUsageCredits, sessionUsageUsd } from './session-cost-utils';
import { CopilotSession } from './session-data.model';

interface DailyUsageRow {
  date: Date;
  key: string;
  credits: number;
  usd: number;
  count: number;
  topSession: CopilotSession | null;
  fallbackCount: number;
}

@Component({
  selector: 'app-usage-page',
  imports: [DatePipe, DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './usage-page.component.html',
  styleUrl: './usage-page.component.css',
})
export class UsagePageComponent {
  private readonly sessionsInput = signal<CopilotSession[]>([]);
  private readonly allowancePlanInput = signal<CopilotAllowancePlan>('business-standard');

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  @Input() set allowancePlan(value: CopilotAllowancePlan | null | undefined) {
    this.allowancePlanInput.set(value ?? 'business-standard');
  }

  @Output() readonly allowancePlanChange = new EventEmitter<CopilotAllowancePlan>();
  @Output() readonly openSession = new EventEmitter<CopilotSession>();

  protected readonly allowancePlans = COPILOT_ALLOWANCE_PLANS;
  protected readonly help = {
    scope:
      'Usage is calculated from imported local sessions. GitHub source usage is used first; token pricing is used only as fallback when a run does not expose source usage.',
    allowance:
      'Compares local imported usage with one selected Copilot monthly allowance. This is a developer view, not an organization billing console.',
  };

  protected readonly selectedAllowance = computed(
    () =>
      COPILOT_ALLOWANCE_PLANS.find((plan) => plan.id === this.allowancePlanInput()) ??
      COPILOT_ALLOWANCE_PLANS[0],
  );
  protected readonly currentAllowancePlan = computed(() => this.selectedAllowance().id);

  protected readonly usageWindows = computed(() =>
    analyticsUsageWindows(this.sessionsInput(), this.selectedAllowance().creditsPerUserMonthly),
  );

  protected readonly dailyRows = computed(() => this.buildDailyRows(this.sessionsInput(), 14));

  protected readonly sourceCoverage = computed(() => {
    const sessions = this.sessionsInput();
    const sourceCount = sessions.filter((session) => session.sourceUsage).length;

    return {
      sourceCount,
      fallbackCount: sessions.length - sourceCount,
      total: sessions.length,
    };
  });

  protected setAllowancePlan(value: string): void {
    if (!COPILOT_ALLOWANCE_PLANS.some((plan) => plan.id === value)) {
      return;
    }

    const plan = value as CopilotAllowancePlan;
    this.allowancePlanInput.set(plan);
    this.allowancePlanChange.emit(plan);
  }

  protected emitOpenSession(session: CopilotSession | null): void {
    if (session) {
      this.openSession.emit(session);
    }
  }

  private buildDailyRows(sessions: CopilotSession[], days: number): DailyUsageRow[] {
    const today = startOfLocalDay(new Date());

    return Array.from({ length: days }, (_, index) => {
      const date = addDays(today, -index);
      const next = addDays(date, 1);
      const daySessions = sessions.filter((session) => {
        const timestamp = Date.parse(session.startedAt);

        return Number.isFinite(timestamp) && timestamp >= date.getTime() && timestamp < next.getTime();
      });
      const topSession = daySessions.reduce<CopilotSession | null>(
        (best, session) => (!best || sessionUsageUsd(session) > sessionUsageUsd(best) ? session : best),
        null,
      );

      return {
        date,
        key: isoLocalDate(date),
        credits: daySessions.reduce((sum, session) => sum + sessionUsageCredits(session), 0),
        usd: daySessions.reduce((sum, session) => sum + sessionUsageUsd(session), 0),
        count: daySessions.length,
        topSession,
        fallbackCount: daySessions.filter((session) => !session.sourceUsage).length,
      };
    });
  }
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);

  return next;
}

function isoLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
