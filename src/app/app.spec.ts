import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  const ledgerFixture = {
    schemaVersion: 1,
    generatedAt: '2026-05-01T13:44:12.977Z',
    pricingVersion: 'github-copilot-usage-pricing-2026-06-01',
    usdToEur: 0.93,
    ingestion: {
      scannedRoots: [],
      scannedWorkspaces: 1,
      scannedStateDbs: 1,
      enrichedFromStateDbs: 1,
      importedDebugLogSessions: 1,
      importedChatSnapshotSessions: 0,
      skippedEmptyDebugLogs: 1,
      skippedChatSnapshotsWithoutRequests: 0,
      skippedDuplicateChatSnapshots: 0,
      importedSessions: 1,
      warnings: [],
    },
    sessions: [
      {
        id: 'session-1',
        sourceKind: 'vscode-copilot-debug-log',
        tokenSource: 'llm_request_token_totals',
        sessionType: 'Local',
        location: 'Chat Panel',
        status: 'Idle',
        title: 'test',
        firstPrompt: 'test',
        workspace: 'copilot-cost-ledger',
        sourcePath: 'debug-logs/session-1',
        model: 'Claude Sonnet 4.6',
        modelBreakdown: [
          {
            model: 'Claude Sonnet 4.6',
            rawModels: ['claude-sonnet-4.6'],
            turns: 1,
            tokens: { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 },
            cost: { usd: 0.00045, eur: 0.0004185 },
            pricingModel: 'Claude Sonnet 4.6',
          },
        ],
        startedAt: '2026-05-01T13:28:17.497Z',
        endedAt: '2026-05-01T13:29:32.374Z',
        tags: ['debug-log', 'llm-request-token-totals'],
        toolsUsed: [],
        tokens: { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 },
        cost: { usd: 0.00045, eur: 0.0004185 },
        confidence: 'exact',
        traceSummary: {
          modelTurns: 1,
          toolCalls: 0,
          totalTokens: 110,
          errors: 0,
          totalEvents: 3,
        },
        traceEvents: [
          {
            index: 0,
            timestamp: '2026-05-01T13:28:17.497Z',
            type: 'user_message',
            name: 'user_message',
            status: 'ok',
            detail: 'test',
            inputTokens: 0,
            outputTokens: 0,
          },
        ],
        vscodeState: {
          sourcePath: 'state.vscdb',
          keys: ['chat.ChatSessionStore.index'],
          title: 'Testing chatbot response functionality',
          label: 'Testing chatbot response functionality',
          resource: 'vscode-chat-session://local/session-1',
          initialLocation: 'panel',
          permissionLevel: 'default',
          hasPendingEdits: false,
          isExternal: false,
          lastResponseState: 1,
          readAt: '2026-05-01T13:29:32.374Z',
          createdAt: '2026-05-01T13:28:17.497Z',
          lastActivityAt: '2026-05-01T13:29:32.374Z',
        },
        turns: [{ role: 'user', text: 'test', tokens: 1 }],
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController).expectOne('/data/sessions.json').flush(ledgerFixture);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController).expectOne('/data/sessions.json').flush(ledgerFixture);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Copilot Cost Ledger');
    expect(compiled.textContent).toContain('1 imported from 1 workspaces');
  });
});
