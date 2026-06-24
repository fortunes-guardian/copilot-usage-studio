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

type CustomizationKindFilter = 'all' | CopilotCustomizationKind;
type CustomizationStatusFilter = 'all' | CopilotCustomizationEvidenceStatus;
type MatchSource = 'inputMessages' | 'userRequest' | string;
type EvidenceSource = {
  label: string;
  raw: string;
};
type EvidenceTimelineMarker = {
  callNumber: number;
  status: CopilotCustomizationEvidenceStatus;
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

  protected readonly customizationEvidenceSummary = computed(() => {
    const ingestion = this.ingestionInput();
    const customizations = this.customizationsInput();
    const sent = customizations.filter((item) => item.evidenceStatus === 'sent').length;
    const notProved = customizations.filter((item) => item.evidenceStatus === 'listed').length;
    const hasScannedEvidence = (ingestion?.customizationEvidenceScannedSessions ?? 0) > 0;
    return {
      sent,
      notProved,
      hasScannedEvidence,
      label: hasScannedEvidence
        ? `${sent.toLocaleString()} proved sent · ${notProved.toLocaleString()} not proved`
        : 'Detailed evidence skipped',
    };
  });

  protected scanActionLabel(): string {
    if (this.refreshState === 'refreshing') {
      return 'Scanning...';
    }
    return this.customizationEvidenceSummary().hasScannedEvidence
      ? 'Find usage evidence again'
      : 'Find usage evidence';
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

  protected evidenceStateLabel(): string {
    if (this.isEvidenceScanActive()) {
      return 'Checking now';
    }
    if (this.refreshState === 'error') {
      return 'Scan failed';
    }
    if (this.refreshMessage?.toLowerCase().includes('stopped')) {
      return 'Scan stopped';
    }
    if (this.customizationEvidenceSummary().hasScannedEvidence) {
      return this.customizationEvidenceSummary().sent > 0 ? 'Usage evidence found' : 'No usage evidence found';
    }
    return 'Not checked yet';
  }

  protected evidenceResultText(): string {
    if (this.isEvidenceScanActive()) {
      return this.currentScanStep();
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
      return sent
        ? `${sent.toLocaleString()} customization${sent === 1 ? '' : 's'} had file text found in recent Copilot requests across ${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'}.`
        : `Checked recent Copilot requests. No customization file text was found.`;
    }
    return 'Run Find usage evidence to check whether these files appeared inside recent Copilot model requests.';
  }

  protected currentScanStep(): string {
    const stage = this.runtimeStatus?.scanProgress?.stage ?? '';
    if (stage === 'customizations' || stage === 'workspace' || stage === 'workspace-state') {
      return 'Step 1 of 3: Loading customization files';
    }
    if (stage === 'customization-evidence' || stage === 'debug-logs') {
      return 'Step 2 of 3: Checking recent Copilot sessions';
    }
    if (stage === 'complete') {
      return 'Step 3 of 3: Summarising matches';
    }
    return 'Preparing current workspace scan';
  }

  protected elapsedScanLabel(): string {
    const startedAt = this.runtimeStatus?.lastScanStartedAt;
    if (!startedAt || !this.isEvidenceScanActive()) {
      return '';
    }
    return this.durationLabel(Date.now() - Date.parse(startedAt));
  }

  protected lastProgressLabel(): string {
    const updatedAt = this.runtimeStatus?.scanProgress?.updatedAt;
    if (!updatedAt || !this.isEvidenceScanActive()) {
      return '';
    }
    return this.durationLabel(Date.now() - Date.parse(updatedAt));
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
      (sum, customization) => sum + customization.matches.filter((match) => match.status === 'sent').length,
      0,
    );
  }

  private durationLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
      return '';
    }
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) {
      return `${seconds}s`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

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
      listed: 'Not proved sent',
      discovered: 'Discovered',
      not_seen: 'Not seen',
    }[status];
  }

  protected statusHeadline(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'This content reached the model',
      listed: 'Not proved sent',
      discovered: 'Found during setup, not seen in a request',
      not_seen: 'No evidence in imported sessions',
    }[status];
  }

  protected statusHelp(status: CopilotCustomizationEvidenceStatus): string {
    return {
      sent: 'Distinctive text from this file appeared inside the material VS Code sent to a model. This is the strongest local evidence.',
      listed: 'VS Code request material named this file or one of its labels, but the scanner did not find distinctive file text.',
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
    const calls = group.modelCallNumbers.length;
    if (group.bestStatus === 'sent') {
      const sentCalls = this.sentModelCallCount(group);
      return sentCalls
        ? `File text found in ${sentCalls.toLocaleString()} model call${sentCalls === 1 ? '' : 's'}`
        : 'Content found in model material';
    }
    if (group.bestStatus === 'listed') {
      return calls
        ? `No file text found; only names/paths appeared`
        : 'No file text found';
    }
    if (group.bestStatus === 'discovered') {
      return 'Found during setup or discovery';
    }
    return 'No imported evidence';
  }

  protected sourceLabel(source: MatchSource): string {
    if (/^system_prompt/i.test(source)) {
      return 'System instructions';
    }
    if (/^tools/i.test(source)) {
      return 'Tool definitions';
    }
    return {
      inputMessages: 'Full model request',
      userRequest: 'User message',
    }[source] ?? source;
  }

  protected rawSourceLabel(source: MatchSource): string {
    return String(source);
  }

  protected sessionEvidenceLabel(group: CustomizationSessionEvidence): string {
    const calls = group.modelCallNumbers.length;
    if (!calls) {
      return group.bestStatus === 'sent' ? 'Content found' : this.statusLabel(group.bestStatus);
    }
    if (group.bestStatus !== 'sent') {
      return 'Not proved sent';
    }
    const sentCalls = this.sentModelCallCount(group);
    const label = sentCalls === 1 ? 'model call' : 'model calls';
    return `File text found in ${sentCalls.toLocaleString()} ${label}`;
  }

  protected timelineMarkers(group: CustomizationSessionEvidence): EvidenceTimelineMarker[] {
    const markers = new Map<number, CopilotCustomizationEvidenceStatus>();
    for (const match of group.matches) {
      if (!match.modelCallNumber) {
        continue;
      }
      const current = markers.get(match.modelCallNumber) ?? 'not_seen';
      markers.set(match.modelCallNumber, this.strongerStatus(current, match.status));
    }
    return [...markers.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, status]) => group.bestStatus !== 'sent' || status === 'sent')
      .slice(0, 18)
      .map(([callNumber, status]) => ({ callNumber, status }));
  }

  protected timelineOverflow(group: CustomizationSessionEvidence): number {
    const distinctCalls = new Set(
      group.matches
        .filter((match) => group.bestStatus !== 'sent' || match.status === 'sent')
        .map((match) => match.modelCallNumber)
        .filter(Boolean),
    );
    return Math.max(0, distinctCalls.size - 18);
  }

  protected timelineMarkerLabel(marker: EvidenceTimelineMarker): string {
    return marker.status === 'sent'
      ? `Model call #${marker.callNumber}: content found in prompt material`
      : `Model call #${marker.callNumber}: file text not proved`;
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
    const target = call.callNumber ? `Model call #${call.callNumber}` : `Event #${call.eventIndex}`;
    if (call.status === 'sent') {
      return `${target}: content found`;
    }
    if (call.status === 'listed') {
      return `${target}: not proved sent`;
    }
    return `${target}: ${this.statusLabel(call.status).toLowerCase()}`;
  }

  protected callEvidenceSummary(call: CustomizationCallEvidence): string {
    if (call.status === 'sent') {
      return `Actual text from this customization file appeared in ${this.sourcePhrase(call.sources)}.`;
    }
    if (call.status === 'listed') {
      return 'Only the file name/path or one of its labels was seen. Treat this as not proved sent.';
    }
    return 'No request payload content was verified for this event.';
  }

  protected weakEvidenceSummary(group: CustomizationSessionEvidence): string {
    const calls = group.modelCallNumbers.length;
    const sources = this.uniqueSources(group.sources.map((source) => ({
      label: this.sourceLabel(source),
      raw: this.rawSourceLabel(source),
    })));
    const sourceText = sources.length ? ` Checked ${this.sourcePhrase(sources)}.` : '';
    return calls
      ? `Checked ${calls.toLocaleString()} model call${calls === 1 ? '' : 's'} in this session. The scanner did not find distinctive text from this file in those requests.${sourceText}`
      : `The scanner did not find distinctive text from this file in imported request material.${sourceText}`;
  }

  protected evidenceSourceLabels(call: CustomizationCallEvidence): string[] {
    return this.uniqueSources(call.sources).map((source) => source.label);
  }

  protected rawEvidenceSources(call: CustomizationCallEvidence): EvidenceSource[] {
    return this.uniqueSources(call.sources);
  }

  protected evidenceDetailsSummary(call: CustomizationCallEvidence): string {
    const parts = [];
    if (call.callNumber) {
      parts.push(`model call #${call.callNumber}`);
    }
    if (call.matchedCharacters) {
      parts.push(`${call.matchedCharacters.toLocaleString()} matched characters`);
    }
    return parts.join(' · ') || 'raw matching details';
  }

  private sourcePhrase(sources: EvidenceSource[]): string {
    const labels = this.uniqueSources(sources).map((source) => source.label);
    if (!labels.length) {
      return 'the model request';
    }
    if (labels.length === 1) {
      return labels[0].toLowerCase();
    }
    if (labels.length === 2) {
      return `${labels[0].toLowerCase()} and ${labels[1].toLowerCase()}`;
    }
    return `${labels.slice(0, -1).map((label) => label.toLowerCase()).join(', ')}, and ${labels.at(-1)?.toLowerCase()}`;
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
