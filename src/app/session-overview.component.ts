import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession, ModelLimitSummary } from './session-data.model';

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

  protected limitRead(): ModelLimitSummary | null {
    const limits = this.session.modelLimits ?? [];
    if (!limits.length) {
      return null;
    }

    return limits.reduce((best, current) => {
      const bestShare = this.limitShare(best);
      const currentShare = this.limitShare(current);
      if (currentShare !== bestShare) {
        return currentShare > bestShare ? current : best;
      }

      return current.largestRawInputTokens > best.largestRawInputTokens ? current : best;
    });
  }

  protected limitShare(limit: ModelLimitSummary): number {
    return limit.promptLimitShare ?? limit.contextWindowShare ?? 0;
  }

  protected limitPercent(limit: ModelLimitSummary): number {
    return Math.round(this.limitShare(limit) * 100);
  }

  protected limitMeterPercent(limit: ModelLimitSummary): number {
    return Math.min(100, Math.max(0, this.limitShare(limit) * 100));
  }

  protected limitDenominatorLabel(limit: ModelLimitSummary): string {
    if (limit.promptLimitTokens) {
      return `${limit.promptLimitTokens.toLocaleString()} prompt limit`;
    }

    if (limit.contextWindowTokens) {
      return `${limit.contextWindowTokens.toLocaleString()} context window`;
    }

    return 'no local limit metadata';
  }

  protected limitAnswer(limit: ModelLimitSummary): string {
    const share = this.limitShare(limit);
    const repeated = limit.modelCalls > 1 && limit.repeatedInputFactor >= 2;

    if (share >= 0.8) {
      return 'Near limit';
    }

    if (share >= 0.6) {
      return 'Elevated peak';
    }

    if (repeated) {
      return 'Repeated context';
    }

    return 'Low peak';
  }

  protected limitDetail(limit: ModelLimitSummary): string {
    const peak = limit.largestRawInputTokens.toLocaleString();
    const denominator = this.limitDenominatorLabel(limit);
    const share = this.limitPercent(limit);

    if (limit.modelCalls > 1) {
      return `${peak} / ${denominator} (${share}%). Total raw input was ${limit.repeatedInputFactor.toFixed(1)}x the largest request across ${limit.modelCalls.toLocaleString()} calls.`;
    }

    return `${peak} / ${denominator} (${share}%). Single model call in this run.`;
  }
}


