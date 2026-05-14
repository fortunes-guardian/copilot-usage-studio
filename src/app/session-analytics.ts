import { CopilotSession } from './session-data.model';
import { sessionTotalTokens, tokenTotal, usesPricingFallback } from './session-cost-utils';

export type SessionSize = 'Small' | 'Medium' | 'Large' | 'Very large';
export type AnalyticsTimeRange = 'all' | '7d' | '30d' | '90d';
export type AnalyticsGrouping = 'day' | 'week' | 'month';

export interface AnalyticsModelRow {
  model: string;
  pricingModel: string;
  turns: number;
  tokens: number;
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  cost: number;
  sessionCount: number;
  costPer1k: number;
  share: number;
  usesFallbackPrice: boolean;
}

export interface AnalyticsTrendRow {
  key: string;
  label: string;
  count: number;
  tokens: number;
  cost: number;
}

export interface AnalyticsDistributionRow {
  size: SessionSize;
  count: number;
  tokens: number;
  cost: number;
  share: number;
}

export interface AnalyticsOutlier {
  session: CopilotSession;
  tokens: number;
  score: number;
  reason: string;
}

export function filterAnalyticsSessions(
  sessions: CopilotSession[],
  timeRange: AnalyticsTimeRange,
  workspace: string,
  model: string,
): CopilotSession[] {
  const cutoff = analyticsCutoff(sessions, timeRange);

  return sessions.filter((session) => {
    if (cutoff && new Date(session.startedAt).getTime() < cutoff) {
      return false;
    }

    if (workspace !== 'all' && session.workspace !== workspace) {
      return false;
    }

    return (
      model === 'all' ||
      session.modelBreakdown.some((row) => row.pricingModel === model || row.model === model)
    );
  });
}

export function analyticsModelRows(sessions: CopilotSession[], totalCost: number): AnalyticsModelRow[] {
  const rows = new Map<
    string,
    {
      model: string;
      pricingModel: string;
      turns: number;
      sessions: Set<string>;
      tokens: number;
      input: number;
      cachedInput: number;
      cacheWrite: number;
      output: number;
      cost: number;
    }
  >();

  for (const session of sessions) {
    for (const entry of session.modelBreakdown) {
      const key = `${entry.model}::${entry.pricingModel}`;
      const current =
        rows.get(key) ??
        {
          model: entry.model,
          pricingModel: entry.pricingModel,
          turns: 0,
          sessions: new Set<string>(),
          tokens: 0,
          input: 0,
          cachedInput: 0,
          cacheWrite: 0,
          output: 0,
          cost: 0,
        };

      current.turns += entry.turns;
      current.sessions.add(session.id);
      current.tokens += tokenTotal(entry.tokens);
      current.input += entry.tokens.input;
      current.cachedInput += entry.tokens.cachedInput;
      current.cacheWrite += entry.tokens.cacheWrite;
      current.output += entry.tokens.output;
      current.cost += entry.cost.usd;
      rows.set(key, current);
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      sessionCount: row.sessions.size,
      costPer1k: row.tokens ? (row.cost / row.tokens) * 1000 : 0,
      share: totalCost > 0 ? (row.cost / totalCost) * 100 : 0,
      usesFallbackPrice: usesPricingFallback(row.model, row.pricingModel),
    }))
    .sort((a, b) => b.cost - a.cost);
}

export function analyticsTrendRows(sessions: CopilotSession[], grouping: AnalyticsGrouping): AnalyticsTrendRow[] {
  const rows = new Map<string, AnalyticsTrendRow>();

  for (const session of sessions) {
    const group = analyticsGroupKey(session.startedAt, grouping);
    const current = rows.get(group.key) ?? { ...group, count: 0, tokens: 0, cost: 0 };

    current.count += 1;
    current.tokens += sessionTotalTokens(session);
    current.cost += session.cost.usd;
    rows.set(group.key, current);
  }

  return [...rows.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 8);
}

export function analyticsDistribution(sessions: CopilotSession[], totalCost: number): AnalyticsDistributionRow[] {
  const sizeOptions: SessionSize[] = ['Small', 'Medium', 'Large', 'Very large'];

  return sizeOptions.map((size) => {
    const bucket = sessions.filter((session) => sessionSize(sessionTotalTokens(session)) === size);
    const tokens = bucket.reduce((sum, session) => sum + sessionTotalTokens(session), 0);
    const cost = bucket.reduce((sum, session) => sum + session.cost.usd, 0);

    return {
      size,
      count: bucket.length,
      tokens,
      cost,
      share: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    };
  });
}

