import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustomizationsPageComponent } from './customizations-page.component';
import { CopilotCustomization } from './session-data.model';

function customization(
  id: string,
  title: string,
  kind: CopilotCustomization['kind'],
  evidenceStatus: CopilotCustomization['evidenceStatus'],
  matchCount = 0,
): CopilotCustomization {
  return {
    id,
    title,
    kind,
    name: title.toLowerCase().replace(/\s+/g, '-'),
    description: `${title} description`,
    applyTo: [],
    triggers: [],
    scope: 'workspace',
    workspace: 'Fixture',
    sourcePath: `C:\\fixture\\.github\\skills\\${id}\\SKILL.md`,
    relativePath: `.github/skills/${id}/SKILL.md`,
    createdAt: '2026-07-13T10:00:00.000Z',
    modifiedAt: '2026-07-13T10:00:00.000Z',
    sizeBytes: 100,
    characterCount: 100,
    lineCount: 4,
    excerpt: `${title} excerpt`,
    evidenceStatus,
    matches: Array.from({ length: matchCount }, (_, index) => ({
      status: 'sent' as const,
      sessionId: `session-${index % 2}`,
      workspace: 'Fixture',
      timestamp: `2026-07-13T10:0${index}:00.000Z`,
      eventIndex: index + 1,
      modelCallNumber: index + 1,
      source: 'system_prompt_1.json',
      matchedChunks: 1,
      matchedCharacters: 800,
      matchedPreview: ['Representative distinctive customization text.'],
    })),
  };
}

describe('CustomizationsPageComponent', () => {
  let fixture: ComponentFixture<CustomizationsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CustomizationsPageComponent] }).compileComponents();
    fixture = TestBed.createComponent(CustomizationsPageComponent);
    fixture.componentRef.setInput('customizations', [
      customization('quiet-rule', 'Quiet Rule', 'instruction', 'not_seen'),
      {
        ...customization('create-pull-request', 'Skill', 'skill', 'sent', 2),
        name: 'skill',
      },
      customization('release-review', 'Release Safety Review', 'skill', 'sent', 3),
    ]);
    fixture.componentRef.setInput('sessions', []);
    fixture.componentRef.setInput('ingestion', {
      importedCustomizations: 3,
      customizationEvidenceAnalyzedAt: '2026-07-13T10:00:00.000Z',
    });
    fixture.detectChanges();
  });

  it('sorts by evidence count and shows a recognizable skill label', () => {
    const cards = [...fixture.nativeElement.querySelectorAll('.customization-card')] as HTMLElement[];
    expect(cards[0].textContent).toContain('Release Safety Review');
    expect(cards[0].textContent).toContain('Skill (Release Safety Review)');
    expect(cards[0].textContent).toContain('3 requests');
    expect(cards[1].textContent).toContain('Create Pull Request');
    expect(cards[1].textContent).toContain('Skill (Create Pull Request)');
  });

  it('filters to evidence-backed files and explains the summary counts', () => {
    const evidenceButton = [...fixture.nativeElement.querySelectorAll('.customizations-filter-chips button')]
      .find((button: Element) => button.textContent?.trim() === 'Evidence found') as HTMLButtonElement;
    evidenceButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.customization-card').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.overview-metrics').textContent).toContain('with evidence');
    expect(fixture.nativeElement.querySelector('.overview-metrics').textContent).toContain('sessions');
  });

  it('keeps technical evidence collapsed and removes dead-end evidence controls', () => {
    expect(fixture.nativeElement.querySelector('.customization-technical').open).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('View evidence');
    expect(fixture.nativeElement.textContent).not.toContain('Proof details');
  });
});
