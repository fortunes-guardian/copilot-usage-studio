import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  LocalRuntimeStatus,
  SessionDataLoadState,
  SessionDataRefreshState,
} from './session-data.service';

interface WorkspaceOutcome {
  title: string;
  subtitle: string;
  status: 'scanning' | 'complete' | 'pending' | 'warning';
  findings: string;
}

@Component({
  selector: 'app-session-data-state-panel',
  imports: [DecimalPipe],
  templateUrl: './session-data-state-panel.component.html',
  styleUrl: './session-data-state-panel.component.css',
})
export class SessionDataStatePanelComponent {
  @Input({ required: true }) state!: SessionDataLoadState;
  @Input() error: string | null = null;
  @Input() refreshState: SessionDataRefreshState = 'idle';
  @Input() runtimeStatus: LocalRuntimeStatus | null = null;
  @Input() runtimeStatusAvailable = false;
  @Output() refresh = new EventEmitter<void>();
  @Output() cancelScan = new EventEmitter<void>();

  protected get isEmptyState(): boolean {
    return this.error?.toLowerCase().includes('no session data is available') ?? false;
  }

  protected get scanElapsedLabel(): string {
    const startedAt = this.runtimeStatus?.lastScanStartedAt;
    if (!startedAt) {
      return '';
    }

    const elapsedMs = this.runtimeStatus?.scanning
      ? Date.now() - Date.parse(startedAt)
      : (this.runtimeStatus?.lastScanDurationMs ?? 0);
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return '';
    }

