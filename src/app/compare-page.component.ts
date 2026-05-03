import { DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LedgerSession } from './ledger.model';
import {
  PricedModelBreakdown,
  contextStats,
  explainModelCost,
  percentDelta,
  pricingFallbackReason,
  sessionTotalTokens,
  setsDiffer,
  tokenTotal,
  usesPricingFallback,
} from './ledger-cost-utils';

type WarningTone = 'low' | 'info' | 'medium' | 'high';

interface ComparisonMetric {
  label: string;
  a: number;
  b: number;
  delta: number;
  percent: number | null;
  format: 'currency' | 'number' | 'percent';
  lowerIsBetter: boolean;
  help: string;
}

interface ComparisonDriver {
  title: string;
  value: string;
  tone: WarningTone;
  detail: string;
}

interface SessionComparisonAnalysis {
  session: LedgerSession;
  modelRows: PricedModelBreakdown[];
  totalTokens: number;
  inputEur: number;
  outputEur: number;
  cachedInputEur: number;
  cacheWriteEur: number;
  contextGrowth: number;
  firstInputAvg: number;
  lastInputAvg: number;
  topModel: PricedModelBreakdown | null;
  modelNames: Set<string>;
  pricingRows: Set<string>;
}

@Component({
  selector: 'app-compare-page',
  imports: [DecimalPipe, FormsModule, NgClass],
  templateUrl: './compare-page.component.html',
  styleUrl: './compare-page.component.css',
})
export class ComparePageComponent {
  private readonly sessionsInput = signal<LedgerSession[]>([]);
  private readonly usdToEurInput = signal(1);
  private readonly compareAInput = signal<string | null>(null);
  private readonly compareBInput = signal<string | null>(null);

  @Output() readonly compareAChange = new EventEmitter<string | null>();
  @Output() readonly compareBChange = new EventEmitter<string | null>();

  @Input() set sessions(value: LedgerSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
  }

  @Input() set usdToEur(value: number | null | undefined) {
    this.usdToEurInput.set(value ?? 1);
  }

  @Input() set compareA(value: string | null | undefined) {
    this.compareAInput.set(value ?? null);
  }

  @Input() set compareB(value: string | null | undefined) {
    this.compareBInput.set(value ?? null);
  }

  protected readonly sessionOptions = computed(() => this.sessionsInput());
  protected readonly selectedAId = computed(() => this.compareAInput() ?? this.sessionOptions()[0]?.id ?? null);
  protected readonly selectedBId = computed(() => this.compareBInput() ?? this.sessionOptions()[1]?.id ?? null);
  protected readonly abs = Math.abs;
  protected readonly pricingFallbackReason = pricingFallbackReason;

