import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { TraceEvent } from './ledger.model';

type TraceView = 'logs' | 'flow';
type TraceFilter = 'all' | 'model' | 'tool' | 'discovery' | 'message' | 'response' | 'error';

interface TraceFilterOption {
  value: TraceFilter;
  label: string;
}

interface TraceDetailField {
  label: string;
  value: string;
}

export interface TraceEventDetailsViewModel {
  normalizedFields: TraceDetailField[];
  attributeFields: TraceDetailField[];
  detail: string;
  hasCost: boolean;
  estimatedEur: number;
  totalTokens: number;
  pricingModel: string;
  usesFallbackPrice: boolean;
}

export interface FlowTraceEventViewModel extends TraceEvent {
  flowIndex: number;
  totalTokens: number;
  estimatedEur: number;
}

@Component({
  selector: 'app-session-trace',
  imports: [DatePipe, DecimalPipe, NgClass],
  templateUrl: './session-trace.component.html',
  styleUrl: './session-trace.component.css',
})
export class SessionTraceComponent {
  @Input({ required: true }) traceView!: TraceView;
  @Input({ required: true }) traceFilter!: TraceFilter;
  @Input({ required: true }) traceFilterOptions!: TraceFilterOption[];
  @Input({ required: true }) filteredTraceEvents!: TraceEvent[];
  @Input() selectedTraceEvent: TraceEvent | null = null;
  @Input() selectedTraceEventDetails: TraceEventDetailsViewModel | null = null;
  @Input({ required: true }) flowEvents!: FlowTraceEventViewModel[];

  @Output() traceViewChange = new EventEmitter<TraceView>();
  @Output() traceFilterChange = new EventEmitter<TraceFilter>();
  @Output() selectTraceEvent = new EventEmitter<TraceEvent>();
}
