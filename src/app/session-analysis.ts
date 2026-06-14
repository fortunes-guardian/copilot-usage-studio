import {
  CopilotSession,
  ModelBreakdown,
  ModelLimitSummary,
  TokenBreakdown,
  TraceEvent,
} from './session-data.model';
import {
  modelKey,
  modelUsesPricingFallback,
  priceForTokens,
  pricingModelForModel,
} from './pricing';
import { explainModelCost, sessionUsageUsd, traceEventUsageUsd } from './session-cost-utils';

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

export function buildCostExplanation(session: CopilotSession, sort: ModelCallSort) {
  const sessionCostUsd = sessionUsageUsd(session);
  const modelRows = session.modelBreakdown.map((entry) => explainModelCost(entry, sessionCostUsd));
  const categoryRows = explainCategoryCosts(modelRows);
  const modelCallRowList = modelCallRows(
    session.traceEvents,
    session.modelBreakdown,
    session.modelLimits ?? [],
    sessionCostUsd,
    sort,
  );
  const topTokenEventList = topTokenEvents(session.traceEvents, session.modelBreakdown);
  const costDrivers = explainCostDrivers(session, modelRows, topTokenEventList);
  const hasCacheData = session.tokens.cachedInput > 0 || session.tokens.cacheWrite > 0;
  const answer = costAnswer(session, modelRows, modelCallRowList);
  const turnInsightList = turnInsights(modelCallRowList);

  return {
    hasCacheData,
    modelRows,
    categoryRows,
    costAnswer: answer,
    costDrivers,
    modelCallRows: modelCallRowList,
    topTokenEvents: topTokenEventList,
    turnInsights: turnInsightList,
  };
}

