import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  CopilotMemory,
  CopilotMemoryKind,
  CopilotMemoryScope,
  CopilotSession,
  MemoryRecall,
} from './session-data.model';
import { HelpPopoverComponent } from './help-popover.component';

type MemoryKindFilter = 'all' | CopilotMemoryKind;
type MemoryScopeFilter = 'all' | CopilotMemoryScope;
type MemoryAction = 'open' | 'reveal';

@Component({
  selector: 'app-memory-page',
  imports: [DatePipe, DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './memory-page.component.html',
  styleUrl: './memory-page.component.css',
})
export class MemoryPageComponent {
  private readonly http = inject(HttpClient);
  protected readonly memoriesInput = signal<CopilotMemory[]>([]);
  protected readonly sessionsInput = signal<CopilotSession[]>([]);
  protected readonly query = signal('');
  protected readonly scopeFilter = signal<MemoryScopeFilter>('all');
  protected readonly kindFilter = signal<MemoryKindFilter>('all');
  protected readonly workspaceFilter = signal('all');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly actionStatus = signal('');

  @Input() set memories(value: CopilotMemory[] | null | undefined) {
    const memories = value ?? [];
    this.memoriesInput.set(memories);
    if (!this.selectedId() || !memories.some((memory) => memory.id === this.selectedId())) {
      this.selectedId.set(memories[0]?.id ?? null);
    }
  }

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  @Output() readonly openSession = new EventEmitter<CopilotSession>();

  protected readonly workspaceOptions = computed(() => [
    'all',
    ...[...new Set(this.memoriesInput().map((memory) => memory.workspace).filter(Boolean))].sort(),
  ]);

  protected readonly filteredMemories = computed(() => {
    const query = this.query().trim().toLowerCase();
    return this.memoriesInput().filter((memory) => {
      const matchesQuery =
        !query ||
        [
          memory.title,
          memory.excerpt,
          memory.content,
          memory.relativePath,
          memory.sourcePath,
          this.fileName(memory),
          memory.workspace,
          memory.scope,
          memory.kind,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query);
      return (
        matchesQuery &&
        (this.scopeFilter() === 'all' || memory.scope === this.scopeFilter()) &&
        (this.kindFilter() === 'all' || memory.kind === this.kindFilter()) &&
        (this.workspaceFilter() === 'all' || memory.workspace === this.workspaceFilter())
      );
    });
  });

  protected readonly selectedMemory = computed(() => {
    const filtered = this.filteredMemories();
    return filtered.find((memory) => memory.id === this.selectedId()) ?? filtered[0] ?? null;
  });

  protected readonly summary = computed(() => {
    const memories = this.memoriesInput();
    return {
      total: memories.length,
      plans: memories.filter((memory) => memory.kind === 'plan').length,
      recalls: memories.reduce((total, memory) => total + (memory.recalls?.length ?? 0), 0),
      repositories: new Set(memories.map((memory) => memory.workspace).filter(Boolean)).size,
    };
  });

  protected recallSession(sessionId: string): CopilotSession | null {
    return this.sessionsInput().find((session) => session.id === sessionId) ?? null;
  }

  protected emitRecallSession(sessionId: string): void {
    const session = this.recallSession(sessionId);
    if (session) {
      this.openSession.emit(session);
    }
  }

  protected recallRequestLabel(recall: MemoryRecall): string {
    const number = recall.followingModelCall?.number;
    const request = number ? `request ${number}` : 'request';
    return recall.sourceLog === 'main.jsonl'
      ? `Before model ${request}`
      : `Before subagent model ${request}`;
  }

  protected selectMemory(memory: CopilotMemory): void {
    this.selectedId.set(memory.id);
    this.actionStatus.set('');
  }

  protected setScopeFilter(value: MemoryScopeFilter): void {
    this.scopeFilter.set(value);
    this.actionStatus.set('');
    this.ensureVisibleSelection();
  }

  protected setKindFilter(value: MemoryKindFilter): void {
    this.kindFilter.set(value);
    this.actionStatus.set('');
    this.ensureVisibleSelection();
  }

  protected setWorkspaceFilter(value: string): void {
    this.workspaceFilter.set(value);
    this.actionStatus.set('');
    this.ensureVisibleSelection();
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.actionStatus.set('');
    this.ensureVisibleSelection();
  }

  protected resetFilters(): void {
    this.query.set('');
    this.scopeFilter.set('all');
    this.kindFilter.set('all');
    this.workspaceFilter.set('all');
    this.ensureVisibleSelection();
  }

  protected fileName(memory: CopilotMemory): string {
    return (memory.relativePath || memory.sourcePath).split(/[\\/]+/).filter(Boolean).at(-1) ?? memory.title;
  }

  protected scopeHelp(scope: CopilotMemoryScope): string {
    return {
      session: 'Session-scoped memory is tied to one Copilot session. It is useful for saved plans or temporary research from that run.',
      repository: 'Repository memory is saved for a workspace repository and can be available to future Copilot sessions in that workspace.',
      workspace: 'Workspace memory belongs to this VS Code workspace but is not clearly tied to one repository or session.',
      global: 'Global memory is stored in VS Code user storage and can apply across workspaces on this machine.',
    }[scope];
  }

  private ensureVisibleSelection(): void {
    const filtered = this.filteredMemories();
    if (!filtered.length) {
      this.selectedId.set(null);
      return;
    }
    if (!filtered.some((memory) => memory.id === this.selectedId())) {
      this.selectedId.set(filtered[0].id);
    }
  }

  protected linkedSession(memory: CopilotMemory): CopilotSession | null {
    return memory.sessionId
      ? (this.sessionsInput().find((session) => session.id === memory.sessionId) ?? null)
      : null;
  }

  protected emitOpenSession(memory: CopilotMemory): void {
    const session = this.linkedSession(memory);
    if (session) {
      this.openSession.emit(session);
    }
  }

  protected runMemoryAction(memory: CopilotMemory, action: MemoryAction): void {
    this.actionStatus.set(action === 'open' ? 'Opening file…' : 'Showing file…');
    this.http.post(`/api/memories/${memory.id}/open`, { action }).subscribe({
      next: () => this.actionStatus.set(action === 'open' ? 'Opened file' : 'Shown in folder'),
      error: () => this.actionStatus.set('File actions require the local runtime'),
    });
  }

  protected async copyPath(memory: CopilotMemory): Promise<void> {
    try {
      await globalThis.navigator?.clipboard?.writeText(memory.sourcePath);
      this.actionStatus.set('Path copied');
    } catch {
      this.actionStatus.set('Could not copy the path');
    }
  }

  protected async copyContent(memory: CopilotMemory): Promise<void> {
    try {
      await globalThis.navigator?.clipboard?.writeText(memory.content);
      this.actionStatus.set('Memory copied');
    } catch {
      this.actionStatus.set('Could not copy the memory');
    }
  }

  protected scopeLabel(scope: CopilotMemoryScope): string {
    return {
      global: 'Global',
      repository: 'Repository',
      session: 'Session',
      workspace: 'Workspace',
    }[scope];
  }
}
