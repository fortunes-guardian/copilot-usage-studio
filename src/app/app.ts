import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LedgerData, LedgerSession } from './ledger.model';

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, FormsModule, NgClass],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly ledger = signal<LedgerData | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly compareA = signal<string | null>(null);
  protected readonly compareB = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly traceView = signal<'logs' | 'flow'>('logs');

  protected readonly sessions = computed(() => this.ledger()?.sessions ?? []);
  protected readonly filteredSessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    const sessions = [...this.sessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    if (!query) {
      return sessions;
    }

    return sessions.filter((session) =>
      [session.firstPrompt, session.title, session.workspace, session.model, session.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });

  protected readonly selectedSession = computed(() => {
    const id = this.selectedId() ?? this.filteredSessions()[0]?.id;
    return this.sessions().find((session) => session.id === id) ?? null;
  });

  protected readonly summary = computed(() => {
    const sessions = this.sessions();
    const totals = sessions.reduce(
      (acc, session) => {
        acc.usd += session.cost.usd;
        acc.eur += session.cost.eur;
        acc.input += session.tokens.input;
        acc.output += session.tokens.output;
        acc.cachedInput += session.tokens.cachedInput;
        acc.cacheWrite += session.tokens.cacheWrite;
        return acc;
      },
      { usd: 0, eur: 0, input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
    );

    return { count: sessions.length, ...totals };
  });

  protected readonly comparison = computed(() => {
    const a = this.sessions().find((session) => session.id === this.compareA());
    const b = this.sessions().find((session) => session.id === this.compareB());

    if (!a || !b || a.id === b.id) {
      return null;
    }

    return {
      a,
      b,
      eurDelta: b.cost.eur - a.cost.eur,
      inputDelta: b.tokens.input - a.tokens.input,
      outputDelta: b.tokens.output - a.tokens.output,
      cachedDelta: b.tokens.cachedInput - a.tokens.cachedInput,
      tokenDelta:
        b.tokens.input +
        b.tokens.cachedInput +
        b.tokens.cacheWrite +
        b.tokens.output -
        (a.tokens.input + a.tokens.cachedInput + a.tokens.cacheWrite + a.tokens.output),
      percent: a.cost.eur === 0 ? 0 : ((b.cost.eur - a.cost.eur) / a.cost.eur) * 100,
    };
  });
  protected readonly abs = Math.abs;

  constructor() {
    this.http.get<LedgerData>('/data/sessions.json').subscribe((ledger) => {
      this.ledger.set(ledger);
      this.selectedId.set(ledger.sessions[0]?.id ?? null);
      this.compareA.set(ledger.sessions[0]?.id ?? null);
      this.compareB.set(ledger.sessions[1]?.id ?? null);
    });
  }

  protected selectSession(session: LedgerSession): void {
    this.selectedId.set(session.id);
  }

  protected trackBySessionId(_: number, session: LedgerSession): string {
    return session.id;
  }

  protected setQuery(value: string): void {
    this.query.set(value);
  }
}
