export type EstimateConfidence = 'sample' | 'estimated' | 'reconciled' | 'exact';

export interface TokenBreakdown {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export interface CostBreakdown {
  usd: number;
  eur: number;
}

export interface ModelBreakdown {
  model: string;
  rawModels: string[];
  turns: number;
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  pricingModel: string;
}

export interface VscodeStateEnrichment {
  sourcePath: string;
  keys: string[];
  title: string;
  label: string;
  resource: string;
  initialLocation: string;
  permissionLevel: string;
  hasPendingEdits: boolean;
  isExternal: boolean;
  lastResponseState: number;
  readAt: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface SessionTurn {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  tokens: number;
}

export interface TraceSummary {
  modelTurns: number;
  toolCalls: number;
  totalTokens: number;
  errors: number;
  totalEvents: number;
  reasoningEvents?: number;
  maxInputTokens?: number;
  maxRequestTokens?: number;
  reasoningEfforts?: Array<{ effort: string; count: number }>;
}

export interface CacheTokenAudit {
  modelCalls: number;
  callsWithCachedTokens: number;
  invalidCachedTokenSplits: number;
  rawInputTokens: number;
  normalInputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  maxCachedInputShare: number;
}

export interface TraceEvent {
  index: number;
  timestamp: string;
  type: string;
  name: string;
  status: string;
  detail: string;
  attributes?: Array<{ label: string; value: string }>;
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  ttftMs?: number;
  maxTokens?: number;
  hasReasoning?: boolean;
  reasoningEffort?: string;
  totalTokens?: number;
  model?: string;
  rawModel?: string;
  pricingModel?: string;
  estimatedCost?: CostBreakdown;
  sourceEstimatedCost?: string;
}

export interface AdvancedSignals {
  reasoning: {
    visible: boolean;
    level: string;
    events: number;
    source: string;
    help: string;
  };
  context: {
    maxInputTokens: number;
    maxRequestTokens: number;
    outputCaps: number[];
    requestCapShare: number | null;
    source: string;
    help: string;
  };
}

export interface RequestPayloadSummary {
  systemPromptFiles: number;
  systemPromptChars: number;
  toolSchemaFiles: number;
  toolSchemaChars: number;
  toolCount: number;
  mcpToolCount: number;
  mcpToolNames: string[];
  largestToolSchemas: Array<{
    name: string;
    descriptionChars: number;
    parameterChars: number;
    totalChars: number;
  }>;
  modelCallsWithSystemPromptFile: number;
  modelCallsWithToolsFile: number;
  reasoningEfforts: Array<{ effort: string; count: number }>;
  toolResultCharsByName: Array<{
    name: string;
    calls: number;
    argsChars: number;
    resultChars: number;
  }>;
  subagentLogCount: number;
}

export interface CopilotSession {
  id: string;
  sourceKind: string;
  tokenSource: string;
  sessionType: string;
  location: string;
  status: string;
  title: string;
  firstPrompt: string;
  workspace: string;
  sourcePath: string;
  model: string;
  modelBreakdown: ModelBreakdown[];
  startedAt: string;
  endedAt: string;
  tags: string[];
  toolsUsed: string[];
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  confidence: EstimateConfidence;
  traceSummary: TraceSummary;
  cacheTokenAudit?: CacheTokenAudit;
  advancedSignals?: AdvancedSignals;
  requestPayload?: RequestPayloadSummary;
  traceEvents: TraceEvent[];
  vscodeState?: VscodeStateEnrichment;
  turns: SessionTurn[];
}

export interface SessionData {
  schemaVersion: number;
  generatedAt: string;
  pricingVersion: string;
  pricingSourceUrl?: string;
  usdToEur: number;
  ingestion?: {
    scannedRoots: string[];
    scannedWorkspaces: number;
    scannedStateDbs: number;
    enrichedFromStateDbs: number;
    importedDebugLogSessions: number;
    importedChatSnapshotSessions: number;
    skippedEmptyDebugLogs: number;
    skippedChatSnapshotsWithoutRequests: number;
    skippedDuplicateChatSnapshots: number;
    importedSessions: number;
    cacheTokenAudit?: CacheTokenAudit;
    warnings: string[];
  };
  sessions: CopilotSession[];
}


