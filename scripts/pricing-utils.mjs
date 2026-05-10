export function modelKey(model) {
  return String(model ?? '')
    .replace(/^copilot\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeModel(model, pricing) {
  const raw = String(model ?? '').replace(/^copilot\//i, '').trim();
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

export function modelUsesPricingFallback(model, pricingModel, pricing, fallbackPricingModel) {
  const normalized = normalizeModel(model, pricing);
  const priceRow = pricingModel || pricingModelForModel(normalized, pricing, fallbackPricingModel);

  return priceRow !== normalized || !pricing[normalized];
}

export function costUsdForTokens(pricingModel, tokens, pricing, fallbackPricingModel) {
  const price = priceForPricingModel(pricingModel, pricing, fallbackPricingModel);

  return (
    (tokens.input / 1_000_000) * price.input +
    (tokens.cachedInput / 1_000_000) * price.cachedInput +
    (tokens.cacheWrite / 1_000_000) * (price.cacheWrite ?? 0) +
    (tokens.output / 1_000_000) * price.output
  );
}
