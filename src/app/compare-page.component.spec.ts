import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComparePageComponent } from './compare-page.component';
import { CopilotSession } from './session-data.model';

describe('ComparePageComponent', () => {
  let fixture: ComponentFixture<ComparePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparePageComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparePageComponent);
  });

  it('explains the spread inside a repeated-prompt group', () => {
    fixture.componentRef.setInput('sessions', [
      sessionFixture('run-a', 'Repeated prompt', 0.01, 1_000, 500, 0, 100, 1, 1),
      sessionFixture('run-b', 'Repeated prompt', 0.04, 10_000, 500, 0, 100, 3, 4),
      sessionFixture('run-c', 'Other prompt', 0.02, 2_000, 0, 0, 200, 1, 0),
    ]);
    fixture.componentRef.setInput('compareA', 'run-a');
    fixture.componentRef.setInput('compareB', 'run-b');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Same prompt selected');
    expect(text).toContain('Same-prompt spread');
    expect(text).toContain('Normal input moved cost most');
  });

  it('keeps baseline and candidate distinct when selecting the other side from a prompt group', () => {
    const emissions: Array<string | null> = [];
    fixture.componentRef.setInput('sessions', [
      sessionFixture('run-a', 'Repeated prompt', 0.01, 1_000, 0, 0, 100, 1, 1),
      sessionFixture('run-b', 'Repeated prompt', 0.02, 2_000, 0, 0, 100, 2, 2),
      sessionFixture('run-c', 'Repeated prompt', 0.03, 3_000, 0, 0, 100, 3, 3),
    ]);
    fixture.componentRef.setInput('compareA', 'run-a');
    fixture.componentRef.setInput('compareB', 'run-b');
    fixture.componentInstance.compareAChange.subscribe((value) => emissions.push(value));
    fixture.componentInstance.compareBChange.subscribe((value) => emissions.push(value));
    fixture.detectChanges();

    const setAForRunB = [...fixture.nativeElement.querySelectorAll('.prompt-run-list article')]
      .find((row) => row.textContent.includes('Run 2'))
      ?.querySelector('button');
    setAForRunB?.click();
    fixture.detectChanges();

    expect(emissions).toContain('run-b');
    expect(emissions).toContain('run-a');
    expect(fixture.nativeElement.textContent).toContain('A is Run 2');
    expect(fixture.nativeElement.textContent).toContain('B is Run 1');
  });
});

function sessionFixture(
  id: string,
  firstPrompt: string,
  usd: number,
  input: number,
  cachedInput: number,
  cacheWrite: number,
  output: number,
  modelTurns: number,
  toolCalls: number,
): CopilotSession {
  const startedAt = `2026-05-01T12:0${id.at(-1) === 'a' ? 1 : id.at(-1) === 'b' ? 2 : 3}:00.000Z`;

  return {
    id,
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: id,
    firstPrompt,
    workspace: 'copilot-cost-debugger',
    sourcePath: `debug-logs/${id}`,
    model: 'GPT-5.4',
    modelBreakdown: [
      {
        model: 'GPT-5.4',
        rawModels: ['gpt-5.4'],
        pricingModel: 'GPT-5.4',
        turns: modelTurns,
        tokens: { input, cachedInput, cacheWrite, output },
        cost: { usd, eur: usd },
      },
    ],
    startedAt,
    endedAt: startedAt,
    tags: ['debug-log'],
    toolsUsed: [],
    tokens: { input, cachedInput, cacheWrite, output },
    cost: { usd, eur: usd },
    confidence: 'exact',
    traceSummary: {
      modelTurns,
      toolCalls,
      totalTokens: input + cachedInput + cacheWrite + output,
      errors: 0,
      totalEvents: modelTurns + toolCalls,
    },
    traceEvents: [],
    turns: [{ role: 'user', text: firstPrompt, tokens: 2 }],
  };
}
