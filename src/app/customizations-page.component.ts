import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  CopilotCustomization,
  CopilotCustomizationEvidenceStatus,
  CopilotCustomizationKind,
  CopilotSession,
  SessionData,
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
  protected readonly ingestionInput = signal<SessionData['ingestion'] | null>(null);
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

  @Input() set ingestion(value: SessionData['ingestion'] | null | undefined) {
    this.ingestionInput.set(value ?? null);
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

  protected readonly scanDiagnostics = computed(() => {
    const ingestion = this.ingestionInput();
    const locations = ingestion?.scannedCustomizationLocations ?? [];
    return {
      roots: ingestion?.scannedCustomizationRoots ?? 0,
      files: ingestion?.importedCustomizations ?? this.customizationsInput().length,
      locations: locations.slice(0, 80),
      locationCount: locations.length,
      capped: locations.length >= 200,
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
      agent: 'Agent',
      other: 'Other',
    }[kind];
  }

  protected statusLabel(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Sent',
      listed: 'Listed',
      discovered: 'Discovered',
      not_seen: 'Not seen',
    }[status];
  }

  protected statusHeadline(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Content found in a model request',
      listed: 'Known to the request, content not matched',
      discovered: 'Found during setup, not in a request',
      not_seen: 'No evidence in imported sessions',
    }[status];
  }

  protected statusHelp(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Text from this file appeared in the prompt material that VS Code sent to a model request.',
      listed: 'VS Code mentioned this file or rule in request metadata, but the scanner did not find distinctive file text in the prompt.',
      discovered: 'VS Code found the file during setup or discovery, but imported requests did not show it being sent.',
      not_seen: 'The file exists locally, but the imported sessions do not show it being discovered, listed, or sent.',
    }[status];
  }

  protected diagnosticKindLabel(kind: string): string {
    return {
      root: 'Folder',
      file: 'File',
      'debug-reference': 'Debug reference',
      'debug-discovery-root': 'VS Code discovery',
      'vscode-setting-root': 'VS Code setting',
      'user-default-root': 'User default',
    }[kind] ?? kind;
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
