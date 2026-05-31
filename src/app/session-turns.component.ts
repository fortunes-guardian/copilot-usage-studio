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
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  estimatedUsd: number;
  inputUsd: number;
  cachedInputUsd?: number;
  cacheWriteUsd?: number;
  outputUsd: number;
  share: number;
  contextLabel: string;
  contextDetail: string;
  promptLimitTokens?: number | null;
  contextWindowTokens?: number | null;
  promptLimitShare?: number | null;
  contextWindowShare?: number | null;
  cumulativeRawInputTokens?: number;
  repeatedInputFactorAtCall?: number;
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

  protected contextTimelineRows(): ModelCallRowViewModel[] {
    return [...this.cost.modelCallRows].sort((a, b) => a.callNumber - b.callNumber);
  }

  protected hasContextTimeline(): boolean {
    return this.contextTimelineRows().some((event) => event.inputTokens > 0);
  }

  protected contextPeakCall(): ModelCallRowViewModel | null {
    return [...this.cost.modelCallRows].sort((a, b) => b.inputTokens - a.inputTokens)[0] ?? null;
  }

  protected contextBarHeight(event: ModelCallRowViewModel): number {
    const peak = this.contextPeakCall()?.inputTokens ?? 0;
    return peak > 0 && event.inputTokens > 0 ? Math.max(6, (event.inputTokens / peak) * 100) : 0;
  }

  protected contextLimitShare(event: ModelCallRowViewModel): number | null {
    return event.promptLimitShare ?? event.contextWindowShare ?? null;
  }

  protected contextLimitLabel(event: ModelCallRowViewModel): string {
    if (event.promptLimitTokens) {
      return `${event.promptLimitTokens.toLocaleString()} prompt limit`;
    }

    if (event.contextWindowTokens) {
      return `${event.contextWindowTokens.toLocaleString()} context window`;
    }

    return 'limit unavailable';
  }

  protected contextLimitPercentLabel(event: ModelCallRowViewModel): string {
    const share = this.contextLimitShare(event);
    return share === null ? 'limit n/a' : `${Math.round(share * 100)}%`;
  }

  protected contextPressureClass(event: ModelCallRowViewModel): string {
    const share = this.contextLimitShare(event);
    if (share === null) {
      return '';
    }

    if (share >= 0.8) {
      return 'near-limit';
    }

    if (share >= 0.6) {
      return 'elevated-limit';
    }

    return '';
  }

  protected contextRepeatedFactor(): number {
    const rows = this.contextTimelineRows();
    const peakInput = Math.max(...rows.map((event) => event.inputTokens), 0);
    const totalRawInput = rows.reduce((sum, event) => sum + event.inputTokens, 0);
    return peakInput > 0 ? totalRawInput / peakInput : 0;
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

  protected impactLabel(event: ModelCallRowViewModel): string {
    if (event.share >= 25) {
      return 'High share';
    }

    if (event.share >= 10) {
      return 'Medium share';
    }

    return '';
  }

  protected inputShare(event: ModelCallRowViewModel): number {
    return event.totalTokens > 0 ? (event.inputTokens / event.totalTokens) * 100 : 0;
  }

  protected normalInputTokens(event: ModelCallRowViewModel): number {
    return Math.max(0, event.inputTokens - (event.cachedInputTokens ?? 0));
  }

  protected normalInputShare(event: ModelCallRowViewModel): number {
    return event.totalTokens > 0 ? (this.normalInputTokens(event) / event.totalTokens) * 100 : 0;
  }

  protected cachedInputShare(event: ModelCallRowViewModel): number {
    return event.totalTokens > 0 ? ((event.cachedInputTokens ?? 0) / event.totalTokens) * 100 : 0;
  }

  protected inputCostUsd(event: ModelCallRowViewModel): number {
    return event.inputUsd + (event.cachedInputUsd ?? 0) + (event.cacheWriteUsd ?? 0);
  }

  protected outputShare(event: ModelCallRowViewModel): number {
    return event.totalTokens > 0 ? (event.outputTokens / event.totalTokens) * 100 : 0;
  }
}


