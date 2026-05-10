import { DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { LedgerData } from './ledger.model';

type LedgerIngestion = NonNullable<LedgerData['ingestion']>;

interface LedgerSummary {
  count: number;
  usd: number;
}

@Component({
  selector: 'app-session-import-context',
  imports: [DecimalPipe, HelpPopoverComponent],
  templateUrl: './session-import-context.component.html',
  styleUrl: './session-import-context.component.css',
})
export class SessionImportContextComponent {
  @Input({ required: true }) ingestion!: LedgerIngestion;
  @Input({ required: true }) summary!: LedgerSummary;
  @Input({ required: true }) help!: Record<string, string>;
}
