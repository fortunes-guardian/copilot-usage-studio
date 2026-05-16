import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CopilotSession } from './session-data.model';
import { SessionOverviewComponent } from './session-overview.component';

describe('SessionOverviewComponent', () => {
  let fixture: ComponentFixture<SessionOverviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionOverviewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionOverviewComponent);
  });

  it('shows source-backed reasoning effort when VS Code logged it', () => {
    fixture.componentRef.setInput('session', sessionFixture({
      traceSummary: {
        modelTurns: 2,
        toolCalls: 1,
        errors: 0,
        totalEvents: 8,
        totalTokens: 12_000,
        reasoningEfforts: [{ effort: 'high', count: 2 }],
      },
    }));

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Reasoning');
    expect(fixture.nativeElement.textContent).toContain('high x2');
  });

  it('keeps reasoning hidden when no request effort was imported', () => {
    fixture.componentRef.setInput('session', sessionFixture());

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Reasoning');
  });
});

function sessionFixture(overrides: Partial<CopilotSession> = {}): CopilotSession {
  return {
    id: 'session-1',
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: 'Test session',
    firstPrompt: 'Test session',
    workspace: 'workspace',
    sourcePath: 'debug-logs/session-1',
    model: 'GPT-5.4',
    modelBreakdown: [],
    startedAt: '2026-05-01T12:00:00.000Z',
    endedAt: '2026-05-01T12:05:00.000Z',
    tags: ['debug-log'],
    toolsUsed: [],
    tokens: { input: 10_000, cachedInput: 0, cacheWrite: 0, output: 1_000 },
    cost: { usd: 0.01, eur: 0.01 },
    confidence: 'exact',
    traceSummary: {
      modelTurns: 1,
      toolCalls: 0,
      errors: 0,
      totalEvents: 3,
      totalTokens: 11_000,
      reasoningEfforts: [],
    },
    traceEvents: [],
    turns: [],
    ...overrides,
  };
}
