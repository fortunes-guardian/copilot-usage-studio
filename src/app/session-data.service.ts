import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { SessionData } from './session-data.model';

export type SessionDataLoadState = 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class SessionDataService {
  private readonly http = inject(HttpClient);

  readonly sessionData = signal<SessionData | null>(null);
  readonly loadState = signal<SessionDataLoadState>('loading');
  readonly loadError = signal<string | null>(null);

  constructor() {
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

  private errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }

    return 'The generated session data could not be loaded. Run npm run scan and npm run verify:data.';
  }
}


