import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionRailComponent } from './session-rail.component';
import { CopilotSession } from './session-data.model';

describe('SessionRailComponent', () => {
  let fixture: ComponentFixture<SessionRailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionRailComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionRailComponent);
  });

  it('renders practical triage filters without reintroducing source filters', () => {
    fixture.componentRef.setInput('sessions', [sessionFixture('small', 50_000), sessionFixture('large', 700_000)]);
    fixture.componentRef.setInput('filteredSessions', [sessionFixture('large', 700_000)]);
    fixture.componentRef.setInput('sizeOptions', ['all', 'Small', 'Medium', 'Large', 'Very large']);
    fixture.componentRef.setInput('warningOptions', ['all', 'High input context']);
    fixture.componentRef.setInput('workspaceOptions', ['all', 'copilot-cost-debugger']);
    fixture.componentRef.setInput('modelOptions', ['all', 'GPT-5.4']);
    fixture.componentRef.setInput('timeOptions', [{ value: 'all', label: 'All time' }]);
    fixture.componentRef.setInput('sizeFilter', 'Large');
    fixture.componentRef.setInput('warningFilter', 'High input context');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('1 of 2 sessions shown');
    expect(text).toContain('Time');
    expect(text).toContain('Workspace');
    expect(text).toContain('Model');
    expect(text).toContain('Size');
    expect(text).toContain('Signal');
    expect(text).not.toContain('Source');
  });

  it('emits query, filter, and selected-session changes', () => {
    const queryValues: string[] = [];
    const sizeValues: string[] = [];
    const warningValues: string[] = [];
    const workspaceValues: string[] = [];
    const modelValues: string[] = [];
    const timeValues: string[] = [];
    const selected: CopilotSession[] = [];

    fixture.componentRef.setInput('sessions', [sessionFixture('large', 700_000)]);
    fixture.componentRef.setInput('filteredSessions', [sessionFixture('large', 700_000)]);
    fixture.componentRef.setInput('sizeOptions', ['all', 'Small', 'Medium', 'Large', 'Very large']);
    fixture.componentRef.setInput('warningOptions', ['all', 'High input context']);
    fixture.componentRef.setInput('workspaceOptions', ['all', 'copilot-cost-debugger']);
    fixture.componentRef.setInput('modelOptions', ['all', 'GPT-5.4']);
    fixture.componentRef.setInput('timeOptions', [
      { value: 'all', label: 'All time' },
      { value: '30d', label: 'Last 30 days' },
    ]);
    fixture.componentInstance.queryChange.subscribe((value) => queryValues.push(value));
    fixture.componentInstance.sizeFilterChange.subscribe((value) => sizeValues.push(value));
    fixture.componentInstance.warningFilterChange.subscribe((value) => warningValues.push(value));
    fixture.componentInstance.workspaceFilterChange.subscribe((value) => workspaceValues.push(value));
    fixture.componentInstance.modelFilterChange.subscribe((value) => modelValues.push(value));
    fixture.componentInstance.timeFilterChange.subscribe((value) => timeValues.push(value));
    fixture.componentInstance.selectSession.subscribe((session) => selected.push(session));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const selects = fixture.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>;
    input.value = 'review';
    input.dispatchEvent(new Event('input'));
    selects[0].value = '30d';
    selects[0].dispatchEvent(new Event('change'));
    selects[1].value = 'copilot-cost-debugger';
    selects[1].dispatchEvent(new Event('change'));
    selects[2].value = 'GPT-5.4';
    selects[2].dispatchEvent(new Event('change'));
    selects[3].value = 'Large';
    selects[3].dispatchEvent(new Event('change'));
    selects[4].value = 'High input context';
    selects[4].dispatchEvent(new Event('change'));
    fixture.nativeElement.querySelector('.session-card').click();

    expect(queryValues).toContain('review');
    expect(timeValues).toContain('30d');
    expect(workspaceValues).toContain('copilot-cost-debugger');
    expect(modelValues).toContain('GPT-5.4');
    expect(sizeValues).toContain('Large');
    expect(warningValues).toContain('High input context');
    expect(selected[0].id).toBe('large');
  });
});

function sessionFixture(id: string, input: number): CopilotSession {
  return {
    id,
    sourceKind: 'vscode-copilot-debug-log',
    tokenSource: 'llm_request_token_totals',
    sessionType: 'Local',
    location: 'Chat Panel',
    status: 'Idle',
    title: id,
    firstPrompt: `${id} prompt`,
    workspace: 'copilot-cost-debugger',
    sourcePath: `debug-logs/${id}`,
    model: 'GPT-5.4',
    modelBreakdown: [
      {
        model: 'GPT-5.4',
        rawModels: ['gpt-5.4'],
        pricingModel: 'GPT-5.4',
        turns: 1,
        tokens: { input, cachedInput: 0, cacheWrite: 0, output: 100 },
        cost: { usd: 0.01, eur: 0.01 },
      },
    ],
    startedAt: '2026-05-01T12:00:00.000Z',
    endedAt: '2026-05-01T12:01:00.000Z',
    tags: ['debug-log'],
    toolsUsed: [],
    tokens: { input, cachedInput: 0, cacheWrite: 0, output: 100 },
    cost: { usd: 0.01, eur: 0.01 },
    confidence: 'exact',
    traceSummary: {
      modelTurns: 1,
      toolCalls: 0,
      totalTokens: input + 100,
      errors: 0,
      totalEvents: 1,
    },
    traceEvents: [],
    turns: [{ role: 'user', text: id, tokens: 1 }],
  };
}