  protected readonly comparison = computed(() => {
    const a = this.sessionOptions().find((session) => session.id === this.selectedAId());
    const b = this.sessionOptions().find((session) => session.id === this.selectedBId());

    if (!a || !b || a.id === b.id) {
      return null;
    }

    const usdToEur = this.usdToEurInput();
    const aAnalysis = this.sessionComparisonAnalysis(a, usdToEur);
    const bAnalysis = this.sessionComparisonAnalysis(b, usdToEur);
    const totalTokenDelta = bAnalysis.totalTokens - aAnalysis.totalTokens;
    const costDelta = b.cost.eur - a.cost.eur;
    const inputCostDelta = bAnalysis.inputEur - aAnalysis.inputEur;
    const outputCostDelta = bAnalysis.outputEur - aAnalysis.outputEur;
    const toolDelta = b.traceSummary.toolCalls - a.traceSummary.toolCalls;
    const turnDelta = b.traceSummary.modelTurns - a.traceSummary.modelTurns;
    const contextGrowthDelta = bAnalysis.contextGrowth - aAnalysis.contextGrowth;

    return {
      a,
      b,
      aAnalysis,
      bAnalysis,
      costDelta,
      totalTokenDelta,
      percent: percentDelta(a.cost.eur, b.cost.eur),
      summary: this.comparisonSummary(costDelta, totalTokenDelta, inputCostDelta, outputCostDelta, toolDelta, turnDelta),
      metrics: [
        {
          label: 'Estimated cost',
          a: a.cost.eur,
          b: b.cost.eur,
          delta: costDelta,
          percent: percentDelta(a.cost.eur, b.cost.eur),
          format: 'currency',
          lowerIsBetter: true,
          help: 'Local estimate from imported VS Code token totals and GitHub price rows.',
        },
        {
          label: 'Input tokens',
          a: a.tokens.input,
          b: b.tokens.input,
          delta: b.tokens.input - a.tokens.input,
          percent: percentDelta(a.tokens.input, b.tokens.input),
          format: 'number',
          lowerIsBetter: true,
          help: 'Prompt, repo context, prior conversation, and tool results sent into the model.',
        },
        {
          label: 'Output tokens',
          a: a.tokens.output,
          b: b.tokens.output,
          delta: b.tokens.output - a.tokens.output,
          percent: percentDelta(a.tokens.output, b.tokens.output),
          format: 'number',
          lowerIsBetter: false,
          help: 'Generated response tokens. More output can be useful, but it still affects cost.',
        },
        {
          label: 'Model turns',
          a: a.traceSummary.modelTurns,
          b: b.traceSummary.modelTurns,
          delta: turnDelta,
          percent: percentDelta(a.traceSummary.modelTurns, b.traceSummary.modelTurns),
          format: 'number',
          lowerIsBetter: false,
          help: 'Model request count. More turns often means more accumulated context gets resent.',
        },
        {
          label: 'Tool calls',
          a: a.traceSummary.toolCalls,
          b: b.traceSummary.toolCalls,
          delta: toolDelta,
          percent: percentDelta(a.traceSummary.toolCalls, b.traceSummary.toolCalls),
          format: 'number',
          lowerIsBetter: false,
          help: 'Tool activity. Tool results can become later input context.',
        },
        {
          label: 'Context growth',
          a: aAnalysis.contextGrowth,
          b: bAnalysis.contextGrowth,
          delta: contextGrowthDelta,
          percent: null,
          format: 'percent',
          lowerIsBetter: true,
          help: 'How much average input tokens grew from early model calls to late model calls.',
        },
      ] satisfies ComparisonMetric[],
      drivers: this.comparisonDrivers(aAnalysis, bAnalysis, costDelta, inputCostDelta, outputCostDelta, toolDelta, turnDelta),
      modelRows: this.compareModelRows(aAnalysis.modelRows, bAnalysis.modelRows),
    };
  });

  protected setCompareA(value: string | null): void {
    this.compareAInput.set(value);
    this.compareAChange.emit(value);
  }

  protected setCompareB(value: string | null): void {
    this.compareBInput.set(value);
    this.compareBChange.emit(value);
  }

  private sessionComparisonAnalysis(session: LedgerSession, usdToEur: number): SessionComparisonAnalysis {
    const modelRows = session.modelBreakdown.map((entry) => explainModelCost(entry, usdToEur, session.cost.eur));
    const stats = contextStats(session);
    const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0] ?? null;

