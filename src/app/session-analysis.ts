import { LedgerSession, ModelBreakdown, TokenBreakdown, TraceEvent } from './ledger.model';
import {
  modelKey,
  modelUsesPricingFallback,
  priceForPricingModel,
  pricingModelForModel,
} from './pricing';

export type SessionSize = 'Small' | 'Medium' | 'Large' | 'Very large';
export type WarningTone = 'low' | 'info' | 'medium' | 'high';
export type ModelCallSort = 'timeline' | 'largest';
export type TraceFilter = 'all' | 'model' | 'tool' | 'discovery' | 'message' | 'response' | 'error';

export interface SessionWarning {
  label: string;
  tone: WarningTone;
  help: string;
}

export interface SessionTriage {
  size: SessionSize;
  sizeTone: WarningTone;
  totalTokens: number;
  warnings: SessionWarning[];
}

export type ModelCostRow = ReturnType<typeof explainModelCost>;
export type ModelCallRow = ReturnType<typeof modelCallRows>[number];
export type TopTokenEvent = ReturnType<typeof topTokenEvents>[number];
export type CostAnswer = ReturnType<typeof costAnswer>;

export function buildCostExplanation(session: LedgerSession, usdToEur: number, sort: ModelCallSort) {
  const modelRows = session.modelBreakdown.map((entry) => explainModelCost(entry, usdToEur, session.cost.eur));
  const categoryRows = explainCategoryCosts(modelRows);
  const modelCallRowList = modelCallRows(
    session.traceEvents,
    session.modelBreakdown,
    usdToEur,
    session.cost.eur,
    sort,
  );
  const topTokenEventList = topTokenEvents(session.traceEvents, session.modelBreakdown, usdToEur);
  const costDrivers = explainCostDrivers(session, modelRows, topTokenEventList);
  const hasCacheData = session.tokens.cachedInput > 0 || session.tokens.cacheWrite > 0;
  const answer = costAnswer(session, modelRows, modelCallRowList);
  const billingReality = billingRealityCheck(session, answer, hasCacheData);
  const turnInsightList = turnInsights(modelCallRowList);

  return {
    hasCacheData,
    sourceStrength:
      session.tokenSource === 'llm_request_token_totals' ? 'Exact local token counts' : 'Estimated token counts',
    sourceDescription:
      session.tokenSource === 'llm_request_token_totals'
        ? 'Imported from VS Code Copilot debug-log llm_request events. This is the strongest local source for session input and output tokens.'
        : 'Estimated from visible chat/session data. Useful context, but weaker than debug-log llm_request totals.',
    cacheStatus: hasCacheData ? 'Cache tokens included' : 'Cache billing not visible locally',
    cacheDescription: hasCacheData
      ? 'This session includes cached input or cache-write token totals in the generated ledger.'
      : 'The VS Code debug-log events imported for this session expose inputTokens and outputTokens, but not billing cache read/write fields. The estimate therefore prices visible local input/output totals and keeps cache accounting explicit as unavailable.',
    modelRows,
    categoryRows,
    costAnswer: answer,
    billingReality,
    costDrivers,
    modelCallRows: modelCallRowList,
    topTokenEvents: topTokenEventList,
    turnInsights: turnInsightList,
  };
}

