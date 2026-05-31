import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionTurnsComponent, SessionTurnsViewModel } from './session-turns.component';

describe('SessionTurnsComponent', () => {
  let fixture: ComponentFixture<SessionTurnsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionTurnsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionTurnsComponent);
    fixture.componentRef.setInput('cost', turnsFixture());
    fixture.componentRef.setInput('sort', 'timeline');
    fixture.detectChanges();
  });

  it('labels accented model-call rows by cost share', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('High share');
    expect(text).toContain('Medium share');
  });

  it('shows context load timeline from raw input tokens and model limits', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Input sent to the model');
    expect(text).toContain('Biggest request');
    expect(text).toContain('9,000');
    expect(text).toContain('7%');
    expect(text).toContain('Repeated load');
    expect(text).toContain('You');
    expect(text).toContain('Setup footprint');
    expect(text).toContain('No setup changes');
    expect(text).toContain('MCP');
  });
});

function turnsFixture(): SessionTurnsViewModel {
  return {
    turnInsights: [],
    modelCallRows: [
      {
        index: 10,
        callNumber: 1,
        timestamp: '2026-05-01T12:00:00.000Z',
        model: 'GPT-5.4',
        name: 'panel/editAgent',
        pricingModel: 'GPT-5.4',
        usesFallbackPrice: false,
        totalTokens: 10_000,
        inputTokens: 9_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1_000,
        estimatedUsd: 0.25,
        inputUsd: 0.1,
        cachedInputUsd: 0,
        cacheWriteUsd: 0,
        outputUsd: 0.15,
        share: 42,
        contextLabel: 'user_message',
        contextDetail: 'test prompt',
        startsAfterUserRequest: true,
        userRequestIndex: 9,
        userRequestDetail: 'test prompt',
        promptLimitTokens: 128_000,
        contextWindowTokens: 200_000,
        promptLimitShare: 9_000 / 128_000,
        contextWindowShare: 9_000 / 200_000,
        cumulativeRawInputTokens: 9_000,
        repeatedInputFactorAtCall: 1,
        setupPayload: {
          systemPromptFile: 'system_prompt_0.json',
          systemPromptChars: 12_000,
          toolsFile: 'tools_0.json',
          toolSchemaChars: 24_000,
          toolCount: 8,
          mcpToolCount: 2,
          mcpToolNames: ['mcp_files_read', 'mcp_search_query'],
        },
      },
      {
        index: 11,
        callNumber: 2,
        timestamp: '2026-05-01T12:01:00.000Z',
        model: 'GPT-5.4',
        name: 'panel/editAgent',
        pricingModel: 'GPT-5.4',
        usesFallbackPrice: false,
        totalTokens: 4_000,
        inputTokens: 3_500,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 500,
        estimatedUsd: 0.08,
        inputUsd: 0.04,
        cachedInputUsd: 0,
        cacheWriteUsd: 0,
        outputUsd: 0.04,
        share: 15,
        contextLabel: 'tool_call',
        contextDetail: 'read_file',
        promptLimitTokens: 128_000,
        contextWindowTokens: 200_000,
        promptLimitShare: 3_500 / 128_000,
        contextWindowShare: 3_500 / 200_000,
        cumulativeRawInputTokens: 12_500,
        repeatedInputFactorAtCall: 12_500 / 3_500,
      },
    ],
  };
}