    return {
      session,
      modelRows,
      totalTokens: sessionTotalTokens(session),
      inputEur: modelRows.reduce((sum, row) => sum + row.inputEur, 0),
      outputEur: modelRows.reduce((sum, row) => sum + row.outputEur, 0),
      cachedInputEur: modelRows.reduce((sum, row) => sum + row.cachedInputEur, 0),
      cacheWriteEur: modelRows.reduce((sum, row) => sum + row.cacheWriteEur, 0),
      contextGrowth: stats?.growth ?? 0,
      firstInputAvg: stats?.firstAvg ?? 0,
      lastInputAvg: stats?.lastAvg ?? 0,
      topModel,
      modelNames: new Set(modelRows.map((row) => row.model)),
      pricingRows: new Set(modelRows.map((row) => row.pricingModel)),
    };
  }

  private comparisonSummary(
    costDelta: number,
    totalTokenDelta: number,
    inputCostDelta: number,
    outputCostDelta: number,
    toolDelta: number,
    turnDelta: number,
  ): string {
    const direction = costDelta > 0 ? 'more expensive' : costDelta < 0 ? 'cheaper' : 'about the same cost';
    const tokenDirection = totalTokenDelta > 0 ? 'more' : totalTokenDelta < 0 ? 'fewer' : 'the same number of';
    const costDriver =
      Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'input/context tokens' : 'generated output tokens';
    const activity =
      Math.abs(turnDelta) >= Math.abs(toolDelta)
        ? `${Math.abs(turnDelta).toLocaleString()} ${turnDelta >= 0 ? 'more' : 'fewer'} model turns`
        : `${Math.abs(toolDelta).toLocaleString()} ${toolDelta >= 0 ? 'more' : 'fewer'} tool calls`;

    if (costDelta === 0 && totalTokenDelta === 0) {
      return 'These runs look equivalent on imported cost and token totals. Check logs if behavior differed qualitatively.';
    }

    return `Run B is ${direction}, with ${Math.abs(totalTokenDelta).toLocaleString()} ${tokenDirection} imported tokens. The largest priced movement is ${costDriver}; activity changed by ${activity}.`;
  }

  private comparisonDrivers(
    a: SessionComparisonAnalysis,
    b: SessionComparisonAnalysis,
    costDelta: number,
    inputCostDelta: number,
    outputCostDelta: number,
    toolDelta: number,
    turnDelta: number,
  ): ComparisonDriver[] {
    const modelChanged = setsDiffer(a.modelNames, b.modelNames) || setsDiffer(a.pricingRows, b.pricingRows);
    const contextDelta = b.contextGrowth - a.contextGrowth;
    const topModelChanged = a.topModel?.pricingModel !== b.topModel?.pricingModel;

    return [
      {
        title: 'Cost movement',
        value: costDelta > 0 ? 'Higher' : costDelta < 0 ? 'Lower' : 'Flat',
        tone: costDelta > 0 ? 'high' : costDelta < 0 ? 'info' : 'medium',
        detail:
          costDelta === 0
            ? 'The imported estimate did not materially change between these two runs.'
            : `Run B moved by ${costDelta > 0 ? '+' : '-'}€${Math.abs(costDelta).toFixed(4)}. Cheaper is only better if the run still did the job.`,
      },
      {
        title: 'Priced token driver',
        value: Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'Input' : 'Output',
        tone: Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'high' : 'medium',
        detail:
          Math.abs(inputCostDelta) >= Math.abs(outputCostDelta)
            ? `Input/context cost moved by ${inputCostDelta >= 0 ? '+' : '-'}€${Math.abs(inputCostDelta).toFixed(4)}. This is usually repo context, prior chat, or tool results.`
            : `Output cost moved by ${outputCostDelta >= 0 ? '+' : '-'}€${Math.abs(outputCostDelta).toFixed(4)}. The later run generated more or less text.`,
      },
      {
        title: 'Model pricing',
        value: modelChanged ? 'Changed' : 'Same',
        tone: modelChanged || topModelChanged ? 'medium' : 'info',
        detail: modelChanged
          ? `The model or pricing-row mix changed. A: ${[...a.pricingRows].join(', ')}. B: ${[...b.pricingRows].join(', ')}.`
          : `Both runs used the same imported pricing row mix: ${[...b.pricingRows].join(', ')}.`,
      },
      {
        title: 'Context shape',
        value: `${contextDelta >= 0 ? '+' : ''}${contextDelta.toFixed(0)} pts`,
        tone: contextDelta >= 50 ? 'high' : Math.abs(contextDelta) >= 20 ? 'medium' : 'info',
        detail: `Average input growth moved from ${a.contextGrowth.toFixed(0)}% to ${b.contextGrowth.toFixed(0)}%. This is a cost signal, not proof of a problem.`,
      },
      {
        title: 'Agent activity',
        value: `${turnDelta >= 0 ? '+' : ''}${turnDelta} turns`,
        tone: turnDelta > 3 || toolDelta > 10 ? 'medium' : 'info',
        detail: `Run B has ${Math.abs(turnDelta)} ${turnDelta >= 0 ? 'more' : 'fewer'} model turns and ${Math.abs(toolDelta)} ${toolDelta >= 0 ? 'more' : 'fewer'} tool calls.`,
      },
    ];
  }

  private compareModelRows(aRows: PricedModelBreakdown[], bRows: PricedModelBreakdown[]) {
    const keys = new Set([...aRows, ...bRows].map((row) => `${row.model}::${row.pricingModel}`));

    return [...keys]
      .map((key) => {
        const [model, pricingModel] = key.split('::');
        const a = aRows.find((row) => row.model === model && row.pricingModel === pricingModel);
        const b = bRows.find((row) => row.model === model && row.pricingModel === pricingModel);
        const aTokens = a ? tokenTotal(a.tokens) : 0;
        const bTokens = b ? tokenTotal(b.tokens) : 0;

        return {
          model,
          pricingModel,
          usesFallbackPrice: usesPricingFallback(model, pricingModel),
          aCost: a?.totalEur ?? 0,
          bCost: b?.totalEur ?? 0,
          costDelta: (b?.totalEur ?? 0) - (a?.totalEur ?? 0),
          aTokens,
          bTokens,
          tokenDelta: bTokens - aTokens,
          aTurns: a?.turns ?? 0,
          bTurns: b?.turns ?? 0,
        };
      })
      .sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta));
  }
}
