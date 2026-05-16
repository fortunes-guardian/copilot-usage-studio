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
      },
    ],
  };
}
