import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession } from './session-data.model';
import { SessionTriage } from './session-analysis';
import { sessionUsageCredits, sessionUsageLabel, sessionUsageUsd } from './session-cost-utils';

interface PricingFallback {
  model: string;
  pricingModel: string;
}

@Component({
  selector: 'app-selected-run-header',
  imports: [DecimalPipe, HelpPopoverComponent],
  templateUrl: './selected-run-header.component.html',
  styleUrl: './selected-run-header.component.css',
})
export class SelectedRunHeaderComponent {
  @Input({ required: true }) session!: CopilotSession;
  @Input() triage: SessionTriage | null = null;
  @Input() outsideFilters = false;
  @Input() filteredCount = 0;
  @Input() pricingFallbacks: PricingFallback[] = [];
  @Input() savedMemoryCount = 0;
  @Input() savedPlanCount = 0;
  @Input({ required: true }) sessionSizeHelp!: (triage: SessionTriage) => string;
  @Input({ required: true }) pricingFallbackReason!: (model: string, pricingModel: string) => string;

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
      ? `Reasoning setting VS Code recorded for this run's model requests. Higher reasoning can improve hard tasks, but it may also use more tokens or take longer. Imported values: ${label}.`
      : 'VS Code did not record a reasoning setting for this run.';
  }

  protected costLabel(session: CopilotSession): string {
    return sessionUsageLabel(session);
  }

  protected costHelp(session: CopilotSession): string {
    return session.sourceUsage
      ? 'Usage reported by VS Code Copilot for this run.'
      : 'Fallback estimate from imported token buckets and GitHub model prices because source usage was not logged.';
  }

  protected displayedUsageUsd(session: CopilotSession): number {
    return sessionUsageUsd(session);
  }

  protected displayedUsageCredits(session: CopilotSession): number {
    return sessionUsageCredits(session);
  }

  protected savedMemoryLabel(): string {
    const parts = [];
    if (this.savedPlanCount) {
      parts.push(`${this.savedPlanCount} plan${this.savedPlanCount === 1 ? '' : 's'}`);
    }
    const otherMemories = this.savedMemoryCount - this.savedPlanCount;
    if (otherMemories > 0) {
      parts.push(`${otherMemories} memor${otherMemories === 1 ? 'y' : 'ies'}`);
    }
    return `Saved ${parts.join(' · ')}`;
  }
}


