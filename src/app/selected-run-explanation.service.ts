import { computed, Injectable, Signal } from '@angular/core';

import { CopilotSession, TraceEvent } from './session-data.model';
import {
  buildCostExplanation,
  flowTraceEvents,
  matchesTraceFilter,
  ModelCallSort,
  SessionTriage,
  sessionTriage,
  traceEventDetails,
  TraceFilter,
  usesPricingFallback,
} from './session-analysis';

interface SelectedRunPricingFallback {
  model: string;
  pricingModel: string;
  turns: number;
}

export interface SelectedRunExplanationState {
  costExplanation: Signal<ReturnType<typeof buildCostExplanation> | null>;
  flowEvents: Signal<ReturnType<typeof flowTraceEvents>>;
  filteredTraceEvents: Signal<TraceEvent[]>;
  selectedTraceEvent: Signal<TraceEvent | null>;
  selectedTraceEventDetails: Signal<ReturnType<typeof traceEventDetails> | null>;
  selectedSessionOutsideFilters: Signal<boolean>;
  selectedPricingFallbacks: Signal<SelectedRunPricingFallback[]>;
  selectedTriage: Signal<SessionTriage | null>;
}

@Injectable({ providedIn: 'root' })
export class SelectedRunExplanationService {
  createState(options: {
    filteredSessions: Signal<CopilotSession[]>;
    selectedSession: Signal<CopilotSession | null>;
    modelCallSort: Signal<ModelCallSort>;
    traceFilter: Signal<TraceFilter>;
    selectedTraceEventIndex: Signal<number | null>;
  }): SelectedRunExplanationState {
    const costExplanation = computed(() => {
      const session = options.selectedSession();

      return session ? buildCostExplanation(session, options.modelCallSort()) : null;
    });

    const flowEvents = computed(() => {
      const session = options.selectedSession();

      return session ? flowTraceEvents(session.traceEvents, session.modelBreakdown) : [];
    });

    const filteredTraceEvents = computed(() => {
      const session = options.selectedSession();

      if (!session) {
        return [];
      }

      return session.traceEvents.filter((event) =>
        matchesTraceFilter(event, options.traceFilter()),
      );
    });

    const selectedTraceEvent = computed(() => {
      const selectedIndex = options.selectedTraceEventIndex();
      const events = filteredTraceEvents();

      return events.find((event) => event.index === selectedIndex) ?? events[0] ?? null;
    });

    const selectedTraceEventDetails = computed(() => {
      const session = options.selectedSession();
      const event = selectedTraceEvent();

      if (!session || !event) {
        return null;
      }

      return traceEventDetails(event, session.modelBreakdown);
    });

    const selectedSessionOutsideFilters = computed(() => {
      const session = options.selectedSession();

      return Boolean(
        session &&
        !options.filteredSessions().some((filteredSession) => filteredSession.id === session.id),
      );
    });

    const selectedPricingFallbacks = computed(() => {
      const session = options.selectedSession();

      if (!session) {
        return [];
      }

      return session.modelBreakdown
        .filter((entry) => usesPricingFallback(entry.model, entry.pricingModel))
        .map((entry) => ({
          model: entry.model,
          pricingModel: entry.pricingModel,
          turns: entry.turns,
        }));
    });

    const selectedTriage = computed(() => {
      const session = options.selectedSession();

      return session ? sessionTriage(session) : null;
    });

    return {
      costExplanation,
      flowEvents,
      filteredTraceEvents,
      selectedTraceEvent,
      selectedTraceEventDetails,
      selectedSessionOutsideFilters,
      selectedPricingFallbacks,
      selectedTriage,
    };
  }
}