export function sessionTriage(session: LedgerSession): SessionTriage {
  const totalTokens = sessionTotalTokens(session);
  const size = sessionSize(totalTokens);
  const warnings: SessionWarning[] = [];
  const growth = contextGrowth(session);
  const maxInput = Math.max(
    ...session.traceEvents.filter((event) => event.type === 'llm_request').map((event) => event.inputTokens),
    0,
  );

  if (session.tokens.input >= 150_000 || maxInput >= 100_000) {
    warnings.push({
      label: 'High input context',
      tone: 'high',
      help:
        'Large prompt/context payloads are being sent into the model. This usually means repo context, prior conversation, or tool results are driving cost.',
    });
  }

  if (growth !== null && growth >= 25) {
    warnings.push({
      label: 'Context growth',
      tone: growth >= 80 ? 'medium' : 'info',
      help:
        'Expected in many agent runs: later model calls received more input tokens than early calls. It matters because accumulated context is often resent and can become a major cost driver.',
    });
  }

  if (session.modelBreakdown.length > 1) {
    warnings.push({
      label: 'Mixed models',
      tone: 'medium',
      help:
        'This run used more than one model. Cost is the sum of each model row, so model switches can make estimates harder to read at a glance.',
    });
  }

  if (session.tokens.cachedInput === 0 && session.tokens.cacheWrite === 0) {
    warnings.push({
      label: 'Cache unknown',
      tone: 'info',
      help:
        'The local VS Code debug logs imported here do not expose provider cache read/write billing fields. Do not read this as proof that provider-side cache billing was zero.',
    });
  }

  if (session.vscodeState) {
    warnings.push({
      label: 'State enriched',
      tone: 'info',
      help:
        'The title or metadata was improved from VS Code state.vscdb. Pricing still comes from token-bearing debug-log events.',
    });
  }

  return {
    size,
    sizeTone: size === 'Very large' ? 'high' : size === 'Large' ? 'medium' : 'info',
    totalTokens,
    warnings,
  };
}

export function sessionSizeHelp(triage: SessionTriage): string {
  return `${triage.size} session based on ${triage.totalTokens.toLocaleString()} imported tokens. Current thresholds: Small under 50k, Medium under 200k, Large under 600k, Very large at 600k or more.`;
}

export function flowTraceEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
  return events
    .filter((event) => isFlowEvent(event))
    .map((event, index) => {
      const pricingModel = pricingModelForEvent(event, modelBreakdown);
      const price = priceForPricingModel(pricingModel);
      const estimatedEur =
        event.estimatedCost?.eur ??
        tokenCostEur(event.inputTokens, price.input, usdToEur) +
          tokenCostEur(event.outputTokens, price.output, usdToEur);

      return {
        ...event,
        flowIndex: index + 1,
        totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
        pricingModel,
        estimatedEur,
      };
    });
}

export function matchesTraceFilter(event: TraceEvent, filter: TraceFilter): boolean {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'model') {
    return Boolean(event.inputTokens || event.outputTokens || event.type === 'llm_request');
  }

  if (filter === 'tool') {
    return event.type.includes('tool') || toolLikeEventNames().some((name) => event.name.toLowerCase().includes(name));
  }

  if (filter === 'discovery') {
    return event.type === 'discovery' || event.name.toLowerCase().includes('discovery') || event.detail.toLowerCase().includes('resolved ');
  }

  if (filter === 'message') {
    return event.type === 'user_message';
  }

  if (filter === 'response') {
    return event.type === 'agent_response' || event.type === 'assistant.message';
  }

  return event.status !== 'ok' && event.status !== 'unknown';
}

export function traceEventDetails(event: TraceEvent, modelBreakdown: ModelBreakdown[], usdToEur: number) {
  const pricingModel = pricingModelForEvent(event, modelBreakdown);
  const price = priceForPricingModel(pricingModel);
  const inputEur = tokenCostEur(event.inputTokens, price.input, usdToEur);
  const outputEur = tokenCostEur(event.outputTokens, price.output, usdToEur);
  const estimatedEur = event.estimatedCost?.eur ?? inputEur + outputEur;
  const totalTokens = event.totalTokens ?? event.inputTokens + event.outputTokens;
  const rawModel = event.rawModel || event.model || modelFromEventDetail(event.detail);
  const normalizedFields = [
    { label: 'Raw index', value: `#${event.index}` },
    { label: 'Timestamp', value: event.timestamp },
    { label: 'Type', value: event.type },
    { label: 'Name', value: event.name },
    { label: 'Status', value: event.status },
    ...(event.model ? [{ label: 'Model', value: event.model }] : []),
    ...(rawModel ? [{ label: 'Raw model', value: rawModel }] : []),
    ...(event.inputTokens || event.outputTokens
      ? [
          { label: 'Input tokens', value: event.inputTokens.toLocaleString() },
          { label: 'Output tokens', value: event.outputTokens.toLocaleString() },
          { label: 'Total tokens', value: totalTokens.toLocaleString() },
          { label: 'Pricing row', value: pricingModel },
          {
            label: 'Estimated cost',
            value: `€${estimatedEur.toLocaleString(undefined, {
              minimumFractionDigits: 6,
              maximumFractionDigits: 6,
            })}`,
          },
        ]
      : []),
    ...(event.ttftMs ? [{ label: 'TTFT', value: `${event.ttftMs.toLocaleString()} ms` }] : []),
    ...(event.maxTokens ? [{ label: 'Max tokens', value: event.maxTokens.toLocaleString() }] : []),
    ...(event.hasReasoning ? [{ label: 'Reasoning text', value: 'Present in debug log payload' }] : []),
  ];

  return {
    normalizedFields,
    attributeFields: event.attributes ?? [],
    detail: event.detail || 'No detail text imported for this event.',
    hasCost: Boolean(event.inputTokens || event.outputTokens),
    inputEur,
    outputEur,
    estimatedEur,
    totalTokens,
    pricingModel,
    usesFallbackPrice: modelUsesPricingFallback(rawModel, pricingModel),
  };
}

