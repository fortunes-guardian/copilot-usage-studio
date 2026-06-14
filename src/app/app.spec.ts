import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  const sessionDataFixture = {
    schemaVersion: 1,
    generatedAt: '2026-05-01T13:44:12.977Z',
    pricingVersion: 'github-copilot-usage-pricing-2026-06-14',
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
        workspace: 'copilot-usage-studio',
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
          {
            index: 1,
            timestamp: '2026-05-01T13:28:20.000Z',
            type: 'llm_request',
            name: 'panel/editAgent',
            status: 'ok',
            detail: 'Claude Sonnet 4.6: 100 in / 10 out',
            model: 'Claude Sonnet 4.6',
            pricingModel: 'Claude Sonnet 4.6',
            inputTokens: 100,
            outputTokens: 10,
            estimatedCost: { usd: 0.00045, eur: 0.0004185 },
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
    globalThis.history.pushState(null, '', '/');
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Copilot Usage Studio');
    expect(compiled.textContent).toContain('Loading usage');
    expect(compiled.textContent).not.toContain('Triage');
    expect(compiled.textContent).not.toContain('Token totals');
    expect(compiled.textContent).toContain('Usage');
    expect(compiled.textContent).toContain('Light');
  });

  it('opens the Usage page route from top navigation', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();

    clickButtonContaining(fixture.nativeElement, 'Usage');
    fixture.detectChanges();
    const activeButton = [...fixture.nativeElement.querySelectorAll('.view-nav button')].find(
      (candidate: HTMLButtonElement) => candidate.textContent?.includes('Usage'),
    );

    expect(activeButton?.classList.contains('active')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Loading usage');
  });

  it('opens Usage from the view query parameter', async () => {
    globalThis.history.pushState(null, '', '/?view=usage');
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const activeButton = [...fixture.nativeElement.querySelectorAll('.view-nav button')].find(
      (candidate: HTMLButtonElement) => candidate.textContent?.includes('Usage'),
    );

    expect(activeButton?.classList.contains('active')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Loading usage');
  });

  it('refreshes local VS Code session data through the runtime', async () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/data/sessions.json').flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();

    clickButtonContaining(fixture.nativeElement, 'Refresh');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Scanning');

    const refreshedData = {
      ...sessionDataFixture,
      generatedAt: '2026-06-13T09:30:00.000Z',
      sessions: [
        ...sessionDataFixture.sessions,
        { ...sessionDataFixture.sessions[0], id: 'session-2', title: 'new session' },
      ],
    };
    const request = http.expectOne('/api/scan');
    expect(request.request.method).toBe('POST');
    request.flush({ sessionData: refreshedData });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('2 sessions imported');
  });

  it('opens Sessions from the view query parameter', async () => {
    globalThis.history.pushState(null, '', '/?view=sessions');
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const activeButton = [...fixture.nativeElement.querySelectorAll('.view-nav button')].find(
      (candidate: HTMLButtonElement) => candidate.textContent?.includes('Sessions'),
    );

    expect(activeButton?.classList.contains('active')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Browse sessions');
  });

  it('navigates the selected-run debugger tabs', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();

    clickButtonContaining(fixture.nativeElement, 'Sessions');
    fixture.detectChanges();
    clickButtonContaining(fixture.nativeElement, 'Cost');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cost answer');
    expect(fixture.nativeElement.textContent).toContain('Priced buckets');

    clickButtonContaining(fixture.nativeElement, 'Calls');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Model call timeline');

    clickButtonContaining(fixture.nativeElement, 'Trace');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Inspect the source event');
  });

  it('opens the matching trace event from a model call', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/data/sessions.json')
      .flush(sessionDataFixture);
    await fixture.whenStable();
    fixture.detectChanges();

    clickButtonContaining(fixture.nativeElement, 'Sessions');
    fixture.detectChanges();
    clickButtonContaining(fixture.nativeElement, 'Calls');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.trace-link') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Opened from Calls');
    expect(fixture.nativeElement.textContent).toContain('#1');
    expect(fixture.nativeElement.textContent).toContain('panel/editAgent');
  });
});

function clickButtonContaining(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );

  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
