import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LedgerSession } from './ledger.model';
import { SessionSize, SessionTriage, sessionTriage } from './session-analysis';

export type SessionSourceFilter = 'all' | 'debug-log' | 'chat-snapshot' | 'exact' | 'estimated';

@Component({
  selector: 'app-session-rail',
  imports: [DatePipe, DecimalPipe, FormsModule, NgClass],
  templateUrl: './session-rail.component.html',
  styleUrl: './session-rail.component.css',
})
export class SessionRailComponent {
  @Input({ required: true }) sessions: LedgerSession[] = [];
  @Input({ required: true }) filteredSessions: LedgerSession[] = [];
  @Input() selectedSessionId: string | null = null;
  @Input() query = '';
  @Input() sizeFilter: 'all' | SessionSize = 'all';
  @Input() warningFilter = 'all';
  @Input() sourceFilter: SessionSourceFilter = 'all';
  @Input({ required: true }) warningOptions: string[] = [];
  @Input({ required: true }) sizeOptions: Array<'all' | SessionSize> = [];
  @Input({ required: true }) sourceOptions: Array<{ value: SessionSourceFilter; label: string }> = [];

  @Output() readonly queryChange = new EventEmitter<string>();
  @Output() readonly sizeFilterChange = new EventEmitter<'all' | SessionSize>();
  @Output() readonly warningFilterChange = new EventEmitter<string>();
  @Output() readonly sourceFilterChange = new EventEmitter<SessionSourceFilter>();
  @Output() readonly selectSession = new EventEmitter<LedgerSession>();

  protected sessionTriage(session: LedgerSession): SessionTriage {
    return sessionTriage(session);
  }

  protected sourceKindLabel(sourceKind: string): string {
    if (sourceKind === 'vscode-copilot-debug-log') {
      return 'Debug log';
    }

    if (sourceKind === 'vscode-chat-session-snapshot') {
      return 'Chat snapshot';
    }

    return sourceKind;
  }

  protected trackBySessionId(_: number, session: LedgerSession): string {
    return session.id;
  }
}