export const usesPricingFallback = modelUsesPricingFallback;

export function sessionTotalTokens(session: LedgerSession): number {
  return tokenTotal(session.tokens);
}

function explainModelCost(entry: ModelBreakdown, usdToEur: number, sessionCostEur: number) {
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

function explainCategoryCosts(modelRows: ModelCostRow[]) {
  return [
    {
      label: 'Input',
      tokens: sumTokens(modelRows, 'input'),
      eur: modelRows.reduce((sum, row) => sum + row.inputEur, 0),
      description: 'Prompt, context, tool, and repository material sent into the model.',
    },
    {
      label: 'Output',
      tokens: sumTokens(modelRows, 'output'),
      eur: modelRows.reduce((sum, row) => sum + row.outputEur, 0),
      description: 'Generated model response tokens.',
    },
    {
      label: 'Cached input',
      tokens: sumTokens(modelRows, 'cachedInput'),
      eur: modelRows.reduce((sum, row) => sum + row.cachedInputEur, 0),
      description: 'Prompt tokens served from provider cache when that billing signal is available.',
    },
    {
      label: 'Cache write',
      tokens: sumTokens(modelRows, 'cacheWrite'),
      eur: modelRows.reduce((sum, row) => sum + row.cacheWriteEur, 0),
      description: 'Provider cache creation tokens. GitHub lists this mainly for Anthropic models.',
    },
  ];
}

function costAnswer(session: LedgerSession, modelRows: ModelCostRow[], modelCallRowList: ModelCallRow[]) {
  const sessionCost = Math.max(session.cost.eur, 0);
  const totalTokens = sessionTotalTokens(session);
  const inputEur = modelRows.reduce((sum, row) => sum + row.inputEur, 0);
  const outputEur = modelRows.reduce((sum, row) => sum + row.outputEur, 0);
  const inputShare = sessionCost > 0 ? (inputEur / sessionCost) * 100 : 0;
  const outputShare = sessionCost > 0 ? (outputEur / sessionCost) * 100 : 0;
  const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0] ?? null;
  const topModelShare = topModel && sessionCost > 0 ? (topModel.totalEur / sessionCost) * 100 : 0;
  const topCall = [...modelCallRowList].sort((a, b) => b.estimatedEur - a.estimatedEur)[0] ?? null;
  const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedEur / sessionCost) * 100 : 0;
  const category = inputShare >= outputShare ? 'Input/context' : 'Output';
  const categoryShare = Math.max(inputShare, outputShare);
  const costPer1k = totalTokens ? (sessionCost / totalTokens) * 1000 : 0;

  return {
    category,
    categoryShare,
    categoryDetail:
      category === 'Input/context'
        ? 'Most of the estimate comes from tokens sent into the model: prompt, prior chat, repo context, and tool results.'
        : 'Most of the estimate comes from generated model output. Inspect long responses or repeated generation.',
    costPer1k,
    inputShare,
    outputShare,
    topModelLabel: topModel?.model ?? session.model,
    topModelShare,
    topCallLabel: topCall ? `#${topCall.callNumber}` : 'None',
    topCallShare,
    topCallDetail: topCall
      ? `Raw event #${topCall.index}, ${topCall.totalTokens.toLocaleString()} tokens.`
      : 'No token-bearing model call rows were imported.',
  };
}

