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

@Component({
  selector: 'app-pricing-page',
  imports: [DatePipe, DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './pricing-page.component.html',
  styleUrl: './pricing-page.component.css',
})
export class PricingPageComponent {
  private readonly sessionsInput = signal<CopilotSession[]>([]);
  private readonly selectedAllowancePlanInput = signal<CopilotAllowancePlan>('business-standard');

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
  protected readonly help = {
    inputTokens:
      'Everything sent into the model: prompt, repo context, prior conversation, and tool results.',
    outputTokens: 'Generated model response tokens.',
    cachedInput:
      'Tokens served from a provider cache when that data is available. Current local VS Code debug logs do not show this field.',
    cacheWrite:
      'Provider cache creation tokens when the billing source exposes them. GitHub lists this mainly for Anthropic pricing rows.',
    pricingFallback:
      'The raw model name from VS Code did not match a GitHub price row in the local pricing table, so the estimate uses the displayed fallback price row. Treat this as an explicit estimate assumption.',
    allowance:
      'Included AI credits for Copilot Business and Enterprise are monthly per assigned license, but GitHub pools them at the organization or enterprise billing entity level.',
    credit:
      'GitHub states that 1 AI credit equals $0.01 USD. The app converts the local USD estimate into credits with that fixed rate.',
  };

  protected readonly selectedAllowance = computed(
    () =>
      COPILOT_ALLOWANCE_PLANS.find((plan) => plan.id === this.selectedAllowancePlanInput()) ??
      COPILOT_ALLOWANCE_PLANS[0],
  );

  protected readonly totalEstimateUsd = computed(() =>
    this.sessionsInput().reduce((sum, session) => sum + session.cost.usd, 0),
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

  private readonly usesPricingFallback = modelUsesPricingFallback;
}


