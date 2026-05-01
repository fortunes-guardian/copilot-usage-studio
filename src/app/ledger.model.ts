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
}

export interface TraceEvent {
  index: number;
  timestamp: string;
  type: string;
  name: string;
  status: string;
  detail: string;
  inputTokens: number;
  outputTokens: number;
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
  startedAt: string;
  endedAt: string;
  tags: string[];
  toolsUsed: string[];
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  confidence: EstimateConfidence;
  traceSummary: TraceSummary;
  traceEvents: TraceEvent[];
  turns: LedgerTurn[];
}

export interface LedgerData {
  schemaVersion: number;
  generatedAt: string;
  pricingVersion: string;
  usdToEur: number;
  ingestion?: {
    scannedRoots: string[];
    scannedWorkspaces: number;
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
