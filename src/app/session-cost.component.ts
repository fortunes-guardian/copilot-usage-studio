import { DecimalPipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession, RequestPayloadSummary, TokenBreakdown } from './session-data.model';

interface CostAnswerViewModel {
  category: string;
  categoryDetail: string;
  categoryShare: number;
  inputShare: number;
  outputShare: number;
  topModelLabel: string;
  topModelShare: number;
  topCallLabel: string;
  topCallShare: number;
  topCallDetail: string;
  costPer1k: number;
}

interface CostDriverViewModel {
  title: string;
  value: string;
  detail: string;
  tone: string;
}

interface CostCategoryViewModel {
  label: string;
  description: string;
  tokens: number;
  usd: number;
}

interface ModelCostViewModel {
  model: string;
  pricingModel: string;
  provider: string;
  turns: number;
  tokens: TokenBreakdown;
  inputRate: number;
  outputRate: number;
  cachedInputRate: number;
  cacheWriteRate?: number;
  inputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  totalUsd: number;
  share: number;
  usesFallbackPrice: boolean;
}

export interface SessionCostViewModel {
  hasCacheData: boolean;
  costAnswer: CostAnswerViewModel;
  costDrivers: CostDriverViewModel[];
  categoryRows: CostCategoryViewModel[];
  modelRows: ModelCostViewModel[];
}

export interface CostHelpText {
  appEstimate: string;
  inputTokens: string;
  outputTokens: string;
  priceRow: string;
}

@Component({
  selector: 'app-session-cost',
  imports: [DecimalPipe, NgClass, HelpPopoverComponent],
  templateUrl: './session-cost.component.html',
  styleUrl: './session-cost.component.css',
})
export class SessionCostComponent {
  @Input({ required: true }) session!: CopilotSession;
  @Input({ required: true }) cost!: SessionCostViewModel;
  @Input({ required: true }) help!: CostHelpText;
  @Input({ required: true }) pricingSourceUrl!: string;

  protected isCacheCategory(category: CostCategoryViewModel): boolean {
    return category.label === 'Cached input' || category.label === 'Cache write';
  }

  protected formatCompactNumber(value: number): string {
    if (value >= 1000) {
      return `${(value / 1000).toLocaleString(undefined, {
        maximumFractionDigits: value >= 10000 ? 0 : 1,
      })}k`;
    }

    return value.toLocaleString();
  }

  protected hasPayloadEvidence(payload: RequestPayloadSummary | undefined): boolean {
    if (!payload) {
      return false;
    }

    return Boolean(
      payload.systemPromptChars ||
        payload.toolSchemaChars ||
        payload.toolCount ||
        payload.mcpToolCount ||
        payload.toolResultCharsByName.length ||
        payload.reasoningEfforts.length,
    );
  }

  protected payloadSizeLabel(chars: number): string {
    if (chars >= 1_000_000) {
      return `${(chars / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M chars`;
    }

    if (chars >= 1_000) {
      return `${(chars / 1_000).toLocaleString(undefined, { maximumFractionDigits: chars >= 10_000 ? 0 : 1 })}k chars`;
    }

    return `${chars.toLocaleString()} chars`;
  }

  protected topToolSchemas(payload: RequestPayloadSummary) {
    return payload.largestToolSchemas.slice(0, 4);
  }

  protected topToolResults(payload: RequestPayloadSummary) {
    return [...payload.toolResultCharsByName]
      .sort((a, b) => b.resultChars + b.argsChars - (a.resultChars + a.argsChars))
      .slice(0, 4);
  }

  protected mcpToolSummary(payload: RequestPayloadSummary): string {
    if (!payload.mcpToolCount) {
      return 'No MCP tools found in imported tool schema side files.';
    }

    const names = payload.mcpToolNames.slice(0, 3).join(', ');
    const suffix = payload.mcpToolNames.length > 3 ? `, +${payload.mcpToolNames.length - 3} more` : '';
    return names ? `${names}${suffix}` : 'MCP tools were counted, but names were not available.';
  }
}


