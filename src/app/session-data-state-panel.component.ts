import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  LocalRuntimeStatus,
  SessionDataLoadState,
  SessionDataRefreshState,
} from './session-data.service';

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

  protected get statusTitle(): string {
    if (this.isScanning) {
      return 'Scanning local Copilot data';
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
        ? `Checking ${this.currentWorkspaceLabel}. You can stop the scan and keep existing data.`
        : 'Checking VS Code local Copilot data. You can stop the scan and keep existing data.';
    }
    if (this.state === 'error' && this.isEmptyState) {
      return 'Scan this computer for local VS Code Copilot usage, memories, and sessions.';
    }
    return this.error || 'Checking the local Copilot data imported by the runtime.';
  }

  protected get scanStatusLabel(): string {
    if (this.isScanning) {
      return this.scanElapsedLabel ? `Started ${this.scanElapsedLabel} ago` : 'Starting now';
    }
    if (this.runtimeStatus?.lastScanCompletedAt) {
      return this.scanElapsedLabel ? `Last completed scan: ${this.scanElapsedLabel}` : 'Last completed scan';
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
    const sessions = Math.max(
      this.runtimeStatus?.sessionCount ?? 0,
      ...workspaces.map((workspace) => Number(workspace.sessions ?? 0)),
    );
    const memories = Math.max(
      this.runtimeStatus?.memoryCount ?? 0,
      ...workspaces.map((workspace) => Number(workspace.memories ?? 0)),
    );
    const chatSnapshots = workspaces.reduce((sum, workspace) => sum + Number(workspace.chatSnapshots ?? 0), 0);
    const debugLogFolders = workspaces.reduce((sum, workspace) => sum + Number(workspace.debugLogFolders ?? 0), 0);
    return { sessions, memories, chatSnapshots, debugLogFolders };
  }

  protected get scanModeLabel(): string {
    const mode = this.runtimeStatus?.activeScanMode;
    return mode === 'customizations'
      ? 'Customization evidence'
      : mode === 'full'
        ? 'Full scan'
        : 'Quick scan';
  }

  protected get recentLogs() {
    return this.runtimeStatus?.recentLogs?.slice(-6) ?? [];
  }

  private friendlyStageLabel(stage?: string): string {
    return {
      starting: 'Starting scan',
      roots: 'Finding VS Code data',
      workspaces: 'Finding workspaces',
      workspace: 'Checking workspace',
      'workspace-state': 'Reading workspace metadata',
      customizations: 'Finding customizations',
      'customization-evidence': 'Checking customization evidence',
      'chat-snapshots': 'Checking chat snapshots',
      'workspace-complete': 'Workspace complete',
      complete: 'Scan complete',
      failed: 'Scan failed',
    }[stage ?? ''] ?? 'Preparing scan';
  }
}


