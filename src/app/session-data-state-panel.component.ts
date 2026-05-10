import { Component, Input } from '@angular/core';

import { SessionDataLoadState } from './session-data.service';

@Component({
  selector: 'app-session-data-state-panel',
  templateUrl: './session-data-state-panel.component.html',
  styleUrl: './session-data-state-panel.component.css',
})
export class SessionDataStatePanelComponent {
  @Input({ required: true }) state!: SessionDataLoadState;
  @Input() error: string | null = null;
}


