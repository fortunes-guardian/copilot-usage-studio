import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession } from './session-data.model';

type SessionSize = 'Small' | 'Medium' | 'Large' | 'Very large';
type WarningTone = 'low' | 'info' | 'medium' | 'high';

interface SessionWarning {
  label: string;
  tone: WarningTone;
  help: string;
}

export interface SessionTriageViewModel {
  size: SessionSize;
  sizeTone: WarningTone;
  totalTokens: number;
  warnings: SessionWarning[];
}

@Component({
  selector: 'app-session-overview',
  imports: [DatePipe, DecimalPipe, HelpPopoverComponent, NgClass],
  templateUrl: './session-overview.component.html',
  styleUrl: './session-overview.component.css',
})
export class SessionOverviewComponent {
  @Input({ required: true }) session!: CopilotSession;
  @Input() triage: SessionTriageViewModel | null = null;
  @Input() triageHelp = '';

  protected reasoningLabel(): string {
    const efforts = this.session.traceSummary.reasoningEfforts ?? [];
    if (!efforts.length) {
      return '';
    }

    return efforts
      .map((effort) => `${effort.effort}${effort.count > 1 ? ` x${effort.count}` : ''}`)
      .join(', ');
  }

  protected reasoningHelp(): string {
    return 'Reasoning effort is shown only when VS Code logged the request setting. It is useful context for debugging a run, but it is not a separate cost bucket.';
  }
}


