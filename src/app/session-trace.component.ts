import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';

import { TraceEvent } from './session-data.model';
import { isSetupEvent } from './session-analysis';

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

interface TracePrimaryFact {
  label: string;
  value: string;
  tone?: 'cost' | 'tool' | 'plain';
}

export interface TraceEventDetailsViewModel {
  normalizedFields: TraceDetailField[];
  attributeFields: TraceDetailField[];
  detail: string;
  hasCost: boolean;
  estimatedUsd: number;
  totalTokens: number;
  pricingModel: string;
  usesFallbackPrice: boolean;
}

export interface FlowTraceEventViewModel extends TraceEvent {
  flowIndex: number;
  totalTokens: number;
  estimatedUsd: number;
}

@Component({
  selector: 'app-session-trace',
  imports: [DatePipe, DecimalPipe, NgClass],
  templateUrl: './session-trace.component.html',
  styleUrl: './session-trace.component.css',
})
export class SessionTraceComponent implements OnChanges, AfterViewChecked {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private pendingScrollIndex: number | null = null;
  protected readonly copiedTarget = signal<'detail' | 'json' | null>(null);

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

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['selectedTraceEvent'] || changes['openedFromTurns']) && this.openedFromTurns && this.selectedTraceEvent) {
      this.pendingScrollIndex = this.selectedTraceEvent.index;
    }
  }

  ngAfterViewChecked(): void {
    if (this.pendingScrollIndex === null) {
      return;
    }

    const eventIndex = this.pendingScrollIndex;
    this.pendingScrollIndex = null;
    const row = this.elementRef.nativeElement.querySelector<HTMLElement>(
      `[data-trace-event-index="${eventIndex}"]`,
    );

    if (typeof row?.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center' });
    }
  }

  protected eventRowClass(event: TraceEvent): string[] {
    return [
      this.eventKind(event),
      event.inputTokens || event.outputTokens ? 'token-bearing' : '',
      event.status !== 'ok' && event.status !== 'unknown' ? 'error' : '',
      event.type === 'user_message' ? 'user-message' : '',
    ].filter(Boolean);
  }

  protected eventKind(event: TraceEvent): string {
    if (
      event.inputTokens ||
      event.outputTokens ||
      event.type === 'llm_request' ||
      event.type.toLowerCase().includes('model') ||
      event.model ||
      event.rawModel ||
      this.modelLikeText(event.name) ||
      this.modelLikeText(event.detail)
    ) {
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

    if (isSetupEvent(event)) {
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

  protected eventJson(event: TraceEvent): string {
    return JSON.stringify(event, null, 2);
  }

  protected copyEventDetail(event: TraceEvent, details: TraceEventDetailsViewModel): void {
    void this.copyText(details.detail || event.detail || '', 'detail');
  }

  protected copyEventJson(event: TraceEvent): void {
    void this.copyText(this.eventJson(event), 'json');
  }

  protected inspectorMode(event: TraceEvent): string {
    return this.eventKind(event);
  }

  protected inspectorHeadline(event: TraceEvent, details: TraceEventDetailsViewModel): string {
    const kind = this.eventKind(event);

    if (kind === 'model-call') {
      return details.hasCost ? 'Cost-bearing model call' : 'Model event without token totals';
    }

    if (kind === 'tool-call') {
      return 'Tool activity';
    }

    if (kind === 'user-message') {
      return 'User prompt event';
    }

    if (kind === 'agent-response') {
      return 'Agent response event';
    }

    if (kind === 'discovery') {
      return 'Discovery or setup event';
    }

    return 'Raw trace event';
  }

  protected inspectorHint(event: TraceEvent, details: TraceEventDetailsViewModel): string {
    const kind = this.eventKind(event);

    if (kind === 'model-call') {
      return details.hasCost
        ? 'This is the event priced by Cost and opened from Calls.'
        : 'This event is model-related, but the imported row does not include token totals.';
    }

    if (kind === 'tool-call') {
      return 'Tool calls are not priced directly here. Their results may affect later model input if sent back as context.';
    }

    if (kind === 'user-message') {
      return 'This records the user message boundary. Cost appears on later model-call events.';
    }

    if (kind === 'agent-response') {
      return 'This records the assistant response payload. Token cost is tied to the corresponding model-call event.';
    }

    if (kind === 'discovery') {
      return 'Setup/discovery events explain environment work, but usually do not carry direct token cost.';
    }

    return 'Inspect the normalized fields and raw JSON when you need source-level evidence.';
  }

  protected primaryFacts(event: TraceEvent, details: TraceEventDetailsViewModel): TracePrimaryFact[] {
    const kind = this.eventKind(event);

    if (kind === 'model-call') {
      return [
        {
          label: 'Estimate',
          value: details.hasCost ? `$${this.formatCost(details.estimatedUsd)}` : 'No token cost',
          tone: details.hasCost ? 'cost' : 'plain',
        },
        { label: 'Total tokens', value: details.hasCost ? details.totalTokens.toLocaleString() : 'n/a' },
        { label: 'Normal input', value: this.normalInputTokens(event).toLocaleString() },
        ...(event.cachedInputTokens
          ? [{ label: 'Cached input', value: event.cachedInputTokens.toLocaleString(), tone: 'cost' as const }]
          : []),
        ...(event.cacheWriteTokens
          ? [{ label: 'Cache write', value: event.cacheWriteTokens.toLocaleString(), tone: 'cost' as const }]
          : []),
        { label: 'Output', value: event.outputTokens ? event.outputTokens.toLocaleString() : '0' },
        ...(event.reasoningEffort
          ? [{ label: 'Reasoning', value: event.reasoningEffort, tone: 'plain' as const }]
          : []),
        { label: 'Pricing row', value: details.pricingModel || 'n/a' },
      ];
    }

    if (kind === 'tool-call') {
      return [
        { label: 'Tool/event', value: event.name, tone: 'tool' },
        { label: 'Status', value: event.status },
        { label: 'Payload fields', value: `${details.attributeFields.length}` },
        { label: 'Direct cost', value: details.hasCost ? `$${this.formatCost(details.estimatedUsd)}` : 'None' },
      ];
    }

    return [
      { label: 'Type', value: event.type },
      { label: 'Status', value: event.status },
      { label: 'Payload fields', value: `${details.attributeFields.length}` },
      { label: 'Tokens', value: details.hasCost ? details.totalTokens.toLocaleString() : 'n/a' },
    ];
  }

  protected detailHeading(event: TraceEvent): string {
    const kind = this.eventKind(event);

    if (kind === 'model-call') {
      return 'Model-call detail';
    }

    if (kind === 'tool-call') {
      return 'Tool detail';
    }

    if (kind === 'user-message') {
      return 'User message';
    }

    if (kind === 'agent-response') {
      return 'Response detail';
    }

    return 'Imported detail';
  }

  protected inputShare(event: TraceEvent): number {
    const totalTokens = this.pricedTokenTotal(event);

    return totalTokens > 0 ? (this.normalInputTokens(event) / totalTokens) * 100 : 0;
  }

  protected cachedInputShare(event: TraceEvent): number {
    const totalTokens = this.pricedTokenTotal(event);

    return totalTokens > 0 ? ((event.cachedInputTokens ?? 0) / totalTokens) * 100 : 0;
  }

  protected outputShare(event: TraceEvent): number {
    const totalTokens = this.pricedTokenTotal(event);

    return totalTokens > 0 ? (event.outputTokens / totalTokens) * 100 : 0;
  }

  protected normalInputTokens(event: TraceEvent): number {
    return Math.max(0, event.inputTokens - (event.cachedInputTokens ?? 0));
  }

  protected pricedTokenTotal(event: TraceEvent): number {
    return this.normalInputTokens(event) + (event.cachedInputTokens ?? 0) + (event.cacheWriteTokens ?? 0) + event.outputTokens;
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

  private modelLikeText(value: string): boolean {
    const normalized = value.toLowerCase();

    return ['gpt-', 'claude', 'gemini', 'o3', 'o4', 'llm_request', 'language model', 'copilotlanguagemodel']
      .some((marker) => normalized.includes(marker));
  }

  private formatCost(value: number): string {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    });
  }

  private async copyText(text: string, target: 'detail' | 'json'): Promise<void> {
    if (!text.trim()) {
      return;
    }

    await navigator.clipboard.writeText(text);
    this.copiedTarget.set(target);
    window.setTimeout(() => {
      if (this.copiedTarget() === target) {
        this.copiedTarget.set(null);
      }
    }, 1600);
  }
}


