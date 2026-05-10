import { DatePipe, DecimalPipe } from '@angular/common';
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
  imports: [DatePipe, DecimalPipe],
  templateUrl: './session-turns.component.html',
  styleUrl: './session-turns.component.css',
})
export class SessionTurnsComponent {
  @Input({ required: true }) cost!: SessionTurnsViewModel;
  @Input({ required: true }) sort!: ModelCallSort;

  @Output() sortChange = new EventEmitter<ModelCallSort>();
  @Output() openTraceEvent = new EventEmitter<number>();
}