export function sessionTriage(session: CopilotSession): SessionTriage {
  const totalTokens = sessionTotalTokens(session);
  const size = sessionSize(totalTokens);
  const warnings: SessionWarning[] = [];
  const maxInput = Math.max(
    ...session.traceEvents
      .filter((event) => event.type === 'llm_request')
      .map((event) => event.inputTokens),
    0,
  );

  const totalInputTokens =
    session.tokens.input + session.tokens.cachedInput + session.tokens.cacheWrite;

  if (totalInputTokens >= 150_000 || maxInput >= 100_000) {
    warnings.push({
      label: 'High input context',
      tone: 'high',
      help: 'Large prompt/context payloads are being sent into the model. This usually means repo context, prior conversation, or tool results are driving cost.',
    });
  }

  if (session.modelBreakdown.length > 1) {
    warnings.push({
      label: 'Mixed models',
      tone: 'medium',
      help: 'This run used more than one model. Cost is the sum of each model row, so model switches can make estimates harder to read at a glance.',
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
  return `${triage.size} session based on ${triage.totalTokens.toLocaleString()} imported tokens. Current thresholds: Small under 100k, Medium under 500k, Large under 1.5M, Very large at 1.5M or more.`;
}

export function flowTraceEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[]) {
  return events
    .filter((event) => isFlowEvent(event))
    .map((event, index) => {
      const pricingModel = pricingModelForEvent(event, modelBreakdown);
      const normalInputTokens = normalInputTokensForEvent(event);
      const price = priceForTokens(pricingModel, {
        input: normalInputTokens,
        cachedInput: event.cachedInputTokens ?? 0,
      });
      const estimatedUsd =
        traceEventUsageUsd(event) ??
        event.estimatedCost?.usd ??
        tokenCostUsd(normalInputTokens, price.input) +
          tokenCostUsd(event.cachedInputTokens ?? 0, price.cachedInput) +
          tokenCostUsd(event.cacheWriteTokens ?? 0, price.cacheWrite ?? 0) +
          tokenCostUsd(event.outputTokens, price.output);

      return {
        ...event,
        flowIndex: index + 1,
        totalTokens: eventTotalTokens(event),
        pricingModel,
        estimatedUsd,
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
    return (
      event.type.includes('tool') ||
      toolLikeEventNames().some((name) => event.name.toLowerCase().includes(name))
    );
  }

  if (filter === 'discovery') {
    return isSetupEvent(event);
  }

  if (filter === 'message') {
    return event.type === 'user_message';
  }

  if (filter === 'response') {
    return event.type === 'agent_response' || event.type === 'assistant.message';
  }

  return event.status !== 'ok' && event.status !== 'unknown';
}

export function traceEventDetails(event: TraceEvent, modelBreakdown: ModelBreakdown[]) {
  const pricingModel = pricingModelForEvent(event, modelBreakdown);
  const normalInputTokens = normalInputTokensForEvent(event);
  const price = priceForTokens(pricingModel, {
    input: normalInputTokens,
    cachedInput: event.cachedInputTokens ?? 0,
  });
  const inputUsd = tokenCostUsd(normalInputTokens, price.input);
  const cachedInputUsd = tokenCostUsd(event.cachedInputTokens ?? 0, price.cachedInput);
  const cacheWriteUsd = tokenCostUsd(event.cacheWriteTokens ?? 0, price.cacheWrite ?? 0);
  const outputUsd = tokenCostUsd(event.outputTokens, price.output);
  const estimatedUsd =
    traceEventUsageUsd(event) ??
    event.estimatedCost?.usd ??
    inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd;
  const totalTokens = eventTotalTokens(event);
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
          { label: 'Raw inputTokens', value: event.inputTokens.toLocaleString() },
          { label: 'Normal input tokens', value: normalInputTokens.toLocaleString() },
          ...(event.cachedInputTokens
            ? [{ label: 'Cached input tokens', value: event.cachedInputTokens.toLocaleString() }]
            : []),
          ...(event.cacheWriteTokens
            ? [{ label: 'Cache write tokens', value: event.cacheWriteTokens.toLocaleString() }]
            : []),
          { label: 'Output tokens', value: event.outputTokens.toLocaleString() },
          { label: 'Total tokens', value: totalTokens.toLocaleString() },
          { label: 'Pricing row', value: pricingModel },
          {
            label: 'Pricing tier',
            value: event.pricingTier ?? price.label ?? price.tierLabel ?? 'Default',
          },
          {
            label: event.sourceUsage ? 'GitHub usage' : 'Estimated cost',
            value: `$${estimatedUsd.toLocaleString(undefined, {
              minimumFractionDigits: 6,
              maximumFractionDigits: 6,
            })}`,
          },
          ...(event.sourceUsage
            ? [
                {
                  label: 'Source usage credits',
                  value: event.sourceUsage.credits.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 6,
                  }),
                },
              ]
            : []),
          ...(event.sourceEstimatedCost
            ? [{ label: 'Source estimatedCost', value: event.sourceEstimatedCost }]
            : []),
        ]
      : []),
    ...(event.ttftMs ? [{ label: 'TTFT', value: `${event.ttftMs.toLocaleString()} ms` }] : []),
    ...(event.maxTokens ? [{ label: 'Max tokens', value: event.maxTokens.toLocaleString() }] : []),
    ...(event.reasoningEffort ? [{ label: 'Reasoning effort', value: event.reasoningEffort }] : []),
    ...(event.hasReasoning
      ? [{ label: 'Reasoning text', value: 'Present in debug log payload' }]
      : []),
  ];

  return {
    normalizedFields,
    attributeFields: event.attributes ?? [],
    detail: event.detail || 'No detail text imported for this event.',
    hasCost: Boolean(event.inputTokens || event.outputTokens),
    inputUsd,
    outputUsd,
    estimatedUsd,
    totalTokens,
    pricingModel,
    usesFallbackPrice: modelUsesPricingFallback(rawModel, pricingModel),
  };
}

export const usesPricingFallback = modelUsesPricingFallback;

export function sessionTotalTokens(session: CopilotSession): number {
  return tokenTotal(session.tokens);
}

function explainCategoryCosts(modelRows: ModelCostRow[]) {
  return [
    {
      label: 'Normal input',
      tokens: sumTokens(modelRows, 'input'),
      usd: modelRows.reduce((sum, row) => sum + row.inputUsd, 0),
      description:
        'Non-cached prompt/context tokens priced at the normal input rate. Raw VS Code inputTokens can be higher when cachedTokens are present.',
    },
    {
      label: 'Output',
      tokens: sumTokens(modelRows, 'output'),
      usd: modelRows.reduce((sum, row) => sum + row.outputUsd, 0),
      description: 'Generated model response tokens.',
    },
    {
      label: 'Cached input',
      tokens: sumTokens(modelRows, 'cachedInput'),
      usd: modelRows.reduce((sum, row) => sum + row.cachedInputUsd, 0),
      description:
        'Prompt tokens served from provider cache when that billing signal is available.',
    },
    {
      label: 'Cache write',
      tokens: sumTokens(modelRows, 'cacheWrite'),
      usd: modelRows.reduce((sum, row) => sum + row.cacheWriteUsd, 0),
      description: 'Provider cache creation tokens. GitHub lists this mainly for Anthropic models.',
    },
  ];
}

