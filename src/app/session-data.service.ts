import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import { SessionData } from './session-data.model';

export type SessionDataLoadState = 'loading' | 'ready' | 'error';
export type SessionDataRefreshState = 'idle' | 'refreshing' | 'success' | 'error';

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
  logFile?: string;
  scanProgress?: {
    stage?: string;
    message?: string;
    updatedAt?: string;
    workspace?: string;
    workspaceDir?: string;
    index?: number;
    total?: number;
    sessions?: number;
  } | null;
  recentLogs?: LocalRuntimeLogEntry[];
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

    this.http.get<SessionData>('/data/sessions.json').subscribe({
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

  refresh(): void {
    if (this.refreshState() === 'refreshing') {
      return;
    }

    this.refreshState.set('refreshing');
    this.refreshMessage.set('Scanning VS Code...');
    this.http.post<LocalScanResponse>('/api/scan', {}).subscribe({
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
        this.refreshState.set('error');
        this.refreshMessage.set(
          this.isMissingRuntime(error)
            ? 'Refresh is unavailable in static-only mode'
            : this.errorMessage(error),
        );
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
    this.http.get<LocalRuntimeStatus>('/api/status').subscribe({
      next: (status) => {
        this.runtimeStatus.set(status);
        this.runtimeStatusAvailable.set(true);
        if (status.scanning && status.scanProgress?.message) {
          this.refreshMessage.set(status.scanProgress.message);
        }
      },
      error: () => {
        this.runtimeStatusAvailable.set(false);
      },
    });
  }
}


