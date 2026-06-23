import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import { SessionData } from './session-data.model';
import { apiUrl } from './host-config';

export type SessionDataLoadState = 'loading' | 'ready' | 'error';
export type SessionDataRefreshState = 'idle' | 'refreshing' | 'success' | 'error';
export type SessionDataScanMode = 'quick' | 'full' | 'customizations';

interface LocalScanResponse {
  sessionData: SessionData;
  status?: LocalRuntimeStatus;
}

export interface LocalRuntimeLogEntry {
  at: string;
  level: 'log' | 'warn' | 'error' | string;
  message: string;
}

export interface LocalRuntimeStatus {
  phase: string;
  scanning: boolean;
  hasData: boolean;
  sessionCount: number;
  memoryCount: number;
  generatedAt: string;
  lastScanStartedAt: string;
  lastScanCompletedAt: string;
  lastScanDurationMs: number;
  lastError: string;
  activeScanId?: number;
  activeScanMode?: SessionDataScanMode | string;
  logFile?: string;
  scanProgress?: {
    stage?: string;
    message?: string;
    scanId?: number;
    reason?: string;
    updatedAt?: string;
    workspace?: string;
    workspaceDir?: string;
    workspaceIndex?: number;
    workspaceTotal?: number;
    index?: number;
    total?: number;
    sessions?: number;
  } | null;
  recentLogs?: LocalRuntimeLogEntry[];
  progressHistory?: Array<LocalRuntimeStatus['scanProgress']>;
  workspaceProgress?: Array<{
    workspace?: string;
    workspaceDir?: string;
    workspaceIndex?: number | null;
    workspaceTotal?: number | null;
    lastStage?: string;
    message?: string;
    debugLogFolders?: number | null;
    chatSnapshots?: number | null;
    hasMemoryRoot?: boolean | null;
    customizationInventory?: number | null;
    sessions?: number | null;
    memories?: number | null;
    customizations?: number | null;
    completed?: boolean;
  }>;
}

@Injectable({ providedIn: 'root' })
export class SessionDataService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly sessionData = signal<SessionData | null>(null);
  readonly loadState = signal<SessionDataLoadState>('loading');
  readonly loadError = signal<string | null>(null);
  readonly refreshState = signal<SessionDataRefreshState>('idle');
  readonly refreshMessage = signal<string | null>(null);
  readonly runtimeStatus = signal<LocalRuntimeStatus | null>(null);
  readonly runtimeStatusAvailable = signal(false);

  constructor() {
    const initialStatusTimer = setTimeout(() => this.pollRuntimeStatus(), 500);
    const statusTimer = setInterval(() => {
      if (
        this.loadState() === 'loading' ||
        this.loadState() === 'error' ||
        this.refreshState() === 'refreshing'
      ) {
        this.pollRuntimeStatus();
      }
    }, 1500);
    this.destroyRef.onDestroy(() => {
      clearTimeout(initialStatusTimer);
      clearInterval(statusTimer);
    });

    this.loadSessionData();
  }

  refresh(mode: SessionDataScanMode = 'quick'): void {
    if (this.refreshState() === 'refreshing') {
      return;
    }

    this.refreshState.set('refreshing');
    this.refreshMessage.set(mode === 'customizations' ? 'Scanning customization evidence...' : 'Scanning local Copilot data...');
    this.http.post<LocalScanResponse>(apiUrl('/api/scan'), { mode }).subscribe({
      next: ({ sessionData, status }) => {
        if (status) {
          this.runtimeStatus.set(status);
          this.runtimeStatusAvailable.set(true);
        }
        this.sessionData.set(sessionData);
        this.loadState.set('ready');
        this.loadError.set(null);
        this.refreshState.set('success');
        this.refreshMessage.set(
          `${sessionData.sessions.length.toLocaleString()} sessions imported`,
        );
      },
      error: (error: unknown) => {
        const message = this.errorMessage(error);
        if (message.toLowerCase().includes('scan stopped by user')) {
          this.refreshState.set('idle');
          this.refreshMessage.set('Scan stopped. Existing data was kept.');
          return;
        }
        this.refreshState.set('error');
        this.refreshMessage.set(
          this.isMissingRuntime(error)
            ? 'Refresh is unavailable in static-only mode'
            : message,
        );
      },
    });
  }

  cancelScan(): void {
    this.http.post<{ status?: LocalRuntimeStatus }>(apiUrl('/api/scan/cancel'), {}).subscribe({
      next: ({ status }) => {
        if (status) {
          this.runtimeStatus.set(status);
          this.runtimeStatusAvailable.set(true);
        }
        this.refreshState.set('idle');
        this.refreshMessage.set('Scan stopped. Existing data was kept.');
      },
      error: (error: unknown) => {
        this.refreshState.set('error');
        this.refreshMessage.set(this.errorMessage(error));
      },
    });
  }

  private errorMessage(error: unknown): string {
    if (
      error &&
      typeof error === 'object' &&
      'error' in error &&
      error.error &&
      typeof error.error === 'object' &&
      'error' in error.error &&
      typeof error.error.error === 'string'
    ) {
      return error.error.error;
    }

    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }

    return 'The local session data could not be loaded.';
  }

  private isMissingRuntime(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const status = 'status' in error ? Number(error.status) : 0;
    return status === 0 || status === 404 || status === 502 || status === 504;
  }

  private pollRuntimeStatus(): void {
    this.http.get<LocalRuntimeStatus>(apiUrl('/api/status')).subscribe({
      next: (status) => {
        this.runtimeStatus.set(status);
        this.runtimeStatusAvailable.set(true);
        if (status.scanning && status.scanProgress?.message) {
          this.refreshMessage.set(status.scanProgress.message);
        }
        if (status.hasData && this.loadState() !== 'ready') {
          this.loadSessionData();
        }
      },
      error: () => {
        this.runtimeStatusAvailable.set(false);
      },
    });
  }

  private loadSessionData(): void {
    this.http.get<SessionData>(apiUrl('/data/sessions.json')).subscribe({
      next: (sessionData) => {
        this.sessionData.set(sessionData);
        this.loadState.set('ready');
        this.loadError.set(null);
      },
      error: (error: unknown) => {
        this.loadState.set('error');
        this.loadError.set(this.errorMessage(error));
      },
    });
  }
}


