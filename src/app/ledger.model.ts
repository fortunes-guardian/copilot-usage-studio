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

export interface LedgerTurn {
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
  outputTokens: number;
  ttftMs?: number;
  maxTokens?: number;
  hasReasoning?: boolean;
  totalTokens?: number;
  model?: string;
  rawModel?: string;
  pricingModel?: string;
  estimatedCost?: CostBreakdown;
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

export interface LedgerSession {
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
  advancedSignals?: AdvancedSignals;
  traceEvents: TraceEvent[];
  vscodeState?: VscodeStateEnrichment;
  turns: LedgerTurn[];
}

export interface LedgerData {
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
    warnings: string[];
  };
  sessions: LedgerSession[];
}