function turnInsights(modelCallRowList: ModelCallRow[]) {
  const totalCost = modelCallRowList.reduce((sum, row) => sum + row.estimatedEur, 0);
  const mostExpensive = [...modelCallRowList].sort((a, b) => b.estimatedEur - a.estimatedEur)[0] ?? null;
  const largestInput = [...modelCallRowList].sort((a, b) => b.inputTokens - a.inputTokens)[0] ?? null;
  const largestOutput = [...modelCallRowList].sort((a, b) => b.outputTokens - a.outputTokens)[0] ?? null;
  const averageCost = modelCallRowList.length ? totalCost / modelCallRowList.length : 0;

  return [
    {
      label: 'Model calls',
      value: modelCallRowList.length.toLocaleString(),
      detail: 'Token-bearing llm_request events imported from the VS Code debug log.',
    },
    {
      label: 'Most expensive call',
      value: mostExpensive ? `#${mostExpensive.callNumber} · €${mostExpensive.estimatedEur.toFixed(4)}` : 'None',
      detail: mostExpensive
        ? `${mostExpensive.totalTokens.toLocaleString()} tokens, raw event #${mostExpensive.index}.`
        : 'No priced model call rows are available.',
    },
    {
      label: 'Largest input',
      value: largestInput ? `#${largestInput.callNumber} · ${largestInput.inputTokens.toLocaleString()}` : 'None',
      detail: largestInput
        ? 'This is the biggest prompt/context payload sent into the model.'
        : 'No input token totals were imported.',
    },
    {
      label: 'Largest output',
      value: largestOutput ? `#${largestOutput.callNumber} · ${largestOutput.outputTokens.toLocaleString()}` : 'None',
      detail: largestOutput
        ? 'This is the largest generated response in the imported model calls.'
        : 'No output token totals were imported.',
    },
    {
      label: 'Avg cost / call',
      value: `€${averageCost.toFixed(4)}`,
      detail: 'Useful for spotting whether cost came from one spike or many steady calls.',
    },
  ];
}

function billingRealityCheck(session: LedgerSession, answer: CostAnswer, hasCacheData: boolean) {
  if (hasCacheData) {
    return {
      tone: 'low',
      cacheVisibility: 'Cache fields present',
      confidenceLabel: 'Cache-aware local estimate',
      headline: 'This run includes cache token fields in the ledger.',
      detail:
        'The app can price normal input, cached input, cache write, and output separately for this run. It is still a local estimate, not an invoice.',
    };
  }

  if (answer.outputShare >= 70) {
    return {
      tone: 'low',
      cacheVisibility: 'Cache fields unavailable',
      confidenceLabel: 'Low cache impact likely',
      headline: 'Output dominates this estimate.',
      detail:
        'Missing cached input is less likely to change the main story because generated output remains billed as output. Use the estimate to debug response size and repeated generation first.',
    };
  }

  if (answer.inputShare >= 60) {
    return {
      tone: 'high',
      cacheVisibility: 'Cache fields unavailable',
      confidenceLabel: 'Cache could materially change estimate',
      headline: 'Input/context dominates this estimate.',
      detail:
        'VS Code logged input tokens, but did not split normal input from cached input. If much of this context was cached provider-side, the invoice may be lower than this local full-input estimate.',
    };
  }

  return {
    tone: session.confidence === 'exact' ? 'medium' : 'high',
    cacheVisibility: 'Cache fields unavailable',
    confidenceLabel: session.confidence === 'exact' ? 'Directional billing estimate' : 'Rough billing estimate',
    headline: 'Cache impact is unknown for this token mix.',
    detail:
      'The imported data is still useful for finding the expensive turns and model mix, but it cannot prove how GitHub split input between normal and cached billing buckets.',
  };
}