function costAnswer(
  session: CopilotSession,
  modelRows: ModelCostRow[],
  modelCallRowList: ModelCallRow[],
) {
  const sessionCost = Math.max(sessionUsageUsd(session), 0);
  const totalTokens = sessionTotalTokens(session);
  const inputUsd = modelRows.reduce(
    (sum, row) => sum + row.inputUsd + row.cachedInputUsd + row.cacheWriteUsd,
    0,
  );
  const outputUsd = modelRows.reduce((sum, row) => sum + row.outputUsd, 0);
  const inputShare = sessionCost > 0 ? (inputUsd / sessionCost) * 100 : 0;
  const outputShare = sessionCost > 0 ? (outputUsd / sessionCost) * 100 : 0;
  const topModel = [...modelRows].sort((a, b) => b.totalUsd - a.totalUsd)[0] ?? null;
  const topModelShare = topModel && sessionCost > 0 ? (topModel.totalUsd / sessionCost) * 100 : 0;
  const topCall = [...modelCallRowList].sort((a, b) => b.estimatedUsd - a.estimatedUsd)[0] ?? null;
  const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedUsd / sessionCost) * 100 : 0;
  const category = inputShare >= outputShare ? 'Input/context' : 'Output';
  const categoryShare = Math.max(inputShare, outputShare);
  const costPer1k = totalTokens ? (sessionCost / totalTokens) * 1000 : 0;

  return {
    category,
    categoryShare,
    categoryDetail:
      category === 'Input/context'
        ? 'Most usage comes from tokens sent into the model: normal input, cached input, prior chat, repo context, and tool results.'
        : 'Most usage comes from generated model output. Inspect long responses or repeated generation.',
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
  const totalCost = modelCallRowList.reduce((sum, row) => sum + row.estimatedUsd, 0);
  const mostExpensive =
    [...modelCallRowList].sort((a, b) => b.estimatedUsd - a.estimatedUsd)[0] ?? null;
  const largestInput =
    [...modelCallRowList].sort((a, b) => b.inputTokens - a.inputTokens)[0] ?? null;
  const largestOutput =
    [...modelCallRowList].sort((a, b) => b.outputTokens - a.outputTokens)[0] ?? null;
  const averageCost = modelCallRowList.length ? totalCost / modelCallRowList.length : 0;

  return [
    {
      label: 'Model calls',
      value: modelCallRowList.length.toLocaleString(),
      detail: 'Token-bearing llm_request events imported from the VS Code debug log.',
    },
    {
      label: 'Most expensive call',
      value: mostExpensive
        ? `#${mostExpensive.callNumber} · $${mostExpensive.estimatedUsd.toFixed(4)}`
        : 'None',
      detail: mostExpensive
        ? `${mostExpensive.totalTokens.toLocaleString()} tokens, raw event #${mostExpensive.index}.`
        : 'No priced model call rows are available.',
    },
    {
      label: 'Largest raw input',
      value: largestInput
        ? `#${largestInput.callNumber} · ${largestInput.inputTokens.toLocaleString()}`
        : 'None',
      detail: largestInput
        ? 'This is the biggest raw inputTokens payload sent into the model before splitting normal and cached input.'
        : 'No input token totals were imported.',
    },
    {
      label: 'Largest output',
      value: largestOutput
        ? `#${largestOutput.callNumber} · ${largestOutput.outputTokens.toLocaleString()}`
        : 'None',
      detail: largestOutput
        ? 'This is the largest generated response in the imported model calls.'
        : 'No output token totals were imported.',
    },
    {
      label: 'Avg cost / call',
      value: `$${averageCost.toFixed(4)}`,
      detail: 'Useful for spotting whether cost came from one spike or many steady calls.',
    },
  ];
}

