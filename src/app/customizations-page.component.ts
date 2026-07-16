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
import { LocalRuntimeStatus, SessionDataRefreshState } from './session-data.service';
import { ResizableSidebarDirective } from './resizable-sidebar.directive';

type CustomizationResultFilter =
  | 'all'
  | 'evidence'
  | 'none'
  | 'partial'
  | 'skill'
  | 'instruction'
  | 'prompt'
  | 'rule';
type MatchSource = 'inputMessages' | 'userRequest' | string;
type EvidenceSource = {
  label: string;
  raw: string;
};
type CustomizationCallEvidence = {
  key: string;
  callNumber: number;
  eventIndex: number;
  status: CopilotCustomizationEvidenceStatus;
  matches: CopilotCustomization['matches'];
  sources: EvidenceSource[];
  matchedChunks: number;
  matchedCharacters: number;
  matchedPreview: string[];
};

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
  imports: [DatePipe, DecimalPipe, FormsModule, HelpPopoverComponent, ResizableSidebarDirective],
  templateUrl: './customizations-page.component.html',
  styleUrl: './customizations-page.component.css',
})
export class CustomizationsPageComponent {
  protected readonly customizationsInput = signal<CopilotCustomization[]>([]);
  protected readonly sessionsInput = signal<CopilotSession[]>([]);
  protected readonly ingestionInput = signal<SessionData['ingestion'] | null>(null);
  protected readonly query = signal('');
  protected readonly workspaceFilter = signal('all');
  protected readonly resultFilter = signal<CustomizationResultFilter>('all');
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

  @Input() refreshState: SessionDataRefreshState = 'idle';
  @Input() refreshMessage: string | null = null;
  @Input() runtimeStatus: LocalRuntimeStatus | null = null;

  @Output() readonly scanEvidence = new EventEmitter<void>();
  @Output() readonly cancelScan = new EventEmitter<void>();
  @Output() readonly openSession = new EventEmitter<CopilotSession>();

  protected readonly workspaceOptions = computed(() => [
    'all',
    ...[...new Set(this.customizationsInput().map((item) => item.workspace).filter(Boolean))].sort(),
  ]);

