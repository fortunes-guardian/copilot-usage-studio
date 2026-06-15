import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MemoryPageComponent } from './memory-page.component';
import { CopilotMemory, CopilotSession } from './session-data.model';

describe('MemoryPageComponent', () => {
  let fixture: ComponentFixture<MemoryPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MemoryPageComponent);
    fixture.componentRef.setInput('memories', [
      memoryFixture('plan-1', 'plan', 'session', 'CSV Export Plan', 'repo-a', 'session-1'),
      memoryFixture('repo-1', 'memory', 'repository', 'Architecture Notes', 'repo-a'),
      memoryFixture('global-1', 'memory', 'global', 'Global Preferences', ''),
    ]);
    fixture.componentRef.setInput('sessions', [
      { id: 'session-1', title: 'Plan a CSV export' } as CopilotSession,
    ]);
    fixture.detectChanges();
  });

  it('renders a searchable knowledge library with plan and scope summaries', () => {
    expect(fixture.nativeElement.textContent).toContain('What Copilot remembers');
    expect(fixture.nativeElement.textContent).toContain('3');
    expect(fixture.nativeElement.textContent).toContain('CSV Export Plan');
    expect(fixture.nativeElement.textContent).toContain('Read-only library');
  });

  it('filters memory content without losing the readable detail view', () => {
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'Architecture';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Architecture Notes');
    expect(fixture.nativeElement.textContent).not.toContain('CSV Export Plan');
    expect(fixture.nativeElement.querySelector('.memory-content')?.textContent).toContain(
      'Architecture Notes',
    );
  });

  it('links a session-scoped plan back to the imported run', () => {
    const openSession = vi.fn();
    fixture.componentInstance.openSession.subscribe(openSession);
    const createdInButton = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.includes('Created in:'),
    ) as HTMLButtonElement;

    createdInButton.click();
    expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
  });
});

function memoryFixture(
  id: string,
  kind: CopilotMemory['kind'],
  scope: CopilotMemory['scope'],
  title: string,
  workspace: string,
  sessionId = '',
): CopilotMemory {
  return {
    id,
    kind,
    scope,
    title,
    excerpt: `${title} excerpt`,
    content: `# ${title}\n\nUseful saved context.`,
    workspace,
    sessionId,
    sourcePath: `C:\\memories\\${id}.md`,
    relativePath: `${id}.md`,
    createdAt: '2026-06-15T10:00:00.000Z',
    modifiedAt: '2026-06-15T11:00:00.000Z',
    sizeBytes: 100,
    characterCount: 40,
    lineCount: 3,
  };
}
