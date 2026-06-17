import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  CopilotCustomization,
  CopilotCustomizationEvidenceStatus,
  CopilotCustomizationKind,
  CopilotSession,
} from './session-data.model';
import { HelpPopoverComponent } from './help-popover.component';

type CustomizationKindFilter = 'all' | CopilotCustomizationKind;
type CustomizationStatusFilter = 'all' | CopilotCustomizationEvidenceStatus;

@Component({
  selector: 'app-customizations-page',
  imports: [DatePipe, DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './customizations-page.component.html',
  styleUrl: './customizations-page.component.css',
})
export class CustomizationsPageComponent {
  protected readonly customizationsInput = signal<CopilotCustomization[]>([]);
  protected readonly sessionsInput = signal<CopilotSession[]>([]);
  protected readonly query = signal('');
  protected readonly kindFilter = signal<CustomizationKindFilter>('all');
  protected readonly statusFilter = signal<CustomizationStatusFilter>('all');
  protected readonly workspaceFilter = signal('all');
  protected readonly selectedId = signal<string | null>(null);

  @Input() set customizations(value: CopilotCustomization[] | null | undefined) {
    const customizations = value ?? [];
    this.customizationsInput.set(customizations);
    if (!this.selectedId() || !customizations.some((customization) => customization.id === this.selectedId())) {
      this.selectedId.set(customizations[0]?.id ?? null);
    }
  }

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  @Output() readonly openSession = new EventEmitter<CopilotSession>();

  protected readonly workspaceOptions = computed(() => [
    'all',
    ...[...new Set(this.customizationsInput().map((item) => item.workspace).filter(Boolean))].sort(),
  ]);

  protected readonly filteredCustomizations = computed(() => {
    const query = this.query().trim().toLowerCase();
    const kind = this.kindFilter();
    const status = this.statusFilter();
    const workspace = this.workspaceFilter();

    return this.customizationsInput().filter((item) => {
      const matchesQuery =
        !query ||
        [
          item.title,
          item.name,
          item.description,
          item.excerpt,
          item.relativePath,
          item.sourcePath,
          item.kind,
          item.evidenceStatus,
          item.workspace,
          ...item.applyTo,
          ...item.triggers,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query);

      return (
        matchesQuery &&
        (kind === 'all' || item.kind === kind) &&
        (status === 'all' || item.evidenceStatus === status) &&
        (workspace === 'all' || item.workspace === workspace)
      );
    });
  });

  protected readonly selectedCustomization = computed(() => {
    const filtered = this.filteredCustomizations();
    return filtered.find((item) => item.id === this.selectedId()) ?? filtered[0] ?? null;
  });
  protected readonly selectedCustomizationId = computed(() => this.selectedCustomization()?.id ?? '');

  protected readonly summary = computed(() => {
    const items = this.customizationsInput();
    return {
      total: items.length,
      sent: items.filter((item) => item.evidenceStatus === 'sent').length,
      listed: items.filter((item) => item.evidenceStatus === 'listed').length,
      discovered: items.filter((item) => item.evidenceStatus === 'discovered').length,
    };
  });

  protected selectCustomization(customization: CopilotCustomization): void {
    this.selectedId.set(customization.id);
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.ensureVisibleSelection();
  }

  protected setKindFilter(value: CustomizationKindFilter): void {
    this.kindFilter.set(value);
    this.ensureVisibleSelection();
  }

  protected setStatusFilter(value: CustomizationStatusFilter): void {
    this.statusFilter.set(value);
    this.ensureVisibleSelection();
  }

  protected setWorkspaceFilter(value: string): void {
    this.workspaceFilter.set(value);
    this.ensureVisibleSelection();
  }

  protected resetFilters(): void {
    this.query.set('');
    this.kindFilter.set('all');
    this.statusFilter.set('all');
    this.workspaceFilter.set('all');
    this.ensureVisibleSelection();
  }

  protected fileName(customization: CopilotCustomization): string {
    return (customization.relativePath || customization.sourcePath)
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? customization.title;
  }

  protected kindLabel(kind: CopilotCustomizationKind): string {
    return {
      instruction: 'Instruction',
      skill: 'Skill',
      prompt: 'Prompt',
      hook: 'Hook',
      other: 'Other',
    }[kind];
  }

  protected statusLabel(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Sent to model',
      listed: 'Listed only',
      discovered: 'Discovered only',
      not_seen: 'Not seen',
    }[status];
  }

  protected statusHelp(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'The scanner matched content from this file inside a model request payload or a request side file.',
      listed: 'The model request listed this customization by name, path, description, trigger, or applyTo rule, but the full file content was not matched.',
      discovered: 'VS Code resolved this customization in setup/discovery events, but request payload evidence was not found.',
      not_seen: 'The file exists locally, but imported sessions did not show discovery or request evidence for it.',
    }[status];
  }

  protected sessionForMatch(sessionId: string): CopilotSession | null {
    return this.sessionsInput().find((session) => session.id === sessionId) ?? null;
  }

  protected emitOpenSession(sessionId: string): void {
    const session = this.sessionForMatch(sessionId);
    if (session) {
      this.openSession.emit(session);
    }
  }

  private ensureVisibleSelection(): void {
    const filtered = this.filteredCustomizations();
    if (!filtered.length) {
      this.selectedId.set(null);
      return;
    }
    if (!filtered.some((item) => item.id === this.selectedId())) {
      this.selectedId.set(filtered[0].id);
    }
  }
}
