import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LedgerData, LedgerSession, ModelBreakdown, TokenBreakdown, TraceEvent } from './ledger.model';
import {
  MODEL_PRICES_USD_PER_MILLION,
  PRICING_EFFECTIVE_DATE,
  PRICING_IMPORTED_AT,
  PRICING_SOURCE_LABEL,
  PRICING_SOURCE_URL,
  PRICING_VERSION,
} from './pricing';

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, FormsModule, NgClass],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly ledger = signal<LedgerData | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly compareA = signal<string | null>(null);
  protected readonly compareB = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly traceView = signal<'logs' | 'flow'>('logs');
  protected readonly activeView = signal<'sessions' | 'pricing'>('sessions');
  protected readonly pricingVersion = PRICING_VERSION;
  protected readonly pricingSourceLabel = PRICING_SOURCE_LABEL;
  protected readonly pricingSourceUrl = PRICING_SOURCE_URL;
  protected readonly pricingEffectiveDate = PRICING_EFFECTIVE_DATE;
  protected readonly pricingImportedAt = PRICING_IMPORTED_AT;

  protected readonly sessions = computed(() => this.ledger()?.sessions ?? []);
  protected readonly pricingRows = computed(() =>
    Object.entries(MODEL_PRICES_USD_PER_MILLION).map(([model, price]) => ({
      model,
      ...price,
      cacheWrite: price.cacheWrite ?? 0,
      usedByImportedSessions: this.sessions().some((session) =>
        session.modelBreakdown.some((entry) => entry.pricingModel === model),
      ),
    })),
  );
  protected readonly costExplanation = computed(() => {
    const session = this.selectedSession();
    const ledger = this.ledger();

    if (!session || !ledger) {
      return null;
    }

    const modelRows = session.modelBreakdown.map((entry) =>
      this.explainModelCost(entry, ledger.usdToEur, session.cost.eur),
    );
    const categoryRows = this.explainCategoryCosts(modelRows);
    const topTokenEvents = this.topTokenEvents(session.traceEvents, session.modelBreakdown, ledger.usdToEur);
    const costDrivers = this.explainCostDrivers(session, modelRows, topTokenEvents);
    const hasCacheData = session.tokens.cachedInput > 0 || session.tokens.cacheWrite > 0;

    return {
      hasCacheData,
      sourceStrength:
        session.tokenSource === 'llm_request_token_totals'
          ? 'Exact local input/output token totals'
          : 'Estimated token totals',
      sourceDescription:
        session.tokenSource === 'llm_request_token_totals'
          ? 'Imported from VS Code Copilot debug-log llm_request events. This is the strongest local source for session input and output tokens.'
          : 'Estimated from visible chat/session data. Useful context, but weaker than debug-log llm_request totals.',
      cacheStatus: hasCacheData ? 'Cache tokens imported' : 'Cache tokens not present in local logs',
      cacheDescription: hasCacheData
        ? 'This session includes cached input or cache-write token totals in the generated ledger.'
        : 'The VS Code debug-log events imported for this session expose inputTokens and outputTokens, but not billing cache read/write fields. The estimate therefore prices visible local input/output totals and keeps cache accounting explicit as unavailable.',
      modelRows,
      categoryRows,
      costDrivers,
      topTokenEvents,
    };
  });
  protected readonly flowEvents = computed(() => {
    const session = this.selectedSession();
    const ledger = this.ledger();

    if (!session || !ledger) {
      return [];
    }

    return this.flowTraceEvents(session.traceEvents, session.modelBreakdown, ledger.usdToEur);
  });
  protected readonly filteredSessions = computed(() => {
    const query = this.query().trim().toLowerCase();
    const sessions = [...this.sessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    if (!query) {
      return sessions;
    }

    return sessions.filter((session) =>
      [session.firstPrompt, session.title, session.workspace, session.model, session.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });

  protected readonly selectedSession = computed(() => {
    const id = this.selectedId() ?? this.filteredSessions()[0]?.id;
    return this.sessions().find((session) => session.id === id) ?? null;
  });

  protected readonly summary = computed(() => {
    const sessions = this.sessions();
    const totals = sessions.reduce(
      (acc, session) => {
        acc.usd += session.cost.usd;
        acc.eur += session.cost.eur;
        acc.input += session.tokens.input;
        acc.output += session.tokens.output;
        acc.cachedInput += session.tokens.cachedInput;
        acc.cacheWrite += session.tokens.cacheWrite;
        return acc;
      },
      { usd: 0, eur: 0, input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
    );

    return { count: sessions.length, ...totals };
  });

  protected readonly comparison = computed(() => {
    const a = this.sessions().find((session) => session.id === this.compareA());
    const b = this.sessions().find((session) => session.id === this.compareB());

    if (!a || !b || a.id === b.id) {
      return null;
    }

    return {
      a,
      b,
      eurDelta: b.cost.eur - a.cost.eur,
      inputDelta: b.tokens.input - a.tokens.input,
      outputDelta: b.tokens.output - a.tokens.output,
      cachedDelta: b.tokens.cachedInput - a.tokens.cachedInput,
      tokenDelta:
        b.tokens.input +
        b.tokens.cachedInput +
        b.tokens.cacheWrite +
        b.tokens.output -
        (a.tokens.input + a.tokens.cachedInput + a.tokens.cacheWrite + a.tokens.output),
      percent: a.cost.eur === 0 ? 0 : ((b.cost.eur - a.cost.eur) / a.cost.eur) * 100,
    };
  });
  protected readonly abs = Math.abs;

  constructor() {
    this.http.get<LedgerData>('/data/sessions.json').subscribe((ledger) => {
      this.ledger.set(ledger);
      this.selectedId.set(ledger.sessions[0]?.id ?? null);
      this.compareA.set(ledger.sessions[0]?.id ?? null);
      this.compareB.set(ledger.sessions[1]?.id ?? null);
    });
  }

  protected selectSession(session: LedgerSession): void {
    this.selectedId.set(session.id);
  }

  protected trackBySessionId(_: number, session: LedgerSession): string {
    return session.id;
  }

  protected setQuery(value: string): void {
    this.query.set(value);
  }

  private explainModelCost(entry: ModelBreakdown, usdToEur: number, sessionCostEur: number) {
    const pricingModel = entry.pricingModel || entry.model;
    const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];
    const inputEur = this.tokenCostEur(entry.tokens.input, price.input, usdToEur);
    const cachedInputEur = this.tokenCostEur(entry.tokens.cachedInput, price.cachedInput, usdToEur);
    const cacheWriteEur = this.tokenCostEur(entry.tokens.cacheWrite, price.cacheWrite ?? 0, usdToEur);
    const outputEur = this.tokenCostEur(entry.tokens.output, price.output, usdToEur);
    const totalEur = inputEur + cachedInputEur + cacheWriteEur + outputEur;

    return {
      ...entry,
      provider: price.provider,
      releaseStatus: price.releaseStatus,
      category: price.category,
      inputRate: price.input,
      cachedInputRate: price.cachedInput,
      cacheWriteRate: price.cacheWrite ?? 0,
      outputRate: price.output,
      inputEur,
      cachedInputEur,
      cacheWriteEur,
      outputEur,
      totalEur,
      share: sessionCostEur > 0 ? (totalEur / sessionCostEur) * 100 : 0,
      usesFallbackPrice: pricingModel !== entry.model || !MODEL_PRICES_USD_PER_MILLION[entry.model],
    };
  }

  private explainCategoryCosts(modelRows: ReturnType<App['explainModelCost']>[]) {
    return [
      {
        label: 'Input',
        tokens: this.sumTokens(modelRows, 'input'),
        eur: modelRows.reduce((sum, row) => sum + row.inputEur, 0),
        description: 'Prompt, context, tool, and repository material sent into the model.',
      },
      {
        label: 'Output',
        tokens: this.sumTokens(modelRows, 'output'),
        eur: modelRows.reduce((sum, row) => sum + row.outputEur, 0),
        description: 'Generated model response tokens.',
      },
      {
        label: 'Cached input',
        tokens: this.sumTokens(modelRows, 'cachedInput'),
        eur: modelRows.reduce((sum, row) => sum + row.cachedInputEur, 0),
        description: 'Prompt tokens served from provider cache when that billing signal is available.',
      },
      {
        label: 'Cache write',
        tokens: this.sumTokens(modelRows, 'cacheWrite'),
        eur: modelRows.reduce((sum, row) => sum + row.cacheWriteEur, 0),
        description: 'Provider cache creation tokens. GitHub lists this mainly for Anthropic models.',
      },
    ];
  }

  private explainCostDrivers(
    session: LedgerSession,
    modelRows: ReturnType<App['explainModelCost']>[],
    topTokenEvents: ReturnType<App['topTokenEvents']>,
  ) {
    const inputEur = modelRows.reduce((sum, row) => sum + row.inputEur, 0);
    const outputEur = modelRows.reduce((sum, row) => sum + row.outputEur, 0);
    const sessionCost = Math.max(session.cost.eur, 0);
    const inputShare = sessionCost > 0 ? (inputEur / sessionCost) * 100 : 0;
    const outputShare = sessionCost > 0 ? (outputEur / sessionCost) * 100 : 0;
    const topCall = topTokenEvents[0];
    const topCallShare = topCall && sessionCost > 0 ? (topCall.estimatedEur / sessionCost) * 100 : 0;
    const topModel = [...modelRows].sort((a, b) => b.totalEur - a.totalEur)[0];
    const topModelShare = topModel && sessionCost > 0 ? (topModel.totalEur / sessionCost) * 100 : 0;
    const llmEvents = session.traceEvents
      .filter((event) => event.type === 'llm_request' && (event.inputTokens || event.outputTokens))
      .sort((a, b) => a.index - b.index);
    const firstInputs = llmEvents.slice(0, 3).map((event) => event.inputTokens);
    const lastInputs = llmEvents.slice(-3).map((event) => event.inputTokens);
    const firstAvg = this.average(firstInputs);
    const lastAvg = this.average(lastInputs);
    const growth = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0;
    const toolCalls = session.traceSummary.toolCalls;
    const toolsPerTurn = session.traceSummary.modelTurns > 0 ? toolCalls / session.traceSummary.modelTurns : 0;
    const mixedModelCount = modelRows.length;

    return [
      {
        title: 'Input context burn',
        value: `${Math.round(inputShare)}%`,
        detail:
          inputShare >= outputShare
            ? `Most cost is prompt/context material sent into the model: ${session.tokens.input.toLocaleString()} input tokens.`
            : `Output is the larger priced category here, but input still contributes ${inputShare.toFixed(0)}% of this estimate.`,
        tone: inputShare >= 75 ? 'high' : inputShare >= 50 ? 'medium' : 'low',
      },
      {
        title: 'Largest model call',
        value: topCall ? `€${topCall.estimatedEur.toFixed(4)}` : 'None',
        detail: topCall
          ? `Raw event #${topCall.index + 1} used ${topCall.totalTokens.toLocaleString()} tokens and accounts for about ${topCallShare.toFixed(0)}% of this run.`
          : 'No token-bearing model calls were imported for this session.',
        tone: topCallShare >= 25 ? 'high' : topCallShare >= 10 ? 'medium' : 'low',
      },
      {
        title: 'Context growth',
        value: llmEvents.length >= 2 ? `${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%` : 'n/a',
        detail:
          llmEvents.length >= 2
            ? `Average input moved from ${Math.round(firstAvg).toLocaleString()} tokens at the start to ${Math.round(lastAvg).toLocaleString()} near the end.`
            : 'Not enough model calls to detect whether context grew during the run.',
        tone: growth >= 80 ? 'high' : growth >= 25 ? 'medium' : 'low',
      },
      {
        title: 'Model mix',
        value: mixedModelCount === 1 ? topModel?.model ?? session.model : `${mixedModelCount} models`,
        detail: topModel
          ? `${topModel.model} contributes about ${topModelShare.toFixed(0)}% of estimated cost using the ${topModel.pricingModel} price row.`
          : 'No model breakdown is available for this session.',
        tone: mixedModelCount > 1 || topModelShare >= 80 ? 'medium' : 'low',
      },
      {
        title: 'Tool activity',
        value: toolCalls.toLocaleString(),
        detail:
          toolCalls > 0
            ? `${toolsPerTurn.toFixed(1)} tool calls per model turn. Tool results can increase later prompt/context size when they are sent back to the model.`
            : 'No tool calls were imported for this session.',
        tone: toolsPerTurn >= 4 ? 'high' : toolsPerTurn >= 2 ? 'medium' : 'low',
      },
    ];
  }

  private topTokenEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
    return events
      .filter((event) => event.inputTokens || event.outputTokens)
      .map((event) => {
        const pricingModel = this.pricingModelForEvent(event, modelBreakdown);
        const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];
        const estimatedEur =
          event.estimatedCost?.eur ??
          this.tokenCostEur(event.inputTokens, price.input, usdToEur) +
            this.tokenCostEur(event.outputTokens, price.output, usdToEur);

        return {
          ...event,
          totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
          pricingModel,
          estimatedEur,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 5);
  }

  private flowTraceEvents(events: TraceEvent[], modelBreakdown: ModelBreakdown[], usdToEur: number) {
    return events
      .filter((event) => this.isFlowEvent(event))
      .map((event, index) => {
        const pricingModel = this.pricingModelForEvent(event, modelBreakdown);
        const price = MODEL_PRICES_USD_PER_MILLION[pricingModel] ?? MODEL_PRICES_USD_PER_MILLION['GPT-5.4'];
        const estimatedEur =
          event.estimatedCost?.eur ??
          this.tokenCostEur(event.inputTokens, price.input, usdToEur) +
            this.tokenCostEur(event.outputTokens, price.output, usdToEur);

        return {
          ...event,
          flowIndex: index + 1,
          totalTokens: event.totalTokens ?? event.inputTokens + event.outputTokens,
          pricingModel,
          estimatedEur,
        };
      });
  }

  private isFlowEvent(event: TraceEvent): boolean {
    return (
      event.type === 'user_message' ||
      event.type === 'llm_request' ||
      event.type.includes('tool') ||
      event.type === 'agent_response'
    );
  }

  private pricingModelForEvent(event: TraceEvent, modelBreakdown: ModelBreakdown[]): string {
    if (event.pricingModel) {
      return event.pricingModel;
    }

    const sessionPricingModel = modelBreakdown.length === 1 ? modelBreakdown[0].pricingModel : null;
    const parsedModel = event.model ?? this.modelFromEventDetail(event.detail);
    return this.matchPricingModel(parsedModel) ?? sessionPricingModel ?? 'GPT-5.4';
  }

  private tokenCostEur(tokens: number, usdPerMillion: number, usdToEur: number): number {
    return (tokens / 1_000_000) * usdPerMillion * usdToEur;
  }

  private average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  private sumTokens(rows: { tokens: TokenBreakdown }[], field: keyof TokenBreakdown): number {
    return rows.reduce((sum, row) => sum + row.tokens[field], 0);
  }

  private modelFromEventDetail(detail: string): string {
    return String(detail).split(':')[0]?.trim() ?? '';
  }

  private matchPricingModel(rawModel: string): string | null {
    const rawKey = this.modelKey(rawModel);
    if (!rawKey) {
      return null;
    }

    return (
      Object.keys(MODEL_PRICES_USD_PER_MILLION).find((model) => this.modelKey(model) === rawKey) ??
      Object.keys(MODEL_PRICES_USD_PER_MILLION).find((model) => rawKey.includes(this.modelKey(model))) ??
      null
    );
  }

  private modelKey(model: string): string {
    return String(model ?? '')
      .replace(/^copilot\//i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }
}