export function analyticsOutliers(
  sessions: CopilotSession[],
  avgCost: number,
  avgTokens: number,
): AnalyticsOutlier[] {
  if (!sessions.length) {
    return [];
  }

  const costStd = standardDeviation(sessions.map((session) => session.cost.usd));
  const tokenStd = standardDeviation(sessions.map((session) => sessionTotalTokens(session)));

  return sessions
    .map((session) => {
      const tokens = sessionTotalTokens(session);
      const costScore = costStd > 0 ? (session.cost.usd - avgCost) / costStd : 0;
      const tokenScore = tokenStd > 0 ? (tokens - avgTokens) / tokenStd : 0;
      const score = Math.max(costScore, tokenScore);
      const reason = analyticsOutlierReason(session, costScore, tokenScore);

      return { session, tokens, score, reason };
    })
    .filter((row) => row.score >= 1 || sessions.length <= 5)
    .sort((a, b) => b.score - a.score || b.session.cost.usd - a.session.cost.usd)
    .slice(0, 5);
}

export function analyticsCutoff(sessions: CopilotSession[], timeRange: AnalyticsTimeRange): number | null {
  if (timeRange === 'all' || !sessions.length) {
    return null;
  }

  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const latest = Math.max(...sessions.map((session) => new Date(session.startedAt).getTime()).filter(Number.isFinite));

  return Number.isFinite(latest) ? latest - days * 24 * 60 * 60 * 1000 : null;
}

export function analyticsGroupKey(startedAt: string, grouping: AnalyticsGrouping): { key: string; label: string } {
  const date = new Date(startedAt);

  if (!Number.isFinite(date.getTime())) {
    return { key: 'unknown', label: 'Unknown date' };
  }

  const day = isoDate(date);

  if (grouping === 'day') {
    return { key: day, label: day };
  }

  if (grouping === 'month') {
    return { key: day.slice(0, 7), label: day.slice(0, 7) };
  }

  const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek + 1);

  return { key: isoDate(weekStart), label: `Week of ${isoDate(weekStart)}` };
}

export function sessionSize(tokens: number): SessionSize {
  if (tokens >= 1_500_000) {
    return 'Very large';
  }

  if (tokens >= 500_000) {
    return 'Large';
  }

  if (tokens >= 100_000) {
    return 'Medium';
  }

  return 'Small';
}

export function maxBy<T>(items: T[], valueFor: (item: T) => number): T | null {
  return items.reduce<T | null>((best, item) => (!best || valueFor(item) > valueFor(best) ? item : best), null);
}

function analyticsOutlierReason(session: CopilotSession, costScore: number, tokenScore: number): string {
  const totalTokens = sessionTotalTokens(session);
  const inputTokens = session.tokens.input + session.tokens.cachedInput + session.tokens.cacheWrite;
  const inputShare = totalTokens ? (inputTokens / totalTokens) * 100 : 0;
  const topModel = maxBy(session.modelBreakdown, (row) => row.cost.usd);
  const topModelShare = topModel && session.cost.usd > 0 ? (topModel.cost.usd / session.cost.usd) * 100 : 0;
  const modelTurns = session.traceSummary.modelTurns;
  const toolCalls = session.traceSummary.toolCalls;
  const traceActivity = modelTurns + toolCalls;
  const isVeryHighOutlier = Math.max(costScore, tokenScore) >= 2;

  if (isVeryHighOutlier && traceActivity <= 3 && totalTokens >= 100_000) {
    return `Suspicious spike: ${totalTokens.toLocaleString()} tokens with only ${traceActivity.toLocaleString()} imported model/tool events. Inspect the largest model call and source log shape.`;
  }

  if (inputShare >= 85 && inputTokens >= 100_000) {
    return `Mostly input/context tokens (${inputShare.toFixed(0)}% of imported tokens). Check prompt context, repo reads, prior conversation, and tool results.`;
  }

  if (topModel && topModelShare >= 70) {
    return `${topModel.pricingModel} produced ${topModelShare.toFixed(0)}% of this run's estimate. Model mix is the first thing to inspect.`;
  }

  if (toolCalls >= 20) {
    return `${toolCalls.toLocaleString()} tool calls may have added results back into later model input.`;
  }

  if (session.traceSummary.errors === 0 && modelTurns >= 8 && toolCalls >= 8) {
    return `Large but plausible long agent run: ${modelTurns.toLocaleString()} model turns and ${toolCalls.toLocaleString()} tool calls with no imported errors. Inspect input/context and tool activity before treating it as waste.`;
  }

  return costScore >= tokenScore
    ? `Cost is ${costScore.toFixed(1)} standard deviations above this cohort. Check model price rows and output mix.`
    : `Tokens are ${tokenScore.toFixed(1)} standard deviations above this cohort. Check input context and model-turn count.`;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return Math.sqrt(variance);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
