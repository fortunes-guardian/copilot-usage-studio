import { CopilotSession, ModelBreakdown, TokenBreakdown, TraceEvent } from './session-data.model';
import {
  COPILOT_AI_CREDIT_USD,
  modelUsesPricingFallback,
  priceForPricingModel,
  pricingFallbackReason,
} from './pricing';

export interface PricedModelBreakdown extends ModelBreakdown {
  provider: string;
  releaseStatus: string;
  category: string;
  inputRate: number;
  cachedInputRate: number;
  cacheWriteRate: number;
  outputRate: number;
  inputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  totalUsd: number;
  share: number;
  usesFallbackPrice: boolean;
}

export function explainModelCost(
  entry: ModelBreakdown,
  sessionCostUsd: number,
): PricedModelBreakdown {
  const pricingModel = entry.pricingModel || entry.model;
  const price = priceForPricingModel(pricingModel);
  const inputUsd = tokenCostUsd(entry.tokens.input, price.input);
  const cachedInputUsd = tokenCostUsd(entry.tokens.cachedInput, price.cachedInput);
  const cacheWriteUsd = tokenCostUsd(entry.tokens.cacheWrite, price.cacheWrite ?? 0);
  const outputUsd = tokenCostUsd(entry.tokens.output, price.output);
  const totalUsd = inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd;

  return {
    ...entry,
    provider: price.provider,
    releaseStatus: price.releaseStatus,
    category: price.category,
    inputRate: price.input,
    cachedInputRate: price.cachedInput,
    cacheWriteRate: price.cacheWrite ?? 0,
    outputRate: price.output,
    inputUsd,
    cachedInputUsd,
    cacheWriteUsd,
    outputUsd,
    totalUsd,
    share: sessionCostUsd > 0 ? (totalUsd / sessionCostUsd) * 100 : 0,
    usesFallbackPrice: modelUsesPricingFallback(entry.model, pricingModel),
  };
}

export function contextStats(
  session: CopilotSession,
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

export function tokenCostUsd(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion;
}

export function tokenTotal(tokens: TokenBreakdown): number {
  return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
}

export function sessionTotalTokens(session: CopilotSession): number {
  return tokenTotal(session.tokens);
}

export function sessionUsageUsd(session: CopilotSession): number {
  return finiteNumber(session.sourceUsage?.usd) ?? session.cost.usd;
}

export function sessionUsageCredits(session: CopilotSession): number {
  return finiteNumber(session.sourceUsage?.credits) ?? session.cost.usd / COPILOT_AI_CREDIT_USD;
}

export function sessionUsageLabel(session: CopilotSession): 'GitHub usage' | 'Estimate fallback' {
  return session.sourceUsage ? 'GitHub usage' : 'Estimate fallback';
}

export function traceEventUsageUsd(event: TraceEvent): number | null {
  return finiteNumber(event.sourceUsage?.usd);
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

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}