function explainCostDrivers(
  session: CopilotSession,
  modelRows: ModelCostRow[],
  topTokenEventList: TopTokenEvent[],
) {
  const inputUsd = modelRows.reduce(
    (sum, row) => sum + row.inputUsd + row.cachedInputUsd + row.cacheWriteUsd,
    0,
  );
  const outputUsd = modelRows.reduce((sum, row) => sum + row.outputUsd, 0);
  const sessionCost = Math.max(sessionUsageUsd(session), 0);
  const inputShare = sessionCost > 0 ? (inputUsd / sessionCost) * 100 : 0;
  const outputShare = sessionCost > 0 ? (outputUsd / sessionCost) * 100 : 0;
  const normalInputUsd = modelRows.reduce((sum, row) => sum + row.inputUsd, 0);
  const cachedInputUsd = modelRows.reduce((sum, row) => sum + row.cachedInputUsd, 0);
  const cacheWriteUsd = modelRows.reduce((sum, row) => sum + row.cacheWriteUsd, 0);
  const topCall = topTokenEventList[0];
  const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedUsd / sessionCost) * 100 : 0;
  const topModel = [...modelRows].sort((a, b) => b.totalUsd - a.totalUsd)[0];
  const topModelShare = topModel && sessionCost > 0 ? (topModel.totalUsd / sessionCost) * 100 : 0;
  const toolCalls = session.traceSummary.toolCalls;
  const toolsPerTurn =
    session.traceSummary.modelTurns > 0 ? toolCalls / session.traceSummary.modelTurns : 0;
  const mixedModelCount = modelRows.length;

  return [
    {
      title: 'Input-side spend',
      value: `$${inputUsd.toFixed(4)}`,
      detail:
        inputShare >= outputShare
          ? `${inputShare.toFixed(0)}% of the $${sessionCost.toFixed(4)} run usage. Split: $${normalInputUsd.toFixed(
              4,
            )} normal input, $${cachedInputUsd.toFixed(4)} cached input${
              cacheWriteUsd ? `, $${cacheWriteUsd.toFixed(4)} cache write` : ''
            }.`
          : `Input/cache contributes ${inputShare.toFixed(0)}% of the $${sessionCost.toFixed(4)} run usage. Output is larger here.`,
      tone: inputShare >= 75 ? 'high' : inputShare >= 50 ? 'medium' : 'low',
    },
    {
      title: 'Largest model call',
      value: topCall ? `$${topCall.estimatedUsd.toFixed(4)}` : 'None',
      detail: topCall
        ? `Raw event index #${topCall.index} used ${topCall.totalTokens.toLocaleString()} tokens and accounts for about ${topCallShare.toFixed(0)}% of this run.`
        : 'No token-bearing model calls were imported for this session.',
      tone: topCallShare >= 25 ? 'high' : topCallShare >= 10 ? 'medium' : 'low',
    },
    {
      title: 'Model mix',
      value:
        mixedModelCount === 1 ? (topModel?.model ?? session.model) : `${mixedModelCount} models`,
      detail: topModel
        ? `${topModel.model} contributes about ${topModelShare.toFixed(0)}% of usage using the ${topModel.pricingModel} price row.`
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

function topTokenEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[]) {
  return pricedModelCallEvents(events, modelBreakdown)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 5);
}

function modelCallRows(
  events: TraceEvent[],
  modelBreakdown: ModelBreakdown[],
  modelLimits: ModelLimitSummary[],
  sessionCostUsd: number,
  sort: ModelCallSort,
) {
  const cumulativeRawInputByModel = new Map<string, number>();
  let previousModelEventIndex = -1;
  const rows = pricedModelCallEvents(events, modelBreakdown).map((event, index) => {
    const context = nearbyContextForEvent(event, events);
    const userRequest = userRequestBeforeModelCall(event, events, previousModelEventIndex);
    const modelLimit = modelLimitForEvent(event, modelLimits);
    const cumulativeKey = modelLimitKey(modelLimit, event);
    const cumulativeRawInputTokens =
      (cumulativeRawInputByModel.get(cumulativeKey) ?? 0) + event.inputTokens;
    cumulativeRawInputByModel.set(cumulativeKey, cumulativeRawInputTokens);
    const promptLimitTokens = positiveNumber(modelLimit?.promptLimitTokens);
    const contextWindowTokens = positiveNumber(modelLimit?.contextWindowTokens);
    previousModelEventIndex = event.index;

    return {
      ...event,
      callNumber: index + 1,
      share: sessionCostUsd > 0 ? (event.estimatedUsd / sessionCostUsd) * 100 : 0,
      contextLabel: context.label,
      contextDetail: context.detail,
      startsAfterUserRequest: Boolean(userRequest),
      userRequestIndex: userRequest?.index ?? null,
      userRequestDetail: userRequest ? compactText(userRequest.detail, 110) : null,
      promptLimitTokens,
      contextWindowTokens,
      promptLimitShare: promptLimitTokens ? event.inputTokens / promptLimitTokens : null,
      contextWindowShare: contextWindowTokens ? event.inputTokens / contextWindowTokens : null,
      cumulativeRawInputTokens,
      repeatedInputFactorAtCall:
        event.inputTokens > 0 ? cumulativeRawInputTokens / event.inputTokens : 0,
    };
  });

  return sort === 'largest'
    ? [...rows].sort((a, b) => b.estimatedUsd - a.estimatedUsd || b.totalTokens - a.totalTokens)
    : rows;
}

