import { Component, EventEmitter, Input, Output } from '@angular/core';

import { SessionDataLoadState, SessionDataRefreshState } from './session-data.service';

@Component({
  selector: 'app-session-data-state-panel',
  templateUrl: './session-data-state-panel.component.html',
  styleUrl: './session-data-state-panel.component.css',
})
export class SessionDataStatePanelComponent {
  @Input({ required: true }) state!: SessionDataLoadState;
  @Input() error: string | null = null;
  @Input() refreshState: SessionDataRefreshState = 'idle';
  @Output() refresh = new EventEmitter<void>();

  protected get isEmptyState(): boolean {
    return this.error?.toLowerCase().includes('no session data is available') ?? false;
  }
}


