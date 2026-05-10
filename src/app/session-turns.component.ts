import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

type ModelCallSort = 'timeline' | 'largest';

interface TurnInsightViewModel {
  label: string;
  value: string;
  detail: string;
}

interface ModelCallRowViewModel {
  index: number;
  callNumber: number;
  timestamp: string;
  model?: string | null;
  name: string;
  pricingModel: string;
  usesFallbackPrice: boolean;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  inputUsd: number;
  outputUsd: number;
  share: number;
  contextLabel: string;
  contextDetail: string;
}

export interface SessionTurnsViewModel {
  turnInsights: TurnInsightViewModel[];
  modelCallRows: ModelCallRowViewModel[];
}

@Component({
  selector: 'app-session-turns',
  imports: [DatePipe, DecimalPipe, NgClass],
  templateUrl: './session-turns.component.html',
  styleUrl: './session-turns.component.css',
})
export class SessionTurnsComponent {
  @Input({ required: true }) cost!: SessionTurnsViewModel;
  @Input({ required: true }) sort!: ModelCallSort;

  @Output() sortChange = new EventEmitter<ModelCallSort>();
  @Output() openTraceEvent = new EventEmitter<number>();

  protected topModelCall(): ModelCallRowViewModel | null {
    return [...this.cost.modelCallRows].sort((a, b) => b.estimatedUsd - a.estimatedUsd)[0] ?? null;
  }

  protected impactClass(event: ModelCallRowViewModel): string {
    if (event.share >= 25) {
      return 'high-impact';
    }

    if (event.share >= 10) {
      return 'medium-impact';
    }

    return '';
  }

  protected inputShare(event: ModelCallRowViewModel): number {
    return event.totalTokens > 0 ? (event.inputTokens / event.totalTokens) * 100 : 0;
  }

  protected outputShare(event: ModelCallRowViewModel): number {
    return event.totalTokens > 0 ? (event.outputTokens / event.totalTokens) * 100 : 0;
  }
}


