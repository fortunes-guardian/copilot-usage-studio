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
    const hasScannedEvidence = (ingestion?.customizationEvidenceScannedSessions ?? 0) > 0;
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
    if (this.customizationScanTimedOut()) {
      return 'Scan timed out';
    }
    if (this.customizationScanCapped()) {
      return 'Partial results';
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
    if (this.customizationScanTimedOut()) {
      return 'The usage evidence scan reached its time limit. Partial results were kept so the app does not hang.';
    }
    if (this.customizationScanCapped()) {
      return this.customizationScanLimitText();
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

  protected evidenceMetricLabel(): string {
    return this.isEvidenceScanActive() ? 'Matches so far' : 'Last result';
  }

  protected evidenceMetricText(): string {
    const matches = this.isEvidenceScanActive()
      ? Number(this.runtimeStatus?.scanProgress?.matches ?? this.evidenceMatchCount())
      : this.evidenceMatchCount();
    return `${matches.toLocaleString()} text match${matches === 1 ? '' : 'es'}`;
  }

  protected activeScanStats(): string {
    if (!this.isEvidenceScanActive()) {
      return '';
    }
    const progress = this.runtimeStatus?.scanProgress;
    const sessions = Number(progress?.sessions ?? 0);
    const calls = Number(progress?.modelCalls ?? 0);
    const parts = [
      sessions > 0 ? `${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'} checked` : '',
      calls > 0 ? `${calls.toLocaleString()} model call${calls === 1 ? '' : 's'} checked` : '',
      this.evidenceMetricText(),
    ].filter(Boolean);
    return parts.join(' · ');
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

  private customizationScanWarnings(): string[] {
    return (this.ingestionInput()?.warnings ?? []).filter((warning) =>
      String(warning).toLowerCase().includes('customization evidence scan'),
    );
  }

  private customizationScanCapReason(): string {
    return String(this.ingestionInput()?.customizationEvidenceCapReason ?? '').trim();
  }

  private customizationScanTimedOut(): boolean {
    return (
      this.customizationScanCapReason().toLowerCase().includes('stopped after') ||
      this.customizationScanWarnings().some((warning) => warning.toLowerCase().includes('stopped after'))
    );
  }

  private customizationScanCapped(): boolean {
    return Boolean(this.customizationScanCapReason()) || this.customizationScanWarnings().some((warning) =>
      /limited to|stopped early|stopped after/i.test(warning),
    );
  }

  protected isPartialEvidenceResult(): boolean {
    return this.customizationScanTimedOut() || this.customizationScanCapped();
  }

  private customizationScanLimitText(): string {
    const reason = this.customizationScanCapReason();
    const scannedCalls = this.ingestionInput()?.customizationEvidenceModelCalls ?? 0;
    const scannedSessions = this.ingestionInput()?.customizationEvidenceScannedSessions ?? 0;
    if (reason.includes('model calls')) {
      return `Checked ${scannedCalls.toLocaleString()} model requests across ${scannedSessions.toLocaleString()} session${scannedSessions === 1 ? '' : 's'} and stopped at the safety limit. The matches shown are real, but older or later matches may be missing.`;
    }
    if (reason.includes('stopped after')) {
      return `Checked for ${reason.replace('stopped after ', '')} and stopped at the time limit. The matches shown are real, but the scan may be incomplete.`;
    }
    return 'The evidence scan reached a safety limit. The matches shown are real, but some matches may be missing.';
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
      sent: 'Text match found',
      listed: 'Read by Copilot',
      discovered: 'Discovered',
      not_seen: 'Not seen',
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
    const sessions = new Set(customization.matches.map((match) => match.sessionId)).size;
    if (!customization.matches.length) {
      return 'No sessions';
    }
    return `${this.isPartialEvidenceResult() ? 'At least ' : ''}${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'}`;
  }

  protected evidenceGroupSubtitle(group: CustomizationSessionEvidence): string {
    const calls = group.modelCallNumbers.length;
    if (group.bestStatus === 'sent') {
      const sentCalls = this.sentModelCallCount(group);
      return sentCalls
        ? `${this.isPartialEvidenceResult() ? 'At least ' : ''}${sentCalls.toLocaleString()} text-matched request${sentCalls === 1 ? '' : 's'}`
        : 'Text match found';
    }
    if (group.bestStatus === 'listed') {
      return calls
        ? `Read or referenced, but no file text found`
        : 'Read or referenced';
    }
    if (group.bestStatus === 'discovered') {
      return 'Found during setup or discovery';
    }
    return 'No imported evidence';
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

  protected sourceHelp(source: EvidenceSource): string {
    if (/^system_prompt/i.test(source.raw)) {
      return 'Matched inside the instruction/system part of a VS Code request. This is usually where custom instructions and skills appear.';
    }
    if (/^tools/i.test(source.raw)) {
      return 'Matched near the tool definitions included with the request. This can include tool or MCP schema material.';
    }
    if (source.raw === 'inputMessages') {
      return 'Matched somewhere in the full request payload visible in VS Code logs. This is useful as broad local confirmation that the text appeared.';
    }
    if (source.raw === 'userRequest') {
      return 'Matched in the user-facing prompt/request material for this model call.';
    }
    if (source.raw === 'copilotFileRead') {
      return 'VS Code logs show Copilot read this customization file. This is useful evidence, but it does not prove the file text was sent to the model.';
    }
    return 'Matched in this VS Code debug-log source. Open the technical proof section if you need the raw field name.';
  }

  protected rawSourceLabel(source: MatchSource): string {
    return String(source);
  }

  protected sessionEvidenceLabel(group: CustomizationSessionEvidence): string {
    const calls = group.modelCallNumbers.length;
    if (!calls) {
      return group.bestStatus === 'sent' ? 'Text match found' : this.statusLabel(group.bestStatus);
    }
    if (group.bestStatus !== 'sent') {
      return 'Read or referenced';
    }
    const sentCalls = this.sentModelCallCount(group);
    const label = sentCalls === 1 ? 'request' : 'requests';
    return `${this.isPartialEvidenceResult() ? 'At least ' : ''}${sentCalls.toLocaleString()} text-matched ${label}`;
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
      ? `Model request #${marker.callNumber}: this file's text was included`
      : `Model request #${marker.callNumber}: file text not proved`;
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
      return `We found actual text from this customization in ${this.sourcePhrase(call.sources)}.`;
    }
    if (call.status === 'listed') {
      return 'Copilot read or referenced this file, but local logs did not show distinctive file text inside this model request.';
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

  protected groupDetailSummary(group: CustomizationSessionEvidence): string {
    if (group.bestStatus === 'sent') {
      const calls = this.sentModelCallCount(group);
      const label = calls === 1 ? 'model request' : 'model requests';
      return `Text from this file was found in ${calls.toLocaleString()} ${label}. This proves request visibility, not whether the text came from automatic customization loading or manual file context.`;
    }
    if (group.bestStatus === 'listed') {
      return 'This session shows Copilot read or referenced the file, but local logs did not show distinctive file text in model-request material.';
    }
    if (group.bestStatus === 'discovered') {
      return 'VS Code setup/discovery mentioned this file, but imported model requests did not show file text.';
    }
    return 'No visible request evidence was imported for this session.';
  }

  protected evidenceSourceLabels(call: CustomizationCallEvidence): string[] {
    return this.uniqueSources(call.sources).map((source) => source.label);
  }

  protected evidenceSources(call: CustomizationCallEvidence): EvidenceSource[] {
    return this.uniqueSources(call.sources);
  }

  protected rawEvidenceSources(call: CustomizationCallEvidence): EvidenceSource[] {
    return this.uniqueSources(call.sources);
  }

  protected evidenceDetailsSummary(call: CustomizationCallEvidence): string {
    const parts = [];
    if (call.callNumber) {
      parts.push(`request #${call.callNumber}`);
    }
    if (call.matchedCharacters) {
      parts.push(`${call.matchedCharacters.toLocaleString()} characters matched`);
    }
    return parts.join(' · ') || 'raw debug-log proof';
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
