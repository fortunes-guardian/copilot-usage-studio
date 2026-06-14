export function modelKey(model) {
  return String(model ?? '')
    .replace(/^copilot\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeModel(model, pricing) {
  const raw = String(model ?? '')
    .replace(/^copilot\//i, '')
    .trim();
  const key = modelKey(raw);
  const knownModels = Object.keys(pricing);

  return (
    knownModels.find((name) => modelKey(name) === key) ??
    knownModels.find((name) => key.includes(modelKey(name))) ??
    (raw || 'Unknown model')
  );
}

export function pricingModelForModel(model, pricing, fallbackPricingModel) {
  const normalized = normalizeModel(model, pricing);

  return pricing[normalized] ? normalized : fallbackPricingModel;
}

export function priceForPricingModel(pricingModel, pricing, fallbackPricingModel) {
  return pricing[pricingModel || ''] ?? pricing[fallbackPricingModel];
}

export function priceForTokens(pricingModel, tokens, pricing, fallbackPricingModel) {
  const basePrice = priceForPricingModel(pricingModel, pricing, fallbackPricingModel);
  const rawInputTokens =
    Math.max(0, Number(tokens?.input ?? 0)) + Math.max(0, Number(tokens?.cachedInput ?? 0));
  const tier = [...(basePrice.tiers ?? [])]
    .sort((a, b) => b.thresholdInputTokensExclusive - a.thresholdInputTokensExclusive)
    .find((candidate) => rawInputTokens > candidate.thresholdInputTokensExclusive);

  return tier ? { ...basePrice, ...tier, tiers: basePrice.tiers } : basePrice;
}

export function costBreakdownUsdForTokens(pricingModel, tokens, pricing, fallbackPricingModel) {
  const price = priceForTokens(pricingModel, tokens, pricing, fallbackPricingModel);
  const input = (tokens.input / 1_000_000) * price.input;
  const cachedInput = (tokens.cachedInput / 1_000_000) * price.cachedInput;
  const cacheWrite = (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0);
  const output = (tokens.output / 1_000_000) * price.output;

  return {
    input,
    cachedInput,
    cacheWrite,
    output,
    total: input + cachedInput + cacheWrite + output,
    tier: price.label ?? price.tierLabel ?? 'Default',
  };
}

export function modelUsesPricingFallback(model, pricingModel, pricing, fallbackPricingModel) {
  const normalized = normalizeModel(model, pricing);
  const priceRow = pricingModel || pricingModelForModel(normalized, pricing, fallbackPricingModel);

  return priceRow !== normalized || !pricing[normalized];
}

export function costUsdForTokens(pricingModel, tokens, pricing, fallbackPricingModel) {
  return costBreakdownUsdForTokens(pricingModel, tokens, pricing, fallbackPricingModel).total;
}
