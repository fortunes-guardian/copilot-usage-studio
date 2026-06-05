import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnalyticsPageComponent } from './analytics-page.component';
import { CopilotSession } from './session-data.model';

describe('AnalyticsPageComponent', () => {
  let fixture: ComponentFixture<AnalyticsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsPageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticsPageComponent);
  });

  it('opens runs from the analytics action cards', () => {
    const opened: CopilotSession[] = [];

    fixture.componentRef.setInput('sessions', [
      sessionFixture('small-run', 'Small run', 0.01, 10_000),
      sessionFixture('expensive-run', 'Expensive run', 1.25, 900_000),
    ]);
    fixture.componentRef.setInput('totalSessionCount', 2);
    fixture.componentInstance.openSession.subscribe((session) => opened.push(session));
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.highlight-list button');
    buttons[0].click();
    fixture.detectChanges();

    expect(opened[0].id).toBe('expensive-run');
    expect(fixture.nativeElement.textContent).toContain('Open run');
  });

  it('shows the usage-now credit windows', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('small-run', 'Small run', 0.01, 10_000),
      sessionFixture('expensive-run', 'Expensive run', 1.25, 900_000),
    ]);
    fixture.componentRef.setInput('totalSessionCount', 2);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Usage now');
    expect(text).toContain('Last session');
    expect(text).toContain('Today');
    expect(text).toContain('This week');
    expect(text).toContain('Calendar month');
    expect(text).toContain('Visible total');
  });

  it('shows a resettable empty state when analytics controls exclude visible sessions', () => {
    fixture.componentRef.setInput('sessions', [sessionFixture('small-run', 'Small run', 0.01, 10_000)]);
    fixture.componentRef.setInput('totalSessionCount', 1);
    fixture.detectChanges();

    const workspaceSelect = fixture.nativeElement.querySelectorAll('select')[1] as HTMLSelectElement;
    workspaceSelect.value = 'missing-workspace';
    workspaceSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No sessions in this Analytics cohort');
    expect(fixture.nativeElement.textContent).toContain('Reset Analytics filters');

    const resetButton = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Reset Analytics filters'),
    ) as HTMLButtonElement;
    resetButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Model breakdown');
  });
});

function sessionFixture(id: string, title: string, usd: number, input: number): CopilotSession {
  const startedAt = id === 'expensive-run' ? '2026-05-01T13:00:00.000Z' : '2026-05-01T12:00:00.000Z';

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
        tokens: { input, cachedInput: 0, cacheWrite: 0, output: 500 },
        cost: { usd, eur: usd },
      },
    ],
    startedAt,
    endedAt: startedAt,
    tags: ['debug-log'],
    toolsUsed: [],
    tokens: { input, cachedInput: 0, cacheWrite: 0, output: 500 },
    cost: { usd, eur: usd },
    confidence: 'exact',
    traceSummary: {
      modelTurns: 1,
      toolCalls: 0,
      totalTokens: input + 500,
      errors: 0,
      totalEvents: 1,
    },
    traceEvents: [],
    turns: [{ role: 'user', text: title, tokens: 2 }],
  };
}
