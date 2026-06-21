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
  costBreakdown?: {
    inputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
  };
  pricingTiers?: string[];
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

export interface TranscriptAvailability {
  available: boolean;
  sourcePath: string;
  eventCount: number;
}

export interface DebugLogRuntime {
  logVersion: number;
  vscodeVersion: string;
  copilotVersion: string;
}

export interface SourceUsage {
  nanoAiu: number;
  credits: number;
  usd: number;
  modelCalls: number;
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
  requestShape?: ModelCallRequestShape;
  totalTokens?: number;
  model?: string;
  rawModel?: string;
  pricingModel?: string;
  pricingTier?: string;
  estimatedCost?: CostBreakdown;
  sourceEstimatedCost?: string;
  sourceUsage?: SourceUsage;
  setupPayload?: ModelCallSetupPayload;
}

export interface ModelCallRequestShape {
  api: string;
  inputItemCount: number;
  inputItemTypes: string[];
  hasPreviousResponseId: boolean;
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

export interface ModelCallSetupPayload {
  systemPromptFile: string;
  systemPromptChars: number;
  toolsFile: string;
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
}

export interface ModelLimitSummary {
  model: string;
  rawModels: string[];
  modelId: string;
  vendor: string;
  tokenizer: string;
  contextWindowTokens: number;
  promptLimitTokens: number;
  outputLimitTokens: number;
  supportedReasoningEfforts: string[];
  supportedEndpoints: string[];
  modelPickerEnabled: boolean;
  isChatDefault: boolean;
  isChatFallback: boolean;
  modelCalls: number;
  largestRawInputTokens: number;
  totalRawInputTokens: number;
  largestOutputTokens: number;
  promptLimitShare: number | null;
  contextWindowShare: number | null;
  repeatedInputFactor: number;
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
  sourceUsage?: SourceUsage;
  transcript?: TranscriptAvailability;
  debugLogRuntime?: DebugLogRuntime;
  advancedSignals?: AdvancedSignals;
  requestPayload?: RequestPayloadSummary;
  modelLimits?: ModelLimitSummary[];
  memoryRecalls?: MemoryRecall[];
  traceEvents: TraceEvent[];
  vscodeState?: VscodeStateEnrichment;
  turns: SessionTurn[];
}

export type CopilotMemoryKind = 'memory' | 'plan';
export type CopilotMemoryScope = 'global' | 'repository' | 'session' | 'workspace';

export interface MemoryRecallModelCall {
  number: number;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface MemoryRecall {
  id: string;
  sessionId: string;
  workspace: string;
  virtualPath: string;
  timestamp: string;
  sourceLog: string;
  returnedCharacterCount: number;
  followingModelCall?: MemoryRecallModelCall;
}

export interface CopilotMemory {
  id: string;
  kind: CopilotMemoryKind;
  scope: CopilotMemoryScope;
  title: string;
  excerpt: string;
  content: string;
  workspace: string;
  sessionId: string;
  sourcePath: string;
  relativePath: string;
  createdAt: string;
  modifiedAt: string;
  sizeBytes: number;
  characterCount: number;
  lineCount: number;
  recalls?: MemoryRecall[];
}

export type CopilotCustomizationKind = 'instruction' | 'skill' | 'prompt' | 'hook' | 'agent' | 'other';
export type CopilotCustomizationEvidenceStatus = 'sent' | 'listed' | 'discovered' | 'not_seen';

export interface CopilotCustomizationMatch {
  status: CopilotCustomizationEvidenceStatus;
  sessionId: string;
  workspace: string;
  timestamp: string;
  eventIndex: number;
  modelCallNumber: number;
  source: string;
  matchedChunks: number;
  matchedCharacters: number;
}

export interface CopilotCustomization {
  id: string;
  kind: CopilotCustomizationKind;
  title: string;
  name: string;
  description: string;
  applyTo: string[];
  triggers: string[];
  scope: string;
  workspace: string;
  sourcePath: string;
  relativePath: string;
  createdAt: string;
  modifiedAt: string;
  sizeBytes: number;
  characterCount: number;
  lineCount: number;
  excerpt: string;
  evidenceStatus: CopilotCustomizationEvidenceStatus;
  matches: CopilotCustomizationMatch[];
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
    debugLogSessionsWithTranscripts?: number;
    transcriptEventsAvailable?: number;
    scannedMemoryRoots?: number;
    importedMemories?: number;
    importedPlans?: number;
    scannedCustomizationRoots?: number;
    scannedCustomizationLocations?: Array<{ kind: string; path: string }>;
    importedCustomizations?: number;
    customizationEvidenceScannedSessions?: number;
    customizationEvidenceModelCalls?: number;
    customizationEvidenceTextParts?: number;
    customizationEvidenceMatchedCustomizations?: number;
    skippedOversizedMemories?: number;
    skippedUnreadableMemories?: number;
    skippedOversizedCustomizations?: number;
    skippedUnreadableCustomizations?: number;
    skippedEmptyDebugLogs: number;
    skippedChatSnapshotsWithoutRequests: number;
    skippedDuplicateChatSnapshots: number;
    importedSessions: number;
    cacheTokenAudit?: CacheTokenAudit;
    warnings: string[];
  };
  memories?: CopilotMemory[];
  customizations?: CopilotCustomization[];
  sessions: CopilotSession[];
}
