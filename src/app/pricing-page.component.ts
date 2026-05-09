import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { LedgerSession } from './ledger.model';
import {
  MODEL_PRICES_USD_PER_MILLION,
  PRICING_EFFECTIVE_DATE,
  PRICING_IMPORTED_AT,
  PRICING_SOURCE_LABEL,
  PRICING_SOURCE_URL,
  PRICING_VERSION,
} from './pricing';

@Component({
  selector: 'app-pricing-page',
  imports: [DatePipe, DecimalPipe, HelpPopoverComponent],
  templateUrl: './pricing-page.component.html',
  styleUrl: './pricing-page.component.css',
})
export class PricingPageComponent {
  private readonly sessionsInput = signal<LedgerSession[]>([]);

  @Input() set sessions(value: LedgerSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  protected readonly pricingVersion = PRICING_VERSION;
  protected readonly pricingSourceLabel = PRICING_SOURCE_LABEL;
  protected readonly pricingSourceUrl = PRICING_SOURCE_URL;
  protected readonly pricingEffectiveDate = PRICING_EFFECTIVE_DATE;
  protected readonly pricingImportedAt = PRICING_IMPORTED_AT;
  protected readonly help = {
    inputTokens: 'Everything sent into the model: prompt, repo context, prior conversation, and tool results.',
    outputTokens: 'Generated model response tokens.',
    cachedInput:
      'Tokens served from a provider cache when that data is available. Current local VS Code debug logs do not show this field.',
    cacheWrite:
      'Provider cache creation tokens when the billing source exposes them. GitHub lists this mainly for Anthropic pricing rows.',
    pricingFallback:
      'The raw model name from VS Code did not match a GitHub price row in the local pricing table, so the estimate uses the displayed fallback price row. Treat this as an explicit estimate assumption.',
  };

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
          (entry) => entry.pricingModel === model && !this.usesPricingFallback(entry.model, entry.pricingModel),
        ),
      ),
      usedAsFallback: this.sessionsInput().some((session) =>
        session.modelBreakdown.some(
          (entry) => entry.pricingModel === model && this.usesPricingFallback(entry.model, entry.pricingModel),
        ),
      ),
    })),
  );

  private usesPricingFallback(model: string | null | undefined, pricingModel: string | null | undefined): boolean {
    const rawModel = model || '';
    const priceRow = pricingModel || rawModel;

    return priceRow !== rawModel || !MODEL_PRICES_USD_PER_MILLION[rawModel];
  }
}
