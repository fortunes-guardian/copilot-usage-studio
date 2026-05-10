import { LedgerSession, ModelBreakdown, TokenBreakdown } from './ledger.model';
import { modelUsesPricingFallback, priceForPricingModel, pricingFallbackReason } from './pricing';

export interface PricedModelBreakdown extends ModelBreakdown {
  provider: string;
  releaseStatus: string;
  category: string;
  inputRate: number;
  cachedInputRate: number;
  cacheWriteRate: number;
  outputRate: number;
  inputEur: number;
  cachedInputEur: number;
  cacheWriteEur: number;
  outputEur: number;
  totalEur: number;
  share: number;
  usesFallbackPrice: boolean;
}

export function explainModelCost(
  entry: ModelBreakdown,
  usdToEur: number,
  sessionCostEur: number,
): PricedModelBreakdown {
  const pricingModel = entry.pricingModel || entry.model;
  const price = priceForPricingModel(pricingModel);
  const inputEur = tokenCostEur(entry.tokens.input, price.input, usdToEur);
  const cachedInputEur = tokenCostEur(entry.tokens.cachedInput, price.cachedInput, usdToEur);
  const cacheWriteEur = tokenCostEur(entry.tokens.cacheWrite, price.cacheWrite ?? 0, usdToEur);
  const outputEur = tokenCostEur(entry.tokens.output, price.output, usdToEur);
  const totalEur = inputEur + cachedInputEur + cacheWriteEur + outputEur;

  return {
    ...entry,
    provider: price.provider,
    releaseStatus: price.releaseStatus,
    category: price.category,
    inputRate: price.input,
    cachedInputRate: price.cachedInput,
    cacheWriteRate: price.cacheWrite ?? 0,
    outputRate: price.output,
    inputEur,
    cachedInputEur,
    cacheWriteEur,
    outputEur,
    totalEur,
    share: sessionCostEur > 0 ? (totalEur / sessionCostEur) * 100 : 0,
    usesFallbackPrice: modelUsesPricingFallback(entry.model, pricingModel),
  };
}

export function contextStats(
  session: LedgerSession,
): { firstAvg: number; lastAvg: number; growth: number; count: number } | null {
  const llmEvents = session.traceEvents
    .filter((event) => event.type === 'llm_request' && (event.inputTokens || event.outputTokens))
    .sort((a, b) => a.index - b.index);

  if (llmEvents.length < 2) {
    return null;
  }

  const firstAvg = average(llmEvents.slice(0, 3).map((event) => event.inputTokens));
  const lastAvg = average(llmEvents.slice(-3).map((event) => event.inputTokens));

  return {
    firstAvg,
    lastAvg,
    growth: firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0,
    count: llmEvents.length,
  };
}

export function tokenCostEur(tokens: number, usdPerMillion: number, usdToEur: number): number {
  return (tokens / 1_000_000) * usdPerMillion * usdToEur;
}

export function tokenTotal(tokens: TokenBreakdown): number {
  return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
}

export function sessionTotalTokens(session: LedgerSession): number {
  return tokenTotal(session.tokens);
}

export function percentDelta(a: number, b: number): number | null {
  return a === 0 ? null : ((b - a) / a) * 100;
}

export const usesPricingFallback = modelUsesPricingFallback;
export { pricingFallbackReason };

export function setsDiffer(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return true;
  }

  return [...a].some((value) => !b.has(value));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