  protected readonly filteredCustomizations = computed(() => {
    const query = this.query().trim().toLowerCase();
    const workspace = this.workspaceFilter();

    return this.customizationsInput().filter((item) => {
      const matchesQuery =
        !query ||
        [
          this.displayTitle(item),
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
        (workspace === 'all' || item.workspace === workspace) &&
        this.matchesResultFilter(item, this.resultFilter())
      );
    }).sort((a, b) =>
      this.evidenceSortCount(b) - this.evidenceSortCount(a) ||
      this.statusRank(b.evidenceStatus) - this.statusRank(a.evidenceStatus) ||
      this.displayTitle(a).localeCompare(this.displayTitle(b)),
    );
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
      sessions: this.evidenceSessionCount(),
      matches: this.evidenceMatchCount(),
      partial: items.filter((item) => ['listed', 'discovered'].includes(item.evidenceStatus)).length,
    };
  });

  protected readonly resultFilters: Array<{ value: CustomizationResultFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'evidence', label: 'Evidence found' },
    { value: 'none', label: 'No evidence' },
    { value: 'partial', label: 'Partial results' },
    { value: 'skill', label: 'Skills' },
    { value: 'instruction', label: 'Instructions' },
    { value: 'prompt', label: 'Prompts' },
    { value: 'rule', label: 'Rules' },
  ];

  protected readonly summaryHelp = {
    overview: 'Files is the discovered customization inventory. Evidence counts files with distinctive text in visible request logs, sessions counts distinct Copilot sessions, and matches counts distinct customization/request occurrences.',
    files: 'Customization files discovered in trusted VS Code settings, defaults, or exact local-log references.',
    evidence: 'Files with distinctive text matched inside visible VS Code model-request logs.',
    sessions: 'Distinct Copilot sessions containing at least one text match for a customization file.',
    matches: 'Text-match evidence records. One file can match multiple requests in the same session.',
  };

  protected readonly scanDiagnostics = computed(() => {
    const ingestion = this.ingestionInput();
    const locations = (ingestion?.scannedCustomizationLocations ?? []).filter(
      (location) => location.kind !== 'candidate',
    );
    return {
      roots: ingestion?.scannedCustomizationRoots ?? 0,
      files: ingestion?.importedCustomizations ?? this.customizationsInput().length,
      locations: locations.slice(0, 80),
      locationCount: locations.length,
      capped: locations.length >= 200,
    };
  });

  protected readonly customizationEvidenceSummary = computed(() => {
    const ingestion = this.ingestionInput();
    const customizations = this.customizationsInput();
    const sent = customizations.filter((item) => item.evidenceStatus === 'sent').length;
    const notProved = customizations.filter((item) => item.evidenceStatus === 'listed').length;
    const hasScannedEvidence = Boolean(
      ingestion?.customizationEvidenceAnalyzedAt || (ingestion?.customizationEvidenceScannedSessions ?? 0) > 0,
    );
    return {
      sent,
      notProved,
      hasScannedEvidence,
      label: hasScannedEvidence
        ? `${sent.toLocaleString()} text-matched · ${notProved.toLocaleString()} read/referenced`
        : 'Detailed evidence skipped',
    };
  });

  protected scanActionLabel(): string {
    if (this.refreshState === 'refreshing') {
      return 'Analyzing...';
    }
    if (!this.customizationsInput().length && !this.customizationEvidenceSummary().hasScannedEvidence) {
      return 'Analyze this workspace';
    }
    return this.customizationEvidenceSummary().hasScannedEvidence ? 'Analyze new activity' : 'Analyze customizations';
  }

  protected showHeaderScanAction(): boolean {
    return (
      this.isEvidenceScanActive() ||
      this.customizationsInput().length > 0 ||
      this.customizationEvidenceSummary().hasScannedEvidence ||
      this.refreshState === 'error'
    );
  }

  protected isEvidenceScanActive(): boolean {
    return this.refreshState === 'refreshing' && this.runtimeStatus?.activeScanMode === 'customizations';
  }

  protected currentWorkspaceLabel(): string {
    const progressWorkspace = this.runtimeStatus?.scanProgress?.workspace || '';
    if (progressWorkspace) {
      return progressWorkspace;
    }
    const workspaces = this.workspaceOptions().filter((workspace) => workspace !== 'all');
    if (this.workspaceFilter() !== 'all') {
      return this.workspaceFilter();
    }
    if (workspaces.length === 1) {
      return workspaces[0];
    }
    return 'Current VS Code workspace';
  }

  protected evidenceResultText(): string {
    if (this.isEvidenceScanActive()) {
      return this.compactScanProgressText();
    }
    if (this.refreshState === 'error') {
      return this.refreshMessage || 'The usage evidence scan did not finish.';
    }
    if (this.refreshMessage?.toLowerCase().includes('stopped')) {
      return 'Scan stopped. Existing customization data was kept.';
    }
    if (this.customizationEvidenceSummary().hasScannedEvidence) {
      const sent = this.customizationEvidenceSummary().sent;
      const sessions = this.evidenceSessionCount();
      const matches = this.evidenceMatchCount();
      return sent
        ? `${matches.toLocaleString()} text match${matches === 1 ? '' : 'es'} across ${sessions.toLocaleString()} Copilot session${sessions === 1 ? '' : 's'}.`
        : `Checked recent Copilot requests. No customization file text was found.`;
    }
    if (!this.customizationsInput().length) {
      return 'Analyze this workspace to find customization files and check recent Copilot requests.';
    }
    return 'Analyze customizations to check whether these files appeared inside recent Copilot model requests.';
  }

  protected emptyStateTitle(): string {
    if (this.customizationsInput().length) {
      return 'No customizations match these filters';
    }
    return this.scanDiagnostics().roots > 0
      ? 'No customization files found'
      : 'No customization scan has run yet';
  }

  protected emptyStateText(): string {
    if (this.customizationsInput().length) {
      return 'Try a broader search or reset the filters.';
    }
    if (this.scanDiagnostics().roots > 0) {
      return 'Checked the current VS Code customization locations. Open Advanced scan coverage if you need to inspect the folders that were checked.';
    }
    return 'Scan this workspace to find Copilot instructions, skills, prompts, hooks, and agents, then check recent request logs for evidence.';
  }

  protected evidenceScanProgressPercent(): number {
    if (!this.isEvidenceScanActive()) {
      return 0;
    }
    const progress = this.runtimeStatus?.scanProgress;
    const index = Number(progress?.index ?? progress?.workspaceIndex ?? 0);
    const total = Number(progress?.total ?? progress?.workspaceTotal ?? 0);
    return index > 0 && total > 0 ? Math.max(1, Math.min(100, Math.round((index / total) * 100))) : 0;
  }

  protected compactScanProgressText(): string {
    if (!this.isEvidenceScanActive()) {
      return '';
    }
    const percent = this.evidenceScanProgressPercent();
    if (percent) {
      return `Analyzing recent activity · ${percent}%`;
    }
    const sessions = Number(this.runtimeStatus?.scanProgress?.sessions ?? 0);
    return sessions > 0
      ? `Analyzing recent activity · ${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'} checked`
      : 'Analyzing recent activity…';
  }

  protected isLongRunningScan(): boolean {
    const startedAt = this.runtimeStatus?.lastScanStartedAt;
    if (!startedAt || !this.isEvidenceScanActive()) {
      return false;
    }
    return Date.now() - Date.parse(startedAt) > 60_000;
  }

  protected isStaleScan(): boolean {
    const updatedAt = this.runtimeStatus?.scanProgress?.updatedAt;
    if (!updatedAt || !this.isEvidenceScanActive()) {
      return false;
    }
    return Date.now() - Date.parse(updatedAt) > 30_000;
  }

  protected evidenceSessionCount(): number {
    return new Set(
      this.customizationsInput().flatMap((customization) =>
        customization.matches.map((match) => match.sessionId),
      ),
    ).size;
  }

  protected evidenceMatchCount(): number {
    return this.customizationsInput().reduce(
      (sum, customization) => sum + this.requestOccurrenceCount(customization),
      0,
    );
  }

  protected selectCustomization(customization: CopilotCustomization): void {
    this.selectedId.set(customization.id);
  }

  protected setQuery(value: string): void {
    this.query.set(value);
    this.ensureVisibleSelection();
  }

  protected setWorkspaceFilter(value: string): void {
    this.workspaceFilter.set(value);
    this.ensureVisibleSelection();
  }

  protected setResultFilter(value: CustomizationResultFilter): void {
    this.resultFilter.set(value);
    this.ensureVisibleSelection();
  }

  protected resetFilters(): void {
    this.query.set('');
    this.workspaceFilter.set('all');
    this.resultFilter.set('all');
    this.ensureVisibleSelection();
  }

  protected fileName(customization: CopilotCustomization): string {
    return (customization.relativePath || customization.sourcePath)
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? customization.title;
  }

  protected displayTitle(customization: CopilotCustomization): string {
    const title = String(customization.title ?? '').trim();
    if (title && !this.isGenericSkillName(title, customization.kind)) {
      return title;
    }

    const metadataName = String(customization.name ?? '').trim();
    if (metadataName && !this.isGenericSkillName(metadataName, customization.kind)) {
      return this.humanizeName(metadataName);
    }

    if (customization.kind === 'skill') {
      const pathParts = (customization.relativePath || customization.sourcePath)
        .split(/[\\/]+/)
        .filter(Boolean);
      const fileIndex = pathParts.findIndex((part) => /^skill\.md$/i.test(part));
      const folderName = fileIndex > 0 ? pathParts[fileIndex - 1] : pathParts.at(-2);
      if (folderName && !/^skills?$/i.test(folderName)) {
        return this.humanizeName(folderName);
      }
    }

    return title || this.kindLabel(customization.kind);
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

  protected customizationTypeLabel(customization: CopilotCustomization): string {
    const kind = this.kindLabel(customization.kind);
    const title = this.displayTitle(customization);
    return customization.kind === 'skill' && !/^skill$/i.test(title)
      ? `${kind} (${title})`
      : kind;
  }

  protected evidenceHeadline(customization: CopilotCustomization): string {
    const requests = this.requestOccurrenceCount(customization);
    if (customization.evidenceStatus === 'sent') {
      return requests
        ? `Evidence found in ${requests.toLocaleString()} model request${requests === 1 ? '' : 's'}`
        : 'Evidence found in local request logs';
    }
    if (customization.evidenceStatus === 'listed') {
      return 'File path or read reference found';
    }
    if (customization.evidenceStatus === 'discovered') {
      return 'Discovered locally; no request text recovered';
    }
    return 'No evidence found in imported request logs';
  }

  protected statusLabel(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Evidence found',
      listed: 'Path/reference only',
      discovered: 'Discovered locally',
      not_seen: 'No local-log evidence',
    }[status];
  }

  protected statusHeadline(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'File text appeared in a model request',
      listed: 'Copilot read or referenced this file',
      discovered: 'Found locally, not seen in a request',
      not_seen: 'No evidence in imported sessions',
    }[status];
  }

  protected statusHelp(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'We found distinctive text from this file inside local VS Code request logs. The text reached a model request, but it may have arrived as customization context or as manually attached file context.',
      listed: 'Local logs show Copilot read or referenced this file, but did not show distinctive file text inside the model request.',
      discovered: 'The file exists in a known customization location, but imported model requests did not show a text match.',
      not_seen: 'The file exists locally, but imported sessions do not show local evidence for it yet.',
    }[status];
  }

  protected evidenceCountLabel(customization: CopilotCustomization): string {
    const requests = this.requestOccurrenceCount(customization);
    if (!requests) {
      return 'No requests';
    }
    return `${requests.toLocaleString()} request${requests === 1 ? '' : 's'}`;
  }

  protected groupEvidenceSummary(group: CustomizationSessionEvidence): string {
    if (group.bestStatus === 'sent') {
      const requests = this.sentModelCallCount(group);
      return `Found in ${requests.toLocaleString()} model request${requests === 1 ? '' : 's'}`;
    }
    return group.bestStatus === 'listed' ? 'File path or read reference found' : 'Discovery record found';
  }

  protected sourceLabel(source: MatchSource): string {
    if (/^system_prompt/i.test(source)) {
      return 'Instructions';
    }
    if (/^tools/i.test(source)) {
      return 'Tool list';
    }
    return {
      inputMessages: 'Complete request',
      userRequest: 'User prompt',
      copilotFileRead: 'File read',
    }[source] ?? source;
  }

  protected rawSourceLabel(source: MatchSource): string {
    return String(source);
  }

  protected callEvidence(group: CustomizationSessionEvidence): CustomizationCallEvidence[] {
    const calls = new Map<string, CustomizationCallEvidence>();
    for (const match of group.matches) {
      const key = match.modelCallNumber ? `call:${match.modelCallNumber}` : `event:${match.eventIndex}`;
      const existing = calls.get(key);
      const call =
        existing ??
        {
          key,
          callNumber: match.modelCallNumber,
          eventIndex: match.eventIndex,
          status: match.status,
          matches: [],
          sources: [],
          matchedChunks: 0,
          matchedCharacters: 0,
          matchedPreview: [],
        };
      call.matches.push(match);
      call.status = this.strongerStatus(call.status, match.status);
      call.matchedChunks += match.matchedChunks ?? 0;
      call.matchedCharacters += match.matchedCharacters ?? 0;
      for (const preview of match.matchedPreview ?? []) {
        if (preview && !call.matchedPreview.includes(preview)) {
          call.matchedPreview.push(preview);
        }
      }
      const source = {
        label: this.sourceLabel(match.source),
        raw: this.rawSourceLabel(match.source),
      };
      if (!call.sources.some((existingSource) => existingSource.label === source.label && existingSource.raw === source.raw)) {
        call.sources.push(source);
      }
      calls.set(key, call);
    }

    return [...calls.values()].sort((a, b) => {
      if (a.callNumber !== b.callNumber) {
        return b.callNumber - a.callNumber;
      }
      return b.eventIndex - a.eventIndex;
    });
  }

  protected sentCallEvidence(group: CustomizationSessionEvidence): CustomizationCallEvidence[] {
    return this.callEvidence(group).filter((call) => call.status === 'sent');
  }

  protected callEvidenceTitle(call: CustomizationCallEvidence): string {
    const target = call.callNumber ? `Request #${call.callNumber}` : `Event #${call.eventIndex}`;
    if (call.status === 'sent') {
      return `${target}: file text found`;
    }
    if (call.status === 'listed') {
      return `${target}: read or referenced`;
    }
    return `${target}: ${this.statusLabel(call.status).toLowerCase()}`;
  }

  protected callEvidenceSummary(call: CustomizationCallEvidence): string {
    if (call.status === 'sent') {
      const count = call.matchedCharacters.toLocaleString();
      return call.matchedCharacters >= 600
        ? `Large text match detected. A representative excerpt is shown below. Approximate matched content: ${count} characters.`
        : `Distinctive file text appeared in this Copilot request. Approximate matched content: ${count} characters.`;
    }
    if (call.status === 'listed') {
      return 'Copilot read or referenced this file, but local logs did not show distinctive file text inside this model request.';
    }
    return 'No request payload content was verified for this event.';
  }

  protected shortEvidenceExcerpt(call: CustomizationCallEvidence): string {
    const excerpt = String(call.matchedPreview[0] ?? '').replace(/\s+/g, ' ').trim();
    return excerpt.length > 240 ? `${excerpt.slice(0, 237).trimEnd()}…` : excerpt;
  }

  protected selectedDiagnosticSources(): EvidenceSource[] {
    const customization = this.selectedCustomization();
    if (!customization) {
      return [];
    }
    return this.uniqueSources(
      customization.matches.map((match) => ({
        label: this.sourceLabel(match.source),
        raw: this.rawSourceLabel(match.source),
      })),
    );
  }

  protected weakEvidenceExplanation(group: CustomizationSessionEvidence): string {
    if (group.bestStatus === 'listed') {
      return 'Only the file path or a file-read reference was visible. The file contents were not available in the request logs for comparison.';
    }
    if (group.bestStatus === 'discovered') {
      return 'VS Code reported the file during customization discovery, but no matching text snippet could be recovered from imported request logs.';
    }
    return 'No matching text snippet could be recovered from the imported logs.';
  }

  private uniqueSources(sources: EvidenceSource[]): EvidenceSource[] {
    const seen = new Set<string>();
    const unique = [];
    for (const source of sources) {
      const key = `${source.label}:${source.raw}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(source);
    }
    return unique;
  }

  private sentModelCallCount(group: CustomizationSessionEvidence): number {
    return new Set(
      group.matches
        .filter((match) => match.status === 'sent')
        .map((match) => match.modelCallNumber)
        .filter(Boolean),
    ).size;
  }

  protected diagnosticKindLabel(kind: string): string {
    return {
      candidate: 'Candidate root',
      root: 'Folder',
      file: 'File',
      'debug-reference': 'Debug reference',
      'debug-discovery-root': 'VS Code discovery',
      'vscode-setting-root': 'VS Code setting',
      'vscode-default-root': 'VS Code default',
      'vscode-user-setting-root': 'User setting',
      'vscode-workspace-setting-root': 'Workspace setting',
      'vscode-workspace-folder-setting-root': 'Workspace-folder setting',
      'vscode-parent-repo-default-root': 'Parent repo default',
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

  private statusRank(status: CopilotCustomizationEvidenceStatus): number {
    return { not_seen: 0, discovered: 1, listed: 2, sent: 3 }[status];
  }

  private evidenceSortCount(customization: CopilotCustomization): number {
    return this.requestOccurrenceCount(customization);
  }

  private requestOccurrenceCount(customization: CopilotCustomization): number {
    return new Set(
      customization.matches
        .filter((match) => match.status === 'sent')
        .map((match) => `${match.sessionId}:${match.modelCallNumber || `event-${match.eventIndex}`}`),
    ).size;
  }

  private isGenericSkillName(value: string, kind: CopilotCustomizationKind): boolean {
    return kind === 'skill' && /^(?:skill|skill\.md)$/i.test(value.trim());
  }

  private humanizeName(value: string): string {
    return value
      .replace(/\.md$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private matchesResultFilter(
    customization: CopilotCustomization,
    filter: CustomizationResultFilter,
  ): boolean {
    if (filter === 'all') return true;
    if (filter === 'evidence') return customization.evidenceStatus === 'sent';
    if (filter === 'none') return customization.evidenceStatus === 'not_seen';
    if (filter === 'partial') return ['listed', 'discovered'].includes(customization.evidenceStatus);
    if (filter === 'rule') {
      const path = `${customization.relativePath} ${customization.sourcePath}`.replace(/\\/g, '/').toLowerCase();
      return customization.kind === 'instruction' && (path.includes('/rules/') || path.includes('.rules.'));
    }
    return customization.kind === filter;
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
