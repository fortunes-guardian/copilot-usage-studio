import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SessionDataStatePanelComponent } from './session-data-state-panel.component';

describe('SessionDataStatePanelComponent', () => {
  let fixture: ComponentFixture<SessionDataStatePanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionDataStatePanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionDataStatePanelComponent);
    fixture.componentRef.setInput('state', 'error');
  });

  it('offers a local scan when no sessions have been imported', () => {
    fixture.componentRef.setInput('error', 'No session data is available yet.');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Import your first sessions');
    expect(text).toContain('Scan VS Code');
    expect(text).not.toContain('npm run scan');
  });

  it('emits refresh from the empty-state action', () => {
    fixture.componentRef.setInput('error', 'No session data is available yet.');
    fixture.detectChanges();
    const emit = vi.spyOn(fixture.componentInstance.refresh, 'emit');

    fixture.nativeElement.querySelector('button').click();

    expect(emit).toHaveBeenCalledOnce();
  });

  it('shows runtime diagnostics while local sessions are loading', () => {
    fixture.componentRef.setInput('state', 'loading');
    fixture.componentRef.setInput('runtimeStatusAvailable', true);
    fixture.componentRef.setInput('runtimeStatus', {
      phase: 'scanning',
      scanning: true,
      hasData: false,
      sessionCount: 0,
      memoryCount: 0,
      generatedAt: '',
      lastScanStartedAt: new Date().toISOString(),
      lastScanCompletedAt: '',
      lastScanDurationMs: 0,
      lastError: '',
      logFile: 'C:\\local\\Copilot Usage Studio\\runtime.log',
      scanProgress: {
        stage: 'debug-logs',
        message: 'Scanning 140 debug-log folders in work-repo.',
        updatedAt: new Date().toISOString(),
      },
      recentLogs: [
        {
          at: new Date().toISOString(),
          level: 'log',
          message: 'Scanning workspace work-repo.',
        },
      ],
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Scanning 140 debug-log folders in work-repo.');
    expect(text).toContain('Sessions ready');
    expect(text).toContain('runtime.log');
  });
});
