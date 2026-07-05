---
name: copilot-schema-pricing-update
description: Run Copilot Usage Studio's weekly maintenance workflow after a VS Code or GitHub Copilot update, especially when checking VS Code Agent Debug Log schema drift, new Copilot model ids, GitHub Copilot pricing changes, pricing docs, schema baselines, and compatibility gates.
---

# Copilot Schema And Pricing Update

Use this skill when maintaining Copilot Usage Studio after a VS Code, GitHub Copilot Chat, or GitHub Copilot pricing update.

## Workflow

1. Read project context first:
   - `AGENTS.md`
   - `NEXT.md`
   - `docs/schema-change-workflow.md`
   - `docs/pricing.md`
   - `docs/debug-log-schema.md`
2. Check the working tree with `git status --short`. Preserve unrelated user changes.
3. Run the schema audit:
   - `npm run schema:audit`
   - Review `tmp/schema-audit.md`.
   - Treat `breaking` as a blocker.
   - Treat `warning` as a probe-coverage or compatibility question; do not accept the baseline from one narrow session.
   - Treat additive model ids, event types, and fields as feature candidates only after their meaning is understood.
4. Check GitHub's official Copilot pricing page:
   - `https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing`
   - Update `data/github-copilot-pricing.json` only from the official table.
   - Update `version`, `snapshotDate`, and `importedAt`.
   - Preserve normal input, cached input, cache write, output, and long-context tiers.
   - Add raw model-id aliases when VS Code logs ids that differ from GitHub's display label.
5. Update consumers and docs when pricing changes:
   - `scripts/pricing-utils.mjs`
   - `src/app/pricing.ts`
   - relevant tests under `scripts/*.test.mjs` or `src/app/*.spec.ts`
   - `docs/pricing.md`
   - `docs/data-ingestion.md`
   - `docs/debug-log-schema.md`
   - `CHANGELOG.md`
6. Run compatibility gates:
   - `npm run test:scripts`
   - `npm test -- --watch=false`
   - `npm run build`
   - `npm run vscode:package` when the change can affect the extension.

## Baseline Rule

Do not run `npm run schema:accept` just because the latest audit completed. Accept the baseline only after controlled probes cover the behavior in `docs/schema-change-workflow.md`, warnings are understood, and any scanner/docs/test changes are complete.

## Evidence Rules

- Prefer `copilotUsageNanoAiu` source usage when present.
- Keep token-bucket pricing as the explanation and fallback layer.
- Do not use `models.json` catalogue token-price metadata as the authoritative price table.
- Do not claim missing fields are removed unless a targeted probe should have produced them.
- Do not commit raw prompts, tool arguments, file paths from local logs, generated `sessions.json`, or ignored `tmp` reports.
