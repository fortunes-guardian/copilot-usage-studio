import { TokenBreakdown } from './ledger.model';
import pricingData from '../../data/github-copilot-pricing.json';

export interface ModelPrice {
  provider: 'OpenAI' | 'Anthropic' | 'Google' | 'xAI' | 'Fine-tuned (GitHub)';
  category: 'Lightweight' | 'Versatile' | 'Powerful';
  releaseStatus: 'GA' | 'Public preview';
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
  note?: string;
}

export type CopilotAllowancePlan =
  | 'business-standard'
  | 'enterprise-standard'
  | 'business-promo'
  | 'enterprise-promo';

export interface CopilotAllowance {
  id: CopilotAllowancePlan;
  label: string;
  shortLabel: string;
  creditsPerUserMonthly: number;
  period: string;
  note: string;
}

export const PRICING_VERSION = pricingData.version;
export const PRICING_SOURCE_URL = pricingData.sourceUrl;
export const PRICING_SOURCE_LABEL = pricingData.sourceLabel;
export const PRICING_EFFECTIVE_DATE = pricingData.effectiveDate;
export const PRICING_IMPORTED_AT = pricingData.importedAt;
export const FALLBACK_PRICING_MODEL = pricingData.fallbackModel;
export const COPILOT_AI_CREDIT_USD = 0.01;
export const COPILOT_ALLOWANCE_SOURCE_URL =
  'https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises';

export const MODEL_PRICES_USD_PER_MILLION = pricingData.models as Record<string, ModelPrice>;

export const COPILOT_ALLOWANCE_PLANS: CopilotAllowance[] = [
  {
    id: 'business-standard',
    label: 'Copilot Business',
    shortLabel: 'Business',
    creditsPerUserMonthly: 1900,
    period: 'Standard monthly allowance',
    note: 'Included AI credits are pooled at the billing entity level.',
  },
  {
    id: 'enterprise-standard',
    label: 'Copilot Enterprise',
    shortLabel: 'Enterprise',
    creditsPerUserMonthly: 3900,
    period: 'Standard monthly allowance',
    note: 'Included AI credits are pooled at the billing entity level.',
  },
  {
    id: 'business-promo',
    label: 'Copilot Business promo',
    shortLabel: 'Business promo',
    creditsPerUserMonthly: 3000,
    period: 'Existing-customer promo, Jun 1-Sep 1 2026',
    note: 'GitHub documents this temporary higher allowance for existing Business customers.',
  },
  {
    id: 'enterprise-promo',
    label: 'Copilot Enterprise promo',
    shortLabel: 'Enterprise promo',
    creditsPerUserMonthly: 7000,
    period: 'Existing-customer promo, Jun 1-Sep 1 2026',
    note: 'GitHub documents this temporary higher allowance for existing Enterprise customers.',
  },
];

export function estimateCostUsd(model: string, tokens: TokenBreakdown): number {
  const price = MODEL_PRICES_USD_PER_MILLION[model] ?? MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL];

  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}
