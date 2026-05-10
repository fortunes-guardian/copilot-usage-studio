import { DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { SessionData } from './session-data.model';

type SessionDataIngestion = NonNullable<SessionData['ingestion']>;

interface SessionDataSummary {
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
  @Input({ required: true }) ingestion!: SessionDataIngestion;
  @Input({ required: true }) summary!: SessionDataSummary;
  @Input({ required: true }) help!: Record<string, string>;
}


