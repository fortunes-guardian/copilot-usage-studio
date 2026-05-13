import { DecimalPipe, NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { HelpPopoverComponent } from './help-popover.component';
import { CopilotSession } from './session-data.model';
import {
  PricedModelBreakdown,
  explainModelCost,
  percentDelta,
  pricingFallbackReason,
  sessionTotalTokens,
  setsDiffer,
  tokenTotal,
  usesPricingFallback,
} from './session-cost-utils';

type WarningTone = 'low' | 'info' | 'medium' | 'high';

interface ComparisonMetric {
  label: string;
  a: number;
  b: number;
  delta: number;
  percent: number | null;
  format: 'currency' | 'number';
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
  session: CopilotSession;
  modelRows: PricedModelBreakdown[];
  totalTokens: number;
  inputUsd: number;
  outputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  topModel: PricedModelBreakdown | null;
  modelNames: Set<string>;
  pricingRows: Set<string>;
}

interface PromptMatchGroup {
  key: string;
  prompt: string;
  sessions: CopilotSession[];
  cheapest: CopilotSession;
  mostExpensive: CopilotSession;
  newest: CopilotSession;
  oldest: CopilotSession;
  costRangeUsd: number;
  tokenRange: number;
}

@Component({
  selector: 'app-compare-page',
  imports: [DecimalPipe, FormsModule, HelpPopoverComponent, NgClass],
  templateUrl: './compare-page.component.html',
  styleUrl: './compare-page.component.css',
})
export class ComparePageComponent {
  private readonly sessionsInput = signal<CopilotSession[]>([]);
  private readonly compareAInput = signal<string | null>(null);
  private readonly compareBInput = signal<string | null>(null);

  @Output() readonly compareAChange = new EventEmitter<string | null>();
  @Output() readonly compareBChange = new EventEmitter<string | null>();

  @Input() set sessions(value: CopilotSession[] | null | undefined) {
    this.sessionsInput.set(value ?? []);
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
  protected readonly promptGroups = computed(() => this.samePromptGroups(this.sessionOptions()));
  protected readonly selectedPromptMatch = computed(() => {
    const a = this.sessionOptions().find((session) => session.id === this.selectedAId());
    const b = this.sessionOptions().find((session) => session.id === this.selectedBId());

    if (!a || !b) {
      return null;
    }

    return normalizePrompt(a.firstPrompt) && normalizePrompt(a.firstPrompt) === normalizePrompt(b.firstPrompt)
      ? this.promptGroups().find((group) => group.key === normalizePrompt(a.firstPrompt)) ?? null
      : null;
  });

  protected readonly comparison = computed(() => {
    const a = this.sessionOptions().find((session) => session.id === this.selectedAId());
    const b = this.sessionOptions().find((session) => session.id === this.selectedBId());

    if (!a || !b || a.id === b.id) {
      return null;
    }

    const aAnalysis = this.sessionComparisonAnalysis(a);
    const bAnalysis = this.sessionComparisonAnalysis(b);
    const totalTokenDelta = bAnalysis.totalTokens - aAnalysis.totalTokens;
    const costDelta = b.cost.usd - a.cost.usd;
    const inputCostDelta = bAnalysis.inputUsd - aAnalysis.inputUsd;
    const outputCostDelta = bAnalysis.outputUsd - aAnalysis.outputUsd;
    const toolDelta = b.traceSummary.toolCalls - a.traceSummary.toolCalls;
    const turnDelta = b.traceSummary.modelTurns - a.traceSummary.modelTurns;

    return {
      a,
      b,
      aAnalysis,
      bAnalysis,
      promptMatch: normalizePrompt(a.firstPrompt) === normalizePrompt(b.firstPrompt),
      promptMatchCount:
        this.promptGroups().find((group) => group.key === normalizePrompt(a.firstPrompt))?.sessions.length ?? 0,
      costDelta,
      totalTokenDelta,
      percent: percentDelta(a.cost.usd, b.cost.usd),
      summary: this.comparisonSummary(costDelta, totalTokenDelta, inputCostDelta, outputCostDelta, toolDelta, turnDelta),
      metrics: [
        {
          label: 'Estimated cost',
          a: a.cost.usd,
          b: b.cost.usd,
          delta: costDelta,
          percent: percentDelta(a.cost.usd, b.cost.usd),
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

  protected applyPromptGroup(group: PromptMatchGroup): void {
    this.setCompareA(group.oldest.id);
    this.setCompareB(group.newest.id);
  }

  protected compareCheapestToMostExpensive(group: PromptMatchGroup): void {
    this.setCompareA(group.cheapest.id);
    this.setCompareB(group.mostExpensive.id);
  }

  protected sessionOptionLabel(session: CopilotSession): string {
    const date = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(session.startedAt));

    return `${session.title} · ${date} · $${session.cost.usd.toFixed(2)}`;
  }

  protected compactPrompt(prompt: string): string {
    const compact = prompt.replace(/\s+/g, ' ').trim();
    return compact.length > 140 ? `${compact.slice(0, 139)}…` : compact;
  }

  private sessionComparisonAnalysis(session: CopilotSession): SessionComparisonAnalysis {
    const modelRows = session.modelBreakdown.map((entry) => explainModelCost(entry, session.cost.usd));
    const topModel = [...modelRows].sort((a, b) => b.totalUsd - a.totalUsd)[0] ?? null;

    return {
      session,
      modelRows,
      totalTokens: sessionTotalTokens(session),
      inputUsd: modelRows.reduce((sum, row) => sum + row.inputUsd, 0),
      outputUsd: modelRows.reduce((sum, row) => sum + row.outputUsd, 0),
      cachedInputUsd: modelRows.reduce((sum, row) => sum + row.cachedInputUsd, 0),
      cacheWriteUsd: modelRows.reduce((sum, row) => sum + row.cacheWriteUsd, 0),
      topModel,
      modelNames: new Set(modelRows.map((row) => row.model)),
      pricingRows: new Set(modelRows.map((row) => row.pricingModel)),
    };
  }

  private samePromptGroups(sessions: CopilotSession[]): PromptMatchGroup[] {
    const byPrompt = new Map<string, CopilotSession[]>();

    for (const session of sessions) {
      const key = normalizePrompt(session.firstPrompt);

      if (!key) {
        continue;
      }

      byPrompt.set(key, [...(byPrompt.get(key) ?? []), session]);
    }

    return [...byPrompt.entries()]
      .filter(([, groupSessions]) => groupSessions.length > 1)
      .map(([key, groupSessions]) => {
        const sortedByDate = [...groupSessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        const sortedByCost = [...groupSessions].sort((a, b) => a.cost.usd - b.cost.usd);
        const tokenTotals = groupSessions.map(sessionTotalTokens);

        return {
          key,
          prompt: groupSessions[0].firstPrompt,
          sessions: sortedByDate,
          cheapest: sortedByCost[0],
          mostExpensive: sortedByCost[sortedByCost.length - 1],
          oldest: sortedByDate[0],
          newest: sortedByDate[sortedByDate.length - 1],
          costRangeUsd: sortedByCost[sortedByCost.length - 1].cost.usd - sortedByCost[0].cost.usd,
          tokenRange: Math.max(...tokenTotals) - Math.min(...tokenTotals),
        };
      })
      .sort((a, b) => b.sessions.length - a.sessions.length || b.costRangeUsd - a.costRangeUsd);
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
    const topModelChanged = a.topModel?.pricingModel !== b.topModel?.pricingModel;

    return [
      {
        title: 'Cost movement',
        value: costDelta > 0 ? 'Higher' : costDelta < 0 ? 'Lower' : 'Flat',
        tone: costDelta > 0 ? 'high' : costDelta < 0 ? 'info' : 'medium',
        detail:
          costDelta === 0
            ? 'The imported estimate did not materially change between these two runs.'
            : `Run B moved by ${costDelta > 0 ? '+' : '-'}$${Math.abs(costDelta).toFixed(4)}. Cheaper is only better if the run still did the job.`,
      },
      {
        title: 'Priced token driver',
        value: Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'Input' : 'Output',
        tone: Math.abs(inputCostDelta) >= Math.abs(outputCostDelta) ? 'high' : 'medium',
        detail:
          Math.abs(inputCostDelta) >= Math.abs(outputCostDelta)
            ? `Input/context cost moved by ${inputCostDelta >= 0 ? '+' : '-'}$${Math.abs(inputCostDelta).toFixed(4)}. This is usually repo context, prior chat, or tool results.`
            : `Output cost moved by ${outputCostDelta >= 0 ? '+' : '-'}$${Math.abs(outputCostDelta).toFixed(4)}. The later run generated more or less text.`,
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
          aCost: a?.totalUsd ?? 0,
          bCost: b?.totalUsd ?? 0,
          costDelta: (b?.totalUsd ?? 0) - (a?.totalUsd ?? 0),
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

function normalizePrompt(prompt: string): string {
  return String(prompt ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#/@._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