export function isSetupEvent(event: TraceEvent): boolean {
  const category =
    event.attributes?.find((field) => field.label === 'category')?.value.toLowerCase() ?? '';
  const name = event.name.toLowerCase();
  const detail = event.detail.toLowerCase();

  return (
    event.type === 'discovery' ||
    name.includes('discovery') ||
    name.includes('customization') ||
    category === 'customization' ||
    detail.startsWith('resolved ')
  );
}

function userRequestBeforeModelCall(
  event: TraceEvent,
  events: TraceEvent[],
  previousModelEventIndex: number,
): TraceEvent | null {
  return (
    [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === 'user_message' &&
          candidate.index > previousModelEventIndex &&
          candidate.index < event.index,
      ) ?? null
  );
}

function modelLimitForEvent(
  event: TraceEvent,
  modelLimits: ModelLimitSummary[],
): ModelLimitSummary | null {
  if (!modelLimits.length) {
    return null;
  }

  const rawModel = event.rawModel || event.model || modelFromEventDetail(event.detail);
  const rawKey = modelKey(rawModel);
  if (!rawKey) {
    return modelLimits.length === 1 ? modelLimits[0] : null;
  }

  return (
    modelLimits.find((limit) => {
      const candidates = [limit.model, limit.modelId, ...limit.rawModels]
        .map((name) => modelKey(name))
        .filter(Boolean);
      return candidates.some(
        (candidate) =>
          candidate === rawKey || rawKey.includes(candidate) || candidate.includes(rawKey),
      );
    }) ?? (modelLimits.length === 1 ? modelLimits[0] : null)
  );
}

function modelLimitKey(modelLimit: ModelLimitSummary | null, event: TraceEvent): string {
  return (
    modelKey(modelLimit?.modelId ?? '') ||
    modelKey(modelLimit?.model ?? '') ||
    modelKey(event.rawModel ?? '') ||
    modelKey(event.model ?? '') ||
    modelKey(event.pricingModel ?? '') ||
    'unknown'
  );
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

function pricedModelCallEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[]) {
  return events
    .filter((event) => event.inputTokens || event.outputTokens)
    .map((event) => {
      const pricingModel = pricingModelForEvent(event, modelBreakdown);
      const normalInputTokens = normalInputTokensForEvent(event);
      const price = priceForTokens(pricingModel, {
        input: normalInputTokens,
        cachedInput: event.cachedInputTokens ?? 0,
      });
      const inputUsd = tokenCostUsd(normalInputTokens, price.input);
      const cachedInputUsd = tokenCostUsd(event.cachedInputTokens ?? 0, price.cachedInput);
      const cacheWriteUsd = tokenCostUsd(event.cacheWriteTokens ?? 0, price.cacheWrite ?? 0);
      const outputUsd = tokenCostUsd(event.outputTokens, price.output);
      const estimatedUsd =
        traceEventUsageUsd(event) ??
        event.estimatedCost?.usd ??
        inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd;

      return {
        ...event,
        totalTokens: eventTotalTokens(event),
        pricingModel,
        usesFallbackPrice: modelUsesPricingFallback(
          event.model || modelFromEventDetail(event.detail),
          pricingModel,
        ),
        inputUsd,
        cachedInputUsd,
        cacheWriteUsd,
        outputUsd,
        estimatedUsd,
      };
    });
}

function eventTotalTokens(event: TraceEvent): number {
  return (
    event.totalTokens ?? event.inputTokens + event.outputTokens + (event.cacheWriteTokens ?? 0)
  );
}

function normalInputTokensForEvent(event: TraceEvent): number {
  return Math.max(0, event.inputTokens - (event.cachedInputTokens ?? 0));
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
  return [
    'read_file',
    'list_dir',
    'grep_search',
    'semantic_search',
    'fetch_webpage',
    'apply_patch',
    'run_in_terminal',
  ];
}

function pricingModelForEvent(event: TraceEvent, modelBreakdown: ModelBreakdown[]): string {
  if (event.pricingModel) {
    return event.pricingModel;
  }

  const sessionPricingModel = modelBreakdown.length === 1 ? modelBreakdown[0].pricingModel : null;
  const parsedModel = event.model ?? modelFromEventDetail(event.detail);
  return matchPricingModel(parsedModel) ?? sessionPricingModel ?? pricingModelForModel(parsedModel);
}

function tokenCostUsd(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion;
}

function nearbyContextForEvent(
  event: TraceEvent,
  events: TraceEvent[],
): { label: string; detail: string } {
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
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function tokenTotal(tokens: TokenBreakdown): number {
  return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
}

function sessionSize(tokens: number): SessionSize {
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
  return modelKey(pricingModel) === rawKey || rawKey.includes(modelKey(pricingModel))
    ? pricingModel
    : null;
}
