import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  LocalRuntimeStatus,
  SessionDataLoadState,
  SessionDataRefreshState,
} from './session-data.service';

@Component({
  selector: 'app-session-data-state-panel',
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

  protected get recentLogs() {
    return this.runtimeStatus?.recentLogs?.slice(-6) ?? [];
  }
}


