import { DecimalPipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession, TokenBreakdown } from './session-data.model';

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

interface BillingRealityViewModel {
  tone: string;
  confidenceLabel: string;
  headline: string;
  cacheVisibility: string;
  detail: string;
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
  outputUsd: number;
  totalUsd: number;
  share: number;
  usesFallbackPrice: boolean;
}

export interface SessionCostViewModel {
  hasCacheData: boolean;
  sourceStrength: string;
  sourceDescription: string;
  cacheStatus: string;
  cacheDescription: string;
  costAnswer: CostAnswerViewModel;
  billingReality: BillingRealityViewModel;
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
}


