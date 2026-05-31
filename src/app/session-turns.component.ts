import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';

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
  startsAfterUserRequest?: boolean;
  userRequestIndex?: number | null;
  userRequestDetail?: string | null;
  promptLimitTokens?: number | null;
  contextWindowTokens?: number | null;
  promptLimitShare?: number | null;
  contextWindowShare?: number | null;
  cumulativeRawInputTokens?: number;
  repeatedInputFactorAtCall?: number;
  setupPayload?: {
    systemPromptFile: string;
    systemPromptChars: number;
    toolsFile: string;
    toolSchemaChars: number;
    toolCount: number;
    mcpToolCount: number;
    mcpToolNames: string[];
  };
}

export interface SessionTurnsViewModel {
  turnInsights: TurnInsightViewModel[];
  modelCallRows: ModelCallRowViewModel[];
}

@Component({
  selector: 'app-session-turns',
  imports: [DatePipe, DecimalPipe, NgClass, HelpPopoverComponent],
  templateUrl: './session-turns.component.html',
  styleUrl: './session-turns.component.css',
})
export class SessionTurnsComponent {
  @Input({ required: true }) cost!: SessionTurnsViewModel;
  @Input({ required: true }) sort!: ModelCallSort;

  @Output() sortChange = new EventEmitter<ModelCallSort>();
  @Output() openTraceEvent = new EventEmitter<number>();

  protected readonly contextHelp = {
    timeline:
      'Each bar is one model request from the VS Code Agent Debug Log. Taller means more input was sent into the model for that request. A sharp drop means the next request sent less context. A You marker means a user prompt happened before that model request.',
    biggestRequest:
      'The single model request with the most input tokens recorded by VS Code. This helps spot the largest one-time context load.',
    limitUsed:
      'How much of the model prompt limit the biggest request used. This comes from VS Code model metadata, not billing. Lower is more room left in that one request.',
    repeatedInput:
      'Total raw input across all model calls divided by the biggest single request. High means the run repeatedly sent a lot of context, even if no one request was near the model limit.',
    calls:
      'Token-bearing model requests imported from the VS Code Agent Debug Log. Tool calls and UI events are not counted here unless they include model tokens.',
  };

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

  protected contextTimelineSummary(): string {
    const peakCall = this.contextPeakCall();
    if (!peakCall) {
      return 'No token-bearing model calls were imported for this run.';
    }

    return `Call #${peakCall.callNumber} sent the most context: ${peakCall.inputTokens.toLocaleString()} input tokens, using ${this.contextLimitPercentLabel(
      peakCall,
    )} of the model prompt limit. The run kept sending context repeatedly: ${this.contextRepeatedFactor().toFixed(
      1,
    )}x the biggest request in total.`;
  }

  protected userRequestMarkerLabel(event: ModelCallRowViewModel): string {
    return event.userRequestDetail
      ? `After user request #${event.userRequestIndex}: ${event.userRequestDetail}`
      : 'After a user request';
  }

  protected setupPayloadBadges(event: ModelCallRowViewModel): Array<{ label: string; detail: string }> {
    const payload = event.setupPayload;
    if (!payload) {
      return [];
    }

    const badges: Array<{ label: string; detail: string }> = [];

    if (payload.systemPromptChars > 0) {
      badges.push({
        label: 'Inst',
        detail: `${payload.systemPromptChars.toLocaleString()} chars from ${payload.systemPromptFile}`,
      });
    }

    if (payload.toolSchemaChars > 0 || payload.toolCount > 0) {
      badges.push({
        label: 'Tools',
        detail: `${payload.toolCount.toLocaleString()} tools, ${payload.toolSchemaChars.toLocaleString()} schema chars`,
      });
    }

    if (payload.mcpToolCount > 0) {
      badges.push({
        label: 'MCP',
        detail: `${payload.mcpToolCount.toLocaleString()} MCP tools referenced`,
      });
    }

    return badges;
  }

  protected setupPayloadSummary(event: ModelCallRowViewModel): string {
    const badges = this.setupPayloadBadges(event);
    if (!badges.length) {
      return '';
    }

    return `Setup payload: ${badges.map((badge) => badge.detail).join(' · ')}`;
  }

  protected setupPayloadChanged(event: ModelCallRowViewModel): boolean {
    const currentSignature = this.setupPayloadSignature(event);
    if (!currentSignature) {
      return false;
    }

    const previous = this.contextTimelineRows()
      .filter((candidate) => candidate.callNumber < event.callNumber)
      .reverse()
      .find((candidate) => this.setupPayloadSignature(candidate));

    return !previous || this.setupPayloadSignature(previous) !== currentSignature;
  }

  protected setupPayloadChangeSummary(event: ModelCallRowViewModel): string {
    if (!this.setupPayloadChanged(event)) {
      return '';
    }

    return this.setupPayloadSummary(event).replace('Setup payload: ', 'Setup changed: ');
  }

  private setupPayloadSignature(event: ModelCallRowViewModel): string {
    const payload = event.setupPayload;
    if (!payload) {
      return '';
    }

    return [
      payload.systemPromptFile,
      payload.systemPromptChars,
      payload.toolsFile,
      payload.toolSchemaChars,
      payload.toolCount,
      payload.mcpToolCount,
      payload.mcpToolNames.join(','),
    ].join('|');
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


