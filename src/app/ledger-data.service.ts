import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { LedgerData } from './ledger.model';

export type LedgerLoadState = 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class LedgerDataService {
  private readonly http = inject(HttpClient);

  readonly ledger = signal<LedgerData | null>(null);
  readonly loadState = signal<LedgerLoadState>('loading');
  readonly loadError = signal<string | null>(null);

  constructor() {
    this.http.get<LedgerData>('/data/sessions.json').subscribe({
      next: (ledger) => {
        this.ledger.set(ledger);
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

    return 'The generated ledger could not be loaded. Run npm run scan and npm run verify:data.';
  }
}
