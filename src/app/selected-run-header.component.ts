import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession } from './session-data.model';
import { CopilotAllowance, CopilotAllowancePlan } from './pricing';
import { SessionTriage } from './session-analysis';

interface AllowanceUsage {
  credits: number;
  share: number;
}

interface PricingFallback {
  model: string;
  pricingModel: string;
}

@Component({
  selector: 'app-selected-run-header',
  imports: [DecimalPipe, FormsModule, HelpPopoverComponent],
  templateUrl: './selected-run-header.component.html',
  styleUrl: './selected-run-header.component.css',
})
export class SelectedRunHeaderComponent {
  @Input({ required: true }) session!: CopilotSession;
  @Input() triage: SessionTriage | null = null;
  @Input({ required: true }) allowancePlan!: CopilotAllowancePlan;
  @Input({ required: true }) allowancePlans: CopilotAllowance[] = [];
  @Input({ required: true }) selectedAllowance!: CopilotAllowance;
  @Input() allowanceUsage: AllowanceUsage | null = null;
  @Input() outsideFilters = false;
  @Input() filteredCount = 0;
  @Input() pricingFallbacks: PricingFallback[] = [];
  @Input({ required: true }) sessionSizeHelp!: (triage: SessionTriage) => string;
  @Input({ required: true }) confidenceLabel!: (confidence: string) => string;
  @Input({ required: true }) confidenceHelp!: (confidence: string) => string;
  @Input({ required: true }) tokenSourceLabel!: (tokenSource: string) => string;
  @Input({ required: true }) tokenSourceHelp!: (tokenSource: string) => string;
  @Input({ required: true }) pricingFallbackReason!: (model: string, pricingModel: string) => string;

  @Output() readonly allowancePlanChange = new EventEmitter<string>();
  @Output() readonly openFirstFilteredSession = new EventEmitter<void>();
  @Output() readonly viewPrices = new EventEmitter<void>();

  protected reasoningEffortLabel(session: CopilotSession): string {
    const efforts = session.traceSummary.reasoningEfforts ?? [];

    if (!efforts.length) {
      return '';
    }

    return efforts.map((entry) => `${entry.effort} (${entry.count})`).join(', ');
  }

  protected reasoningEffortHelp(session: CopilotSession): string {
    const label = this.reasoningEffortLabel(session);

    return label
      ? `Source-backed request reasoning effort from llm_request.attrs.requestOptions.reasoning.effort. Imported values: ${label}.`
      : 'No request reasoning effort was imported for this run.';
  }
}


