import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CopilotSession } from './session-data.model';
import { SessionSize, SessionTriage, sessionTriage } from './session-analysis';

@Component({
  selector: 'app-session-rail',
  imports: [DatePipe, DecimalPipe, FormsModule, NgClass],
  templateUrl: './session-rail.component.html',
  styleUrl: './session-rail.component.css',
})
export class SessionRailComponent {
  @Input({ required: true }) sessions: CopilotSession[] = [];
  @Input({ required: true }) filteredSessions: CopilotSession[] = [];
  @Input() selectedSessionId: string | null = null;
  @Input() query = '';
  @Input() sizeFilter: 'all' | SessionSize = 'all';
  @Input() warningFilter = 'all';
  @Input({ required: true }) warningOptions: string[] = [];
  @Input({ required: true }) sizeOptions: Array<'all' | SessionSize> = [];

  @Output() readonly queryChange = new EventEmitter<string>();
  @Output() readonly sizeFilterChange = new EventEmitter<'all' | SessionSize>();
  @Output() readonly warningFilterChange = new EventEmitter<string>();
  @Output() readonly selectSession = new EventEmitter<CopilotSession>();

  protected sessionTriage(session: CopilotSession): SessionTriage {
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

  protected trackBySessionId(_: number, session: CopilotSession): string {
    return session.id;
  }
}


