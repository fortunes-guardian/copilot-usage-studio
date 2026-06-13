import { ComponentFixture, TestBed } from '@angular/core/testing';

import { traceEventDetails } from './session-analysis';
import { ModelBreakdown, TraceEvent } from './session-data.model';
import { SessionTraceComponent } from './session-trace.component';

describe('SessionTraceComponent', () => {
  const modelBreakdown: ModelBreakdown[] = [
    {
      model: 'gpt-4o',
      rawModels: ['gpt-4o'],
      turns: 1,
      tokens: { input: 2_279, cachedInput: 21_632, cacheWrite: 0, output: 285 },
      cost: { usd: 0.0153805, eur: 0.0153805 },
      pricingModel: 'GPT-5.4',
    },
  ];

  const cachedModelEvent: TraceEvent = {
    index: 7,
    timestamp: '2026-05-01T12:00:00.000Z',
    type: 'llm_request',
    name: 'panel/editAgent',
    status: 'ok',
    detail: 'gpt-4o: 23911 in / 285 out',
    model: 'gpt-4o',
    rawModel: 'gpt-4o',
    pricingModel: 'GPT-5.4',
    inputTokens: 23_911,
    cachedInputTokens: 21_632,
    outputTokens: 285,
    totalTokens: 24_196,
    estimatedCost: { usd: 0.0153805, eur: 0.0153805 },
  };

  const toolEvent: TraceEvent = {
    index: 8,
    timestamp: '2026-05-01T12:01:00.000Z',
    type: 'tool_call',
    name: 'read_file',
    status: 'ok',
    detail: 'read_file package.json',
    attributes: [{ label: 'filePath', value: 'package.json' }],
    inputTokens: 0,
    outputTokens: 0,
  };

  const customizationEvent: TraceEvent = {
    index: 9,
    timestamp: '2026-06-13T09:22:46.478Z',
    type: 'generic',
    name: 'Resolve Customizations',
    status: 'ok',
    detail: 'Resolved 1 customizations (1 listed) in 356.6ms',
    attributes: [
      { label: 'category', value: 'customization' },
      { label: 'source', value: 'core' },
    ],
    inputTokens: 0,
    outputTokens: 0,
  };

  async function render(selectedTraceEvent: TraceEvent): Promise<ComponentFixture<SessionTraceComponent>> {
    const fixture = TestBed.createComponent(SessionTraceComponent);
    const component = fixture.componentInstance;
    component.traceView = 'logs';
    component.traceFilter = 'all';
    component.traceFilterOptions = [
      { value: 'all', label: 'All' },
      { value: 'model', label: 'Model' },
      { value: 'tool', label: 'Tool' },
    ];
    component.filteredTraceEvents = [cachedModelEvent, toolEvent, customizationEvent];
    component.selectedTraceEvent = selectedTraceEvent;
    component.selectedTraceEventDetails = traceEventDetails(selectedTraceEvent, modelBreakdown);
    component.openedFromTurns = selectedTraceEvent.index === cachedModelEvent.index;
    component.flowEvents = [];
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionTraceComponent],
    }).compileComponents();
  });

  it('emphasizes cached model-call pricing details in the inspector', async () => {
    const fixture = await render(cachedModelEvent);
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Cost-bearing model call');
    expect(text).toContain('Opened from Calls');
    expect(text).toContain('2,279 normal input');
    expect(text).toContain('21,632 cached input');
    expect(text).toContain('285 output');
    expect(text).toContain('Raw inputTokens');
    expect(text).toContain('Normal input tokens');
    expect(text).toContain('Cached input tokens');
    expect(text).toContain('Fallback pricing row: GPT-5.4');
  });

  it('keeps tool events separate from direct model pricing', async () => {
    const fixture = await render(toolEvent);
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Tool activity');
    expect(text).toContain('Tool calls are not priced directly here.');
    expect(text).toContain('Direct cost');
    expect(text).toContain('None');
    expect(text).toContain('filePath');
    expect(text).toContain('package.json');
  });

  it('recognizes the current generic customization event as setup discovery', async () => {
    const fixture = await render(customizationEvent);
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Discovery or setup event');
    expect(text).toContain('Discovery · generic');
    expect(text).toContain('customization');
    expect(text).toContain('core');
  });
});
