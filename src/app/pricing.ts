import { TokenBreakdown } from './session-data.model';
import pricingData from '../../data/github-copilot-pricing.json';

export interface ModelPrice {
  provider: 'OpenAI' | 'Anthropic' | 'Google' | 'Microsoft' | 'Fine-tuned (GitHub)' | 'Moonshot AI';
  category: 'Lightweight' | 'Versatile' | 'Powerful';
  releaseStatus: 'GA' | 'Public preview';
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
  aliases?: string[];
  note?: string;
  tierLabel?: string;
  tierThresholdLabel?: string;
  tiers?: ModelPriceTier[];
}

export interface ModelPriceTier {
  id: string;
  label: string;
  thresholdInputTokensExclusive: number;
  thresholdLabel: string;
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
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
export const PRICING_SNAPSHOT_DATE = pricingData.snapshotDate;
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

export function modelKey(model: string | null | undefined): string {
  return String(model ?? '')
    .replace(/^copilot\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeModel(model: string | null | undefined): string {
  const raw = String(model ?? '')
    .replace(/^copilot\//i, '')
    .trim();
  const key = modelKey(raw);
  const knownModels = Object.keys(MODEL_PRICES_USD_PER_MILLION);
  const knownAliases = knownModels.flatMap((name) =>
    (MODEL_PRICES_USD_PER_MILLION[name].aliases ?? []).map((alias) => ({
      name,
      aliasKey: modelKey(alias),
    })),
  );

  return (
    knownModels.find((name) => modelKey(name) === key) ??
    knownAliases.find(({ aliasKey }) => aliasKey === key)?.name ??
    knownModels.find((name) => key.includes(modelKey(name))) ??
    knownAliases.find(({ aliasKey }) => key.includes(aliasKey))?.name ??
    (raw || 'Unknown model')
  );
}

export function pricingModelForModel(model: string | null | undefined): string {
  const normalized = normalizeModel(model);

  return MODEL_PRICES_USD_PER_MILLION[normalized] ? normalized : FALLBACK_PRICING_MODEL;
}

export function priceForPricingModel(pricingModel: string | null | undefined): ModelPrice {
  return (
    MODEL_PRICES_USD_PER_MILLION[pricingModel || ''] ??
    MODEL_PRICES_USD_PER_MILLION[FALLBACK_PRICING_MODEL]
  );
}

export function priceForTokens(
  pricingModel: string | null | undefined,
  tokens: Pick<TokenBreakdown, 'input' | 'cachedInput'>,
): ModelPrice & Partial<ModelPriceTier> {
  const basePrice = priceForPricingModel(pricingModel);
  const rawInputTokens = Math.max(0, tokens.input) + Math.max(0, tokens.cachedInput);
  const tier = [...(basePrice.tiers ?? [])]
    .sort((a, b) => b.thresholdInputTokensExclusive - a.thresholdInputTokensExclusive)
    .find((candidate) => rawInputTokens > candidate.thresholdInputTokensExclusive);

  return tier ? { ...basePrice, ...tier, tiers: basePrice.tiers } : basePrice;
}

export function modelUsesPricingFallback(
  model: string | null | undefined,
  pricingModel: string | null | undefined,
): boolean {
  const normalized = normalizeModel(model);
  const priceRow = pricingModel || pricingModelForModel(normalized);

  return priceRow !== normalized || !MODEL_PRICES_USD_PER_MILLION[normalized];
}

export function pricingFallbackReason(
  model: string | null | undefined,
  pricingModel: string | null | undefined,
): string {
  const normalized = normalizeModel(model);
  const priceRow = pricingModel || pricingModelForModel(normalized);

  if (!modelUsesPricingFallback(normalized, priceRow)) {
    return 'This model matched a GitHub price row directly.';
  }

  return `${normalized || 'Unknown model'} is priced with the ${priceRow} row because that raw model id is not in the local GitHub pricing table.`;
}

export function estimateCostUsd(model: string, tokens: TokenBreakdown): number {
  const price = priceForTokens(model, tokens);

  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}
