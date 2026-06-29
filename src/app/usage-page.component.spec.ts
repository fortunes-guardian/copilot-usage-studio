import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CopilotSession } from './session-data.model';
import { UsagePageComponent } from './usage-page.component';

describe('UsagePageComponent', () => {
  let fixture: ComponentFixture<UsagePageComponent>;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

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

    expect(text).toContain('Your Copilot usage');
    expect(text).toContain('Last session');
    expect(text).toContain('Today');
    expect(text).toContain('This week');
    expect(text).toContain('Calendar month');
    expect(text).toContain('Selected scope');
    expect(text).toContain('50 credits');
    expect(text).toContain('Open top run');
    expect(text).toContain('Open run');
  });

  it('shows when a usage card has no run to open', () => {
    fixture.componentRef.setInput('sessions', []);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('No run to open');
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

  it('scopes usage by workspace', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('one', 'One', new Date().toISOString(), 0.01),
      { ...sessionFixture('two', 'Two', new Date().toISOString(), 0.02), workspace: 'other-workspace' },
    ]);
    fixture.detectChanges();

    const workspace = fixture.nativeElement.querySelectorAll('select')[0] as HTMLSelectElement;
    workspace.value = 'other-workspace';
    workspace.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1 of 2 sessions');
    expect(fixture.nativeElement.textContent).toContain('Reset scope');
  });

  it('groups recent-day usage by local calendar day with source usage first', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('jun-5-a', 'June 5 A', '2026-06-05T08:00:00.000Z', 0.01, 0.2),
      sessionFixture('jun-5-b', 'June 5 B', '2026-06-05T20:00:00.000Z', 0.03),
      sessionFixture('jun-4', 'June 4', '2026-06-04T12:00:00.000Z', 0.04, 0.1),
      sessionFixture('outside-window', 'Outside window', '2026-05-01T12:00:00.000Z', 0.99, 1.23),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Last 14 local calendar days');
    expect(text).toContain('Fri, Jun 5');
    expect(text).toContain('23 credits');
    expect(text).toContain('2 sessions · $0.23');
    expect(text).toContain('1 fallback');
    expect(text).toContain('Thu, Jun 4');
    expect(text).toContain('10 credits');
    expect(text).not.toContain('Outside window');
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
    workspace: 'copilot-usage-studio',
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
