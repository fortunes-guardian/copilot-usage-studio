# Agent Guide

This file is the first stop for AI agents working on Copilot Usage Studio. It gives enough product context to make good decisions without re-reading the whole repo.

## Project Purpose

- Copilot Usage Studio is a local developer tool for VS Code GitHub Copilot Chat and Agent data.
- The VS Code extension is the primary product path.
- The npm/browser host remains useful for development, fallback testing, and scanner/runtime validation.
- The product answers practical developer questions:
  - How much Copilot usage did I burn today, this week, and this month?
  - Which models, token buckets, calls, and sessions drove usage or cost?
  - What Copilot memories and saved plans exist locally?
  - Did my local instructions, skills, prompts, hooks, or agents appear in visible model-request logs?

## Product Philosophy

- Local-first: prompts, paths, tool results, memories, and scan data stay on the user's machine.
- Evidence-first: distinguish observed local facts from estimates, fallback pricing, and inference.
- Developer-facing: optimize for understanding local usage patterns and improving AI-assisted development workflows.
- Clear boundaries: this is not a GitHub invoice, org billing console, or enterprise analytics product.

## Current Product Surfaces

- Usage: default home; local GitHub AI-credit usage for last session, today, week, month, and selected scope.
- Sessions: deeper debugging for selected runs, including Overview, Cost, Calls, and Trace.
- Memory: read-only browser for Copilot memories and saved plans.
- Customizations preview: inventory and local evidence for instructions, skills, prompts, hooks, and agents.
- Compare: baseline/candidate run comparison.
- Insights: multi-session trends, model mix, outliers, and distribution.
- Prices: GitHub model price rows and Copilot allowance context.

## Evidence Rules

- Prefer source usage from VS Code logs when available.
- Keep normal input, cached input, cache write, and output as separate token buckets.
- Treat VS Code Copilot log schemas as observed local formats, not stable public APIs.
- Say what the app can prove, and make uncertainty visible.
- Customizations evidence must stay conservative:
  - Good: `File text found`, `Name/path only`, `No file text found in local request logs`.
  - Avoid: `used`, `ignored`, `sent`, `not sent` unless the source truly proves it.
- Absence of a text match never proves Copilot ignored a customization.
- Local cost and usage estimates are not official GitHub billing totals.

## Architecture Rules

- One scanner implementation serves the CLI, local runtime, npm/browser host, and VS Code extension.
- Keep scanner, runtime host, extension host, and Angular UI responsibilities separate.
- Angular consumes normalized `SessionData`; it should not parse raw VS Code logs.
- The VS Code extension should use VS Code APIs/settings/defaults for editor-specific context.
- Avoid broad filesystem crawling. Scan known VS Code storage and trusted customization locations.
- Preserve privacy: do not commit generated sessions, prompts, local paths, tool outputs, memories, or private logs.

## Non-Goals

- No SaaS backend or cloud sync.
- No GitHub billing export ingestion unless deliberately added later.
- No current support claims for Visual Studio, JetBrains IDEs, Copilot CLI, or GitHub.com chat.
- No raw prompt, response, path, tool argument, or tool result dumps in committed fixtures.
- No product claims that local evidence proves official billing totals.

## Important References

- `ENGINEERING.md`: coding standards, architecture boundaries, verification commands.
- `DECISIONS.md`: durable product and architecture decisions.
- `NEXT.md`: current handoff notes and near-term priorities.
- `docs/customization-evidence.md`: Customizations preview evidence model.
- `docs/debug-log-schema.md`: observed VS Code Agent Debug Log schema.
- `docs/pricing.md`: pricing and GitHub AI-credit calculations.
- `docs/vscode-extension.md`: VS Code extension host and packaging.
- `.agents/skills/copilot-schema-pricing-update/SKILL.md`: repeatable schema/pricing update workflow.

## UX Standards

- Default home is Usage.
- Use plain labels before raw diagnostics.
- Keep source usage, fallback estimate, fallback pricing, and partial evidence visibly marked.
- Explain terms with concise helper text or tooltips. Prefer one clear sentence over cryptic labels.
- Scan UI should be compact by default, with raw paths, counters, warnings, and logs behind details.
- Easy to understand first, developer-level detail second.
- Do not make normal users understand `state.vscdb`, storage-entry IDs, raw event names, or side-file names unless they open technical details.

## Release Posture

- Current status: early VS Code extension preview.
- Local VSIX testing comes before Marketplace release.
- Keep npm/browser docs accurate, but do not let npm become the main product story.

## Definition of Done

- Change is scoped to the requested behavior.
- Product copy does not overclaim source certainty.
- Relevant tests pass or skipped verification is explained.
- Data-contract changes update docs and fixtures where needed.
- Extension-impacting changes pass extension build/package verification when practical.
- No local private data, generated session dumps, prompt content, or machine-specific paths are committed.

## Before Making Changes

- Read `README.md`, this file, and the most relevant docs under `docs/`.
- Check `NEXT.md` for current handoff notes and active priorities.
- Inspect existing code patterns before adding new abstractions.
- Confirm whether the change touches scanner contracts, local runtime, Angular UI, or VS Code extension host.
- Preserve user changes and untracked files unless explicitly told otherwise.
- For schema or ingestion changes, review `docs/schema-change-workflow.md`.
- For Customizations changes, review `docs/customization-evidence.md` and keep evidence language conservative.
