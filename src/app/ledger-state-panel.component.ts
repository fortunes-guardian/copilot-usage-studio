import { Component, Input } from '@angular/core';

import { LedgerLoadState } from './ledger-data.service';

@Component({
  selector: 'app-ledger-state-panel',
  templateUrl: './ledger-state-panel.component.html',
  styleUrl: './ledger-state-panel.component.css',
})
export class LedgerStatePanelComponent {
  @Input({ required: true }) state!: LedgerLoadState;
  @Input() error: string | null = null;
}
