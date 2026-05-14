import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession } from './session-data.model';
import {
  COPILOT_AI_CREDIT_USD,
  COPILOT_ALLOWANCE_PLANS,
  COPILOT_ALLOWANCE_SOURCE_URL,
  CopilotAllowancePlan,
  MODEL_PRICES_USD_PER_MILLION,
  PRICING_EFFECTIVE_DATE,
  PRICING_IMPORTED_AT,
  PRICING_SOURCE_LABEL,
  PRICING_SOURCE_URL,
  PRICING_VERSION,
  modelUsesPricingFallback,
} from './pricing';

type PricingTimeRange = 'all' | '7d' | '30d' | '90d';

@Component({
  selector: 'app-pricing-page',
  imports: [DatePipe, DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './pricing-page.component.html',
  styleUrl: './pricing-page.component.css',
})
export class PricingPageComponent {
  private readonly sessionsInput = signal<CopilotSession[]>([]);
  private readonly selectedAllowancePlanInput = signal<CopilotAllowancePlan>('business-standard');
  protected readonly usageTimeRange = signal<PricingTimeRange>('all');

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  @Input() set selectedAllowancePlan(value: CopilotAllowancePlan | null | undefined) {
    this.selectedAllowancePlanInput.set(value ?? 'business-standard');
  }

  @Output() readonly selectedAllowancePlanChange = new EventEmitter<CopilotAllowancePlan>();

  protected readonly pricingVersion = PRICING_VERSION;
  protected readonly pricingSourceLabel = PRICING_SOURCE_LABEL;
  protected readonly pricingSourceUrl = PRICING_SOURCE_URL;
  protected readonly pricingEffectiveDate = PRICING_EFFECTIVE_DATE;
  protected readonly pricingImportedAt = PRICING_IMPORTED_AT;
  protected readonly allowanceSourceUrl = COPILOT_ALLOWANCE_SOURCE_URL;
  protected readonly creditUsd = COPILOT_AI_CREDIT_USD;
  protected readonly allowancePlans = COPILOT_ALLOWANCE_PLANS;
  protected readonly usageTimeOptions: Array<{ value: PricingTimeRange; label: string }> = [
    { value: 'all', label: 'All imported sessions' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ];
  protected readonly help = {
    inputTokens:
      'Normal, non-cached input/context tokens priced at the GitHub input rate. Raw VS Code inputTokens can be higher when cachedTokens are present.',
    outputTokens: 'Generated model response tokens.',
    cachedInput:
      'Input/context tokens VS Code reported as cachedTokens. They are part of raw input, but priced with GitHub cached-input rates instead of normal input rates.',
    cacheWrite:
      'Provider cache creation tokens when the billing source exposes them. GitHub lists this mainly for Anthropic pricing rows.',
    pricingFallback:
      'The raw model name from VS Code did not match a GitHub price row in the local pricing table, so the estimate uses the displayed fallback price row. Treat this as an explicit estimate assumption.',
    allowance:
      'Included AI credits for Copilot Business and Enterprise are monthly per assigned license, but GitHub pools them at the organization or enterprise billing entity level.',
    credit:
      'GitHub states that 1 AI credit equals $0.01 USD. The app converts the local USD estimate into credits with that fixed rate.',
    usageWindow:
      'This only filters the imported sessions used by the allowance meter. It does not change the GitHub price table below.',
  };

  protected readonly selectedAllowance = computed(
    () =>
      COPILOT_ALLOWANCE_PLANS.find((plan) => plan.id === this.selectedAllowancePlanInput()) ??
      COPILOT_ALLOWANCE_PLANS[0],
  );

  protected readonly allowanceSessions = computed(() => {
    const cutoff = this.usageCutoff(this.sessionsInput(), this.usageTimeRange());

    return this.sessionsInput().filter((session) => !cutoff || new Date(session.startedAt).getTime() >= cutoff);
  });

  protected readonly totalEstimateUsd = computed(() =>
    this.allowanceSessions().reduce((sum, session) => sum + session.cost.usd, 0),
  );

  protected readonly totalEstimateCredits = computed(
    () => this.totalEstimateUsd() / COPILOT_AI_CREDIT_USD,
  );

  protected readonly selectedAllowanceUsage = computed(() => {
    const allowance = this.selectedAllowance();
    const credits = this.totalEstimateCredits();
    const share =
      allowance.creditsPerUserMonthly > 0 ? (credits / allowance.creditsPerUserMonthly) * 100 : 0;

    return {
      credits,
      share,
      perUserCredits: allowance.creditsPerUserMonthly,
      sessions: this.allowanceSessions().length,
      totalSessions: this.sessionsInput().length,
      windowLabel:
        this.usageTimeOptions.find((option) => option.value === this.usageTimeRange())?.label ??
        'All imported sessions',
    };
  });

  protected readonly pricingRows = computed(() =>
    Object.entries(MODEL_PRICES_USD_PER_MILLION).map(([model, price]) => ({
      model,
      ...price,
      cacheWrite: price.cacheWrite ?? 0,
      usedByImportedSessions: this.sessionsInput().some((session) =>
        session.modelBreakdown.some((entry) => entry.pricingModel === model),
      ),
      usedDirectly: this.sessionsInput().some((session) =>
        session.modelBreakdown.some(
          (entry) =>
            entry.pricingModel === model &&
            !this.usesPricingFallback(entry.model, entry.pricingModel),
        ),
      ),
      usedAsFallback: this.sessionsInput().some((session) =>
        session.modelBreakdown.some(
          (entry) =>
            entry.pricingModel === model &&
            this.usesPricingFallback(entry.model, entry.pricingModel),
        ),
      ),
    })),
  );

  protected setSelectedAllowancePlan(value: string): void {
    if (!COPILOT_ALLOWANCE_PLANS.some((plan) => plan.id === value)) {
      return;
    }

    const plan = value as CopilotAllowancePlan;
    this.selectedAllowancePlanInput.set(plan);
    this.selectedAllowancePlanChange.emit(plan);
  }

  protected setUsageTimeRange(value: PricingTimeRange): void {
    if (!this.usageTimeOptions.some((option) => option.value === value)) {
      return;
    }

    this.usageTimeRange.set(value);
  }

  private readonly usesPricingFallback = modelUsesPricingFallback;

  private usageCutoff(sessions: CopilotSession[], timeRange: PricingTimeRange): number | null {
    if (timeRange === 'all' || !sessions.length) {
      return null;
    }

    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const latest = Math.max(...sessions.map((session) => new Date(session.startedAt).getTime()).filter(Number.isFinite));

    return Number.isFinite(latest) ? latest - days * 24 * 60 * 60 * 1000 : null;
  }
}


