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
});
