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
type MatchSource = 'inputMessages' | 'userRequest' | string;

type CustomizationSessionEvidence = {
  sessionId: string;
  session: CopilotSession | null;
  title: string;
  timestamp: string;
  bestStatus: CopilotCustomizationEvidenceStatus;
  matches: CopilotCustomization['matches'];
  sentCount: number;
  listedCount: number;
  discoveredCount: number;
  modelCallNumbers: number[];
  sources: string[];
  matchedChunks: number;
  matchedCharacters: number;
};

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
  protected readonly selectedSessionEvidence = computed(() => {
    const customization = this.selectedCustomization();
    return customization ? this.groupMatchesBySession(customization) : [];
  });

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
      sent: 'Sent to model',
      listed: 'Mentioned',
      discovered: 'Discovered',
      not_seen: 'Not seen',
    }[status];
  }

  protected statusHeadline(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'This content reached the model',
      listed: 'VS Code mentioned it, content was not verified',
      discovered: 'Found during setup, not seen in a request',
      not_seen: 'No evidence in imported sessions',
    }[status];
  }

  protected statusHelp(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Distinctive text from this file appeared inside the material VS Code sent to a model. This is the strongest local evidence.',
      listed: 'VS Code referenced this customization near a request, but imported payload text did not prove the file content was sent.',
      discovered: 'VS Code found the file during setup or discovery, but imported model requests did not show it being used.',
      not_seen: 'The file exists locally, but the imported sessions do not show it being discovered, listed, or sent.',
    }[status];
  }

  protected evidenceCountLabel(customization: CopilotCustomization): string {
    const sessions = new Set(customization.matches.map((match) => match.sessionId)).size;
    if (!customization.matches.length) {
      return 'No sessions';
    }
    return `${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'}`;
  }

  protected evidenceGroupSubtitle(group: CustomizationSessionEvidence): string {
    const parts = [];
    if (group.sentCount) {
      parts.push(`${group.sentCount} sent hit${group.sentCount === 1 ? '' : 's'}`);
    }
    if (group.listedCount) {
      parts.push(`${group.listedCount} mention${group.listedCount === 1 ? '' : 's'}`);
    }
    if (group.discoveredCount) {
      parts.push(`${group.discoveredCount} discovery hit${group.discoveredCount === 1 ? '' : 's'}`);
    }
    return parts.join(' · ') || 'Evidence recorded';
  }

  protected sourceLabel(source: MatchSource): string {
    return {
      inputMessages: 'Request payload',
      userRequest: 'User request',
    }[source] ?? source;
  }

  protected sourceHelp(source: MatchSource): string {
    return {
      inputMessages: 'The larger prompt payload VS Code assembled for the model request.',
      userRequest: 'The user-facing request object attached to the model call.',
    }[source] ?? 'Source field from the imported VS Code debug log.';
  }

  protected matchedContentLabel(match: CopilotCustomization['matches'][number]): string {
    if (match.status !== 'sent') {
      return 'content not verified';
    }
    if (!match.matchedChunks) {
      return 'content found';
    }
    return `${match.matchedChunks.toLocaleString()} text part${match.matchedChunks === 1 ? '' : 's'} found`;
  }

  protected modelRequestsLabel(group: CustomizationSessionEvidence): string {
    const calls = group.modelCallNumbers;
    if (!calls.length) {
      return '';
    }
    if (calls.length <= 4) {
      return `request${calls.length === 1 ? '' : 's'} #${calls.join(', #')}`;
    }
    return `${calls.length} model requests (#${calls[0]}-#${calls.at(-1)})`;
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

  private groupMatchesBySession(customization: CopilotCustomization): CustomizationSessionEvidence[] {
    const groups = new Map<string, CustomizationSessionEvidence>();
    for (const match of customization.matches) {
      const session = this.sessionForMatch(match.sessionId);
      const existing = groups.get(match.sessionId);
      const group =
        existing ??
        {
          sessionId: match.sessionId,
          session,
          title: session?.title ?? `Session ${match.sessionId.slice(0, 8)}`,
          timestamp: match.timestamp,
          bestStatus: match.status,
          matches: [],
          sentCount: 0,
          listedCount: 0,
          discoveredCount: 0,
          modelCallNumbers: [],
          sources: [],
          matchedChunks: 0,
          matchedCharacters: 0,
        };
      group.matches.push(match);
      group.bestStatus = this.strongerStatus(group.bestStatus, match.status);
      group.timestamp = [group.timestamp, match.timestamp].filter(Boolean).sort().at(-1) ?? group.timestamp;
      group.sentCount += match.status === 'sent' ? 1 : 0;
      group.listedCount += match.status === 'listed' ? 1 : 0;
      group.discoveredCount += match.status === 'discovered' ? 1 : 0;
      group.matchedChunks += match.matchedChunks ?? 0;
      group.matchedCharacters += match.matchedCharacters ?? 0;
      if (match.modelCallNumber && !group.modelCallNumbers.includes(match.modelCallNumber)) {
        group.modelCallNumbers.push(match.modelCallNumber);
      }
      if (match.source && !group.sources.includes(match.source)) {
        group.sources.push(match.source);
      }
      groups.set(match.sessionId, group);
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        modelCallNumbers: [...group.modelCallNumbers].sort((a, b) => a - b),
        matches: [...group.matches].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp) || b.eventIndex - a.eventIndex,
        ),
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  private strongerStatus(
    current: CopilotCustomizationEvidenceStatus,
    next: CopilotCustomizationEvidenceStatus,
  ): CopilotCustomizationEvidenceStatus {
    const rank: Record<CopilotCustomizationEvidenceStatus, number> = {
      not_seen: 0,
      discovered: 1,
      listed: 2,
      sent: 3,
    };
    return rank[next] > rank[current] ? next : current;
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
