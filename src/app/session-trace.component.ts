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

interface TraceDetailGroup {
  title: string;
  fields: TraceDetailField[];
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
  @Input() openedFromTurns = false;
  @Input({ required: true }) flowEvents!: FlowTraceEventViewModel[];

  @Output() traceViewChange = new EventEmitter<TraceView>();
  @Output() traceFilterChange = new EventEmitter<TraceFilter>();
  @Output() selectTraceEvent = new EventEmitter<TraceEvent>();

  protected eventRowClass(event: TraceEvent): string[] {
    return [
      this.eventKind(event),
      event.inputTokens || event.outputTokens ? 'token-bearing' : '',
      event.status !== 'ok' && event.status !== 'unknown' ? 'error' : '',
      event.type === 'user_message' ? 'user-message' : '',
    ].filter(Boolean);
  }

  protected eventKind(event: TraceEvent): string {
    if (event.inputTokens || event.outputTokens || event.type === 'llm_request') {
      return 'model-call';
    }

    if (event.type.includes('tool') || this.toolLikeName(event.name)) {
      return 'tool-call';
    }

    if (event.type === 'user_message') {
      return 'user-message';
    }

    if (event.type === 'agent_response' || event.type === 'assistant.message') {
      return 'agent-response';
    }

    if (event.type === 'discovery' || event.name.toLowerCase().includes('discovery')) {
      return 'discovery';
    }

    return 'trace-event';
  }

  protected eventKindLabel(event: TraceEvent): string {
    const kind = this.eventKind(event);

    if (kind === 'model-call') {
      return 'Model';
    }

    if (kind === 'tool-call') {
      return 'Tool';
    }

    if (kind === 'user-message') {
      return 'User';
    }

    if (kind === 'agent-response') {
      return 'Response';
    }

    if (kind === 'discovery') {
      return 'Discovery';
    }

    return 'Event';
  }

  protected groupedFields(details: TraceEventDetailsViewModel): TraceDetailGroup[] {
    const groups: TraceDetailGroup[] = [
      { title: 'Timing', fields: [] },
      { title: 'Model', fields: [] },
      { title: 'Tokens', fields: [] },
      { title: 'Pricing', fields: [] },
      { title: 'Payload', fields: [] },
    ];

    for (const field of details.normalizedFields) {
      this.groupForField(field.label, groups).fields.push(field);
    }

    if (details.attributeFields.length) {
      groups.find((group) => group.title === 'Payload')?.fields.push(...details.attributeFields);
    }

    return groups.filter((group) => group.fields.length);
  }

  private groupForField(label: string, groups: TraceDetailGroup[]): TraceDetailGroup {
    const normalized = label.toLowerCase();

    if (['raw index', 'timestamp', 'ttft'].includes(normalized)) {
      return groups[0];
    }

    if (['type', 'name', 'status', 'model', 'raw model', 'reasoning text'].includes(normalized)) {
      return groups[1];
    }

    if (normalized.includes('tokens') && normalized !== 'pricing row') {
      return groups[2];
    }

    if (normalized.includes('pricing') || normalized.includes('cost')) {
      return groups[3];
    }

    return groups[4];
  }

  private toolLikeName(name: string): boolean {
    return ['read_file', 'list_dir', 'grep_search', 'semantic_search', 'fetch_webpage', 'apply_patch', 'run_in_terminal']
      .some((toolName) => name.toLowerCase().includes(toolName));
  }
}
