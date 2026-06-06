import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CopilotSession } from './session-data.model';
import { UsagePageComponent } from './usage-page.component';

describe('UsagePageComponent', () => {
  let fixture: ComponentFixture<UsagePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsagePageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UsagePageComponent);
  });

  it('answers the key usage windows in credits', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('old-run', 'Old run', '2026-05-01T12:00:00.000Z', 0.01),
      sessionFixture('today-run', 'Today run', new Date().toISOString(), 0.25, 0.5),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('How much did I use?');
    expect(text).toContain('Last session');
    expect(text).toContain('Today');
    expect(text).toContain('This week');
    expect(text).toContain('Calendar month');
    expect(text).toContain('Visible total');
    expect(text).toContain('50 credits');
  });

  it('opens the most relevant run from a usage card', () => {
    const opened: CopilotSession[] = [];
    fixture.componentRef.setInput('sessions', [
      sessionFixture('old-run', 'Old run', '2026-05-01T12:00:00.000Z', 0.01),
      sessionFixture('today-run', 'Today run', new Date().toISOString(), 0.25, 0.5),
    ]);
    fixture.componentInstance.openSession.subscribe((session) => opened.push(session));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.usage-answer-card') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(opened[0].id).toBe('today-run');
  });
});

function sessionFixture(
  id: string,
  title: string,
  startedAt: string,
  usd: number,
  sourceUsageUsd?: number,
): CopilotSession {
  return {
    id,
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title,
    firstPrompt: title,
    workspace: 'copilot-cost-debugger',
    sourcePath: `debug-logs/${id}`,
    model: 'GPT-5.4',
    modelBreakdown: [
      {
        model: 'GPT-5.4',
        rawModels: ['gpt-5.4'],
        pricingModel: 'GPT-5.4',
        turns: 1,
        tokens: { input: 1_000, cachedInput: 0, cacheWrite: 0, output: 100 },
        cost: { usd, eur: usd },
      },
    ],
    startedAt,
    endedAt: startedAt,
    tags: ['debug-log'],
    toolsUsed: [],
    tokens: { input: 1_000, cachedInput: 0, cacheWrite: 0, output: 100 },
    cost: { usd, eur: usd },
    sourceUsage:
      sourceUsageUsd === undefined
        ? undefined
        : {
            nanoAiu: sourceUsageUsd * 100_000_000_000,
            credits: sourceUsageUsd / 0.01,
            usd: sourceUsageUsd,
            modelCalls: 1,
          },
    confidence: 'exact',
    traceSummary: {
      modelTurns: 1,
      toolCalls: 0,
      totalTokens: 1_100,
      errors: 0,
      totalEvents: 1,
    },
    traceEvents: [],
    turns: [{ role: 'user', text: title, tokens: 2 }],
  };
}
