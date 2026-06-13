import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PricingPageComponent } from './pricing-page.component';
import { CopilotSession } from './session-data.model';

describe('PricingPageComponent', () => {
  let fixture: ComponentFixture<PricingPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PricingPageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PricingPageComponent);
  });

  it('filters allowance usage by imported-session window', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('old', 'GPT-5.4', 'GPT-5.4', '2026-05-01T12:00:00.000Z', 0.5),
      sessionFixture('new', 'GPT-5.4', 'GPT-5.4', '2026-05-20T12:00:00.000Z', 0.25),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('75 credits');
    expect(fixture.nativeElement.textContent).toContain('2 of 2 sessions');

    const usageWindowSelect = fixture.nativeElement.querySelectorAll('select')[1] as HTMLSelectElement;
    usageWindowSelect.value = '7d';
    usageWindowSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('25 credits');
    expect(fixture.nativeElement.textContent).toContain('1 of 2 sessions');
  });

  it('marks fallback pricing rows from imported sessions', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('fallback', 'gpt-4o', 'GPT-5.4', '2026-05-20T12:00:00.000Z', 0.25),
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Fallback row');
  });
});

function sessionFixture(
  id: string,
  model: string,
  pricingModel: string,
  startedAt: string,
  usd: number,
): CopilotSession {
  return {
    id,
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: id,
    firstPrompt: id,
    workspace: 'copilot-usage-studio',
    sourcePath: `debug-logs/${id}`,
    model,
    modelBreakdown: [
      {
        model,
        rawModels: [model],
        pricingModel,
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
    confidence: 'exact',
    traceSummary: {
      modelTurns: 1,
      toolCalls: 0,
      totalTokens: 1_100,
      errors: 0,
      totalEvents: 1,
    },
    traceEvents: [],
    turns: [{ role: 'user', text: id, tokens: 1 }],
  };
}
