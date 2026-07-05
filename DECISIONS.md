# Decision Log

This is for durable decisions that should guide future agents. Keep it short: decision, reason, and important alternatives.

## Extension-first product path

- Decision: Make the VS Code extension the primary product path.
- Reason: The app is most useful inside the editor where local Copilot data, settings, logs, memories, and customizations live.
- Alternatives considered: npm/browser host as the main user path. It remains a development and fallback host.

## Local-first data handling

- Decision: Keep Copilot Usage Studio local-first.
- Reason: Local VS Code data can contain prompts, file paths, repository context, tool schemas, tool results, memories, and plans.
- Alternatives considered: SaaS or uploaded analytics are explicitly out of scope in current docs.

## Source usage before estimates

- Decision: Prefer `copilotUsageNanoAiu` source usage when VS Code logs it.
- Reason: It is the strongest local usage signal. Token-bucket pricing remains fallback and explanation.
- Alternatives considered: Always estimate from tokens and published pricing.

## Separate priced token buckets

- Decision: Keep token buckets separate: normal input, cached input, cache write, and output.
- Reason: GitHub pricing treats these differently, and merged totals hide cost drivers.
- Alternatives considered: Collapse everything into total input/output tokens.

## Visible fallback pricing

- Decision: Expose fallback pricing assumptions visibly.
- Reason: Unknown logged model IDs may still have exact token counts but uncertain pricing rows.
- Alternatives considered: Silently map unknown models to a default row.

## Observed schema, not public API

- Decision: Treat VS Code Agent Debug Logs as an observed schema with audits and baselines.
- Reason: The format is local and can change with VS Code or Copilot updates.
- Alternatives considered: Treat parser assumptions as stable and rely only on app tests.

## Shared scanner API

- Decision: Use a shared scanner API instead of duplicating scanner logic in hosts.
- Reason: Extension, local runtime, CLI, and future hosts need one parser and pricing implementation.
- Alternatives considered: Implement separate extension-specific parsing.

## Runtime/scanner separation

- Decision: Keep runtime and scanner concerns separate.
- Reason: The scanner normalizes VS Code data; the runtime owns HTTP status, refresh coordination, caching, cancellation, and static UI delivery.
- Alternatives considered: Put transport and lifecycle behavior inside scanner modules.

## Customizations stays preview and conservative

- Decision: Customizations is a preview based on local evidence, not certainty.
- Reason: Visible local logs can prove text appeared in request material, but absence of a match does not prove Copilot ignored a file.
- Alternatives considered: Label customizations as definitively used or ignored.

## Settings-first customization discovery

- Decision: In the VS Code extension, customization locations should come from VS Code APIs/settings/defaults before fallback filename heuristics.
- Reason: Broad guessed roots are slow and make false workspace/source rows such as `C:\Users\<user>` appear trustworthy.
- Alternatives considered: Recursively search home folders or whole repositories for likely customization filenames.

## Avoid broad filesystem traversal

- Decision: Avoid broad filesystem traversal.
- Reason: Large profiles are slow, and scanning arbitrary home or repository paths risks privacy, performance, and confusing UX.
- Alternatives considered: Recursively search broad user directories for likely Copilot customization files.