    const seconds = Math.round(elapsedMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  protected get isScanning(): boolean {
    return this.runtimeStatus?.scanning === true || this.refreshState === 'refreshing';
  }

  protected get showPanelActions(): boolean {
    return this.isScanning || this.state !== 'ready';
  }

  protected get statusTitle(): string {
    if (this.isScanning) {
      return 'Scanning VS Code Copilot data';
    }
    if (this.refreshState === 'success') {
      return 'Scan complete';
    }
    if (this.refreshState === 'error') {
      return 'Scan did not finish';
    }
    if (this.state === 'error' && this.isEmptyState) {
      return 'No local sessions imported yet';
    }
    if (this.state === 'error') {
      return 'Could not load local session data';
    }
    return 'Reading local sessions';
  }

  protected get statusBody(): string {
    if (this.isScanning) {
      return this.currentWorkspaceLabel
        ? `Checking ${this.currentWorkspaceLabel}. Existing imported data stays visible while the scan runs.`
        : 'Checking local VS Code Copilot usage, memories, and customization files. Existing imported data stays visible while the scan runs.';
    }
    if (this.refreshState === 'success') {
      return 'Local VS Code Copilot data was refreshed.';
    }
    if (this.refreshState === 'error') {
      return this.runtimeStatus?.lastError || this.error || 'The scan stopped before fresh data was imported.';
    }
    if (this.state === 'error' && this.isEmptyState) {
      return 'Scan this computer for local VS Code Copilot usage, memories, and sessions.';
    }
    return this.error || 'Checking the local Copilot data imported by the runtime.';
  }

  protected get scanStatusLabel(): string {
    if (this.isScanning) {
      return this.scanElapsedLabel ? `Started ${this.scanElapsedLabel} ago` : 'Started just now';
    }
    if (this.runtimeStatus?.lastError && this.refreshState === 'error') {
      return this.scanElapsedLabel ? `Stopped after ${this.scanElapsedLabel}` : 'Stopped before completion';
    }
    if (this.runtimeStatus?.lastScanCompletedAt) {
      return this.scanElapsedLabel ? `Last scan took ${this.scanElapsedLabel}` : 'Last scan complete';
    }
    return 'No completed scan yet';
  }

  protected get currentWorkspaceLabel(): string {
    const progress = this.runtimeStatus?.scanProgress;
    return progress?.workspace || progress?.workspaceDir || '';
  }

  protected get progressLabel(): string {
    const progress = this.runtimeStatus?.scanProgress;
    const index = Number(progress?.workspaceIndex ?? progress?.index ?? 0);
    const total = Number(progress?.workspaceTotal ?? progress?.total ?? 0);
    if (this.runtimeStatus?.activeScanMode === 'customizations') {
      if (this.currentWorkspaceLabel) {
        return total > 1 ? `Current workspace storage ${index.toLocaleString()} of ${total.toLocaleString()}` : 'Current workspace';
      }
      if (progress?.stage === 'workspace-scope' && total === 0) {
        return 'No current workspace matched';
      }
    }
    if (index > 0 && total > 0) {
      return `Workspace ${index.toLocaleString()} of ${total.toLocaleString()}`;
    }
    return this.friendlyStageLabel(progress?.stage);
  }

  protected get progressPercent(): number {
    const progress = this.runtimeStatus?.scanProgress;
    const index = Number(progress?.workspaceIndex ?? progress?.index ?? 0);
    const total = Number(progress?.workspaceTotal ?? progress?.total ?? 0);
    return index > 0 && total > 0 ? Math.max(1, Math.min(100, Math.round((index / total) * 100))) : 0;
  }

  protected get foundSoFar() {
    const workspaces = this.runtimeStatus?.workspaceProgress ?? [];
    const sessionSum = workspaces.reduce((sum, workspace) => sum + Number(workspace.sessions ?? 0), 0);
    const memorySum = workspaces.reduce((sum, workspace) => sum + Number(workspace.memories ?? 0), 0);
    const customizations = workspaces.reduce(
      (sum, workspace) => sum + Number(workspace.customizations ?? workspace.customizationInventory ?? 0),
      0,
    );
    const sessions = Math.max(
      this.runtimeStatus?.sessionCount ?? 0,
      sessionSum,
    );
    const memories = Math.max(
      this.runtimeStatus?.memoryCount ?? 0,
      memorySum,
    );
    const chatSnapshots = workspaces.reduce((sum, workspace) => sum + Number(workspace.chatSnapshots ?? 0), 0);
    const debugLogFolders = workspaces.reduce((sum, workspace) => sum + Number(workspace.debugLogFolders ?? 0), 0);
    const checkedWorkspaces = workspaces.filter((workspace) => workspace.completed).length;
    const totalWorkspaces = Math.max(
      Number(this.runtimeStatus?.scanProgress?.workspaceTotal ?? 0),
      ...workspaces.map((workspace) => Number(workspace.workspaceTotal ?? 0)),
      workspaces.length,
    );
    return { sessions, memories, chatSnapshots, debugLogFolders, customizations, checkedWorkspaces, totalWorkspaces };
  }

  protected get scanModeLabel(): string {
    const mode = this.runtimeStatus?.activeScanMode;
    return mode === 'customizations'
      ? 'Customization usage'
      : mode === 'full'
        ? 'Full scan'
        : 'Quick scan';
  }

  protected get recentLogs() {
    return this.runtimeStatus?.recentLogs?.slice(-6) ?? [];
  }

  protected get workspaceOutcomes(): WorkspaceOutcome[] {
    const workspaces = this.runtimeStatus?.workspaceProgress ?? [];
    return workspaces.slice(-6).reverse().map((workspace) => {
      const title = workspace.workspace || workspace.workspaceDir || 'VS Code workspace';
      const debugLogFolders = Number(workspace.debugLogFolders ?? 0);
      const chatSnapshots = Number(workspace.chatSnapshots ?? 0);
      const sessions = Number(workspace.sessions ?? 0);
      const memories = Number(workspace.memories ?? 0);
      const customizations = Number(workspace.customizations ?? workspace.customizationInventory ?? 0);
      const findings = [
        sessions ? `${sessions.toLocaleString()} session${sessions === 1 ? '' : 's'}` : '',
        debugLogFolders ? `${debugLogFolders.toLocaleString()} debug-log folder${debugLogFolders === 1 ? '' : 's'}` : '',
        chatSnapshots ? `${chatSnapshots.toLocaleString()} chat snapshot${chatSnapshots === 1 ? '' : 's'}` : '',
        memories ? `${memories.toLocaleString()} memor${memories === 1 ? 'y' : 'ies'}` : '',
        customizations ? `${customizations.toLocaleString()} customization${customizations === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · ');

      return {
        title,
        subtitle: this.friendlyStageLabel(workspace.lastStage),
        status: workspace.completed
          ? (sessions || debugLogFolders || chatSnapshots || memories || customizations ? 'complete' : 'warning')
          : 'scanning',
        findings: findings || 'No Copilot data found here yet',
      };
    });
  }

  protected get scanAdvice(): string {
    if (this.isScanning) {
      if (this.runtimeStatus?.activeScanMode === 'customizations') {
        return this.currentWorkspaceLabel
          ? 'Checking whether current-workspace customizations appeared in recent model requests.'
          : 'Looking for the current VS Code workspace before checking customization usage.';
      }
      return this.foundSoFar.totalWorkspaces > 20
        ? 'Large VS Code profiles can take a few minutes. You can stop the scan and keep the last imported snapshot.'
        : 'The page will update when the scan finishes.';
    }

    if (this.foundSoFar.sessions === 0 && this.foundSoFar.chatSnapshots > 0) {
      return 'Only fallback chat records were found. Enable Agent Debug Log file logging for exact model-call usage.';
    }

    if (this.foundSoFar.sessions === 0) {
      return 'No sessions have been imported yet. Run a scan after using Copilot Chat or Agent mode in VS Code.';
    }

    return 'Data is loaded from local VS Code files. Run another scan after new Copilot activity.';
  }

  private friendlyStageLabel(stage?: string): string {
    return {
      starting: 'Starting scan',
      roots: 'Finding VS Code data',
      workspaces: 'Finding VS Code history',
      workspace: 'Checking VS Code storage entry',
      'workspace-state': 'Reading saved workspace metadata',
      customizations: 'Finding Copilot customization files',
      'customization-evidence': 'Checking whether customization text reached the model',
      'chat-snapshots': 'Checking chat snapshots',
      'workspace-complete': 'Storage entry complete',
      complete: 'Scan complete',
      failed: 'Scan failed',
    }[stage ?? ''] ?? 'Preparing scan';
  }
}