function explainCostDrivers(session: LedgerSession, modelRows: ModelCostRow[], topTokenEventList: TopTokenEvent[]) {
  const inputEur = modelRows.reduce((sum, row) => sum + row.inputEur, 0);
  const outputEur = modelRows.reduce((sum, row) => sum + row.outputEur, 0);
  const sessionCost = Math.max(session.cost.eur, 0);
  const inputShare = sessionCost > 0 ? (inputEur / sessionCost) * 100 : 0;
  const outputShare = sessionCost > 0 ? (outputEur / sessionCost) * 100 : 0;
  const topCall = topTokenEventList[0];
  const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedEur / sessionCost) * 100 : 0;
  const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0];
  const topModelShare = topModel && sessionCost > 0 ? (topModel.totalEur / sessionCost) * 100 : 0;
  const stats = contextStats(session);
  const growth = stats?.growth ?? 0;
  const firstAvg = stats?.firstAvg ?? 0;
  const lastAvg = stats?.lastAvg ?? 0;
  const llmEventCount = stats?.count ?? 0;
  const toolCalls = session.traceSummary.toolCalls;
  const toolsPerTurn = session.traceSummary.modelTurns > 0 ? toolCalls / session.traceSummary.modelTurns : 0;
  const mixedModelCount = modelRows.length;

  return [
    {
      title: 'Input context burn',
      value: `${Math.round(inputShare)}%`,
      detail:
        inputShare >= outputShare
          ? `Most cost is prompt/context material sent into the model: ${session.tokens.input.toLocaleString()} input tokens.`
          : `Output is the larger priced category here, but input still contributes ${inputShare.toFixed(0)}% of this estimate.`,
      tone: inputShare >= 75 ? 'high' : inputShare >= 50 ? 'medium' : 'low',
    },
    {
      title: 'Largest model call',
      value: topCall ? `€${topCall.estimatedEur.toFixed(4)}` : 'None',
      detail: topCall
        ? `Raw event index #${topCall.index} used ${topCall.totalTokens.toLocaleString()} tokens and accounts for about ${topCallShare.toFixed(0)}% of this run.`
        : 'No token-bearing model calls were imported for this session.',
      tone: topCallShare >= 25 ? 'high' : topCallShare >= 10 ? 'medium' : 'low',
    },
    {
      title: 'Context growth',
      value: llmEventCount >= 2 ? `${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%` : 'n/a',
      detail:
        llmEventCount >= 2
          ? `Average input moved from ${Math.round(firstAvg).toLocaleString()} tokens at the start to ${Math.round(lastAvg).toLocaleString()} near the end.`
          : 'Not enough model calls to detect whether context grew during the run.',
      tone: growth >= 80 ? 'high' : growth >= 25 ? 'medium' : 'low',
    },
    {
      title: 'Model mix',
      value: mixedModelCount === 1 ? topModel?.model ?? session.model : `${mixedModelCount} models`,
      detail: topModel
        ? `${topModel.model} contributes about ${topModelShare.toFixed(0)}% of estimated cost using the ${topModel.pricingModel} price row.`
        : 'No model breakdown is available for this session.',
      tone: mixedModelCount > 1 || topModelShare >= 80 ? 'medium' : 'low',
    },
    {
      title: 'Tool activity',
      value: toolCalls.toLocaleString(),
      detail:
        toolCalls > 0
          ? `${toolsPerTurn.toFixed(1)} tool calls per model turn. Tool results can increase later prompt/context size when they are sent back to the model.`
          : 'No tool calls were imported for this session.',
      tone: toolsPerTurn >= 4 ? 'high' : toolsPerTurn >= 2 ? 'medium' : 'low',
    },
  ];
}

function topTokenEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
  return pricedModelCallEvents(events, modelBreakdown, usdToEur)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 5);
}

function modelCallRows(
  events: TraceEvent[],
  modelBreakdown: ModelBreakdown[],
  usdToEur: number,
  sessionCostEur: number,
  sort: ModelCallSort,
) {
  const rows = pricedModelCallEvents(events, modelBreakdown, usdToEur).map((event, index) => {
    const context = nearbyContextForEvent(event, events);

    return {
      ...event,
      callNumber: index + 1,
      share: sessionCostEur > 0 ? (event.estimatedEur / sessionCostEur) * 100 : 0,
      contextLabel: context.label,
      contextDetail: context.detail,
    };
  });

  return sort === 'largest'
    ? [...rows].sort((a, b) => b.estimatedEur - a.estimatedEur || b.totalTokens - a.totalTokens)
    : rows;
}

function pricedModelCallEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
  return events
    .filter((event) => event.inputTokens || event.outputTokens)
    .map((event) => {
      const pricingModel = pricingModelForEvent(event, modelBreakdown);
      const price = priceForPricingModel(pricingModel);
      const inputEur = tokenCostEur(event.inputTokens, price.input, usdToEur);
      const outputEur = tokenCostEur(event.outputTokens, price.output, usdToEur);
      const estimatedEur = event.estimatedCost?.eur ?? inputEur + outputEur;

      return {
        ...event,
        totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
        pricingModel,
        usesFallbackPrice: modelUsesPricingFallback(event.model || modelFromEventDetail(event.detail), pricingModel),
        inputEur,
        outputEur,
        estimatedEur,
      };
    });
}

function isFlowEvent(event: TraceEvent): boolean {
  return (
    event.type === 'user_message' ||
    event.type === 'llm_request' ||
    event.type.includes('tool') ||
    event.type === 'agent_response'
  );
}

function toolLikeEventNames(): string[] {
  return ['read_file', 'list_dir', 'grep_search', 'semantic_search', 'fetch_webpage', 'apply_patch', 'run_in_terminal'];
}

function pricingModelForEvent(event: TraceEvent, modelBreakdown: ModelBreakdown[]): string {
  if (event.pricingModel) {
    return event.pricingModel;
  }

  const sessionPricingModel = modelBreakdown.length === 1 ? modelBreakdown[0].pricingModel : null;
  const parsedModel = event.model ?? modelFromEventDetail(event.detail);
  return matchPricingModel(parsedModel) ?? sessionPricingModel ?? pricingModelForModel(parsedModel);
}

function tokenCostEur(tokens: number, usdPerMillion: number, usdToEur: number): number {
  return (tokens / 1_000_000) * usdPerMillion * usdToEur;
}

function nearbyContextForEvent(event: TraceEvent, events: TraceEvent[]): { label: string; detail: string } {
  const prior = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.index < event.index &&
        candidate.detail &&
        candidate.type !== 'llm_request' &&
        candidate.type !== 'agent_response',
    );

  if (!prior) {
    return {
      label: 'No nearby context',
      detail: compactText(event.detail),
    };
  }

  return {
    label: readableEventType(prior.type),
    detail: compactText(prior.detail),
  };
}

function readableEventType(type: string): string {
  if (type === 'user_message') {
    return 'After user prompt';
  }

  if (type.includes('tool')) {
    return 'After tool event';
  }

  return `After ${type.replace(/_/g, ' ')}`;
}

function compactText(value: string, maxLength = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function tokenTotal(tokens: TokenBreakdown): number {
  return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
}

function sessionSize(tokens: number): SessionSize {
  if (tokens >= 600_000) {
    return 'Very large';
  }

  if (tokens >= 200_000) {
    return 'Large';
  }

  if (tokens >= 50_000) {
    return 'Medium';
  }

  return 'Small';
}

function contextGrowth(session: LedgerSession): number | null {
  return contextStats(session)?.growth ?? null;
}

function contextStats(session: LedgerSession): { firstAvg: number; lastAvg: number; growth: number; count: number } | null {
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

function sumTokens(rows: { tokens: TokenBreakdown }[], field: keyof TokenBreakdown): number {
  return rows.reduce((sum, row) => sum + row.tokens[field], 0);
}

function modelFromEventDetail(detail: string): string {
  return String(detail).split(':')[0]?.trim() ?? '';
}

function matchPricingModel(rawModel: string): string | null {
  const rawKey = modelKey(rawModel);
  if (!rawKey) {
    return null;
  }

  const pricingModel = pricingModelForModel(rawModel);
  return modelKey(pricingModel) === rawKey || rawKey.includes(modelKey(pricingModel)) ? pricingModel : null;
}
