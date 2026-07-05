# Weekly VS Code Schema Change Workflow

VS Code Copilot Agent Debug Logs are an observed local format, not a stable public API. Treat each VS Code or Copilot Chat update as a source-contract change until the current runtime has passed this workflow.

## The Contract Gates

The project uses four separate gates because no single check is sufficient:

1. **Raw schema audit**: compares the newest runtime cohort with `data/vscode-schema-baseline.json` before ingestion assumptions hide a change.
2. **Scanner fixture tests**: prove that known raw shapes still become the expected token, cache, usage, request, and trace fields.
3. **Generated-data verifier**: recomputes token splits, source usage, pricing, totals, and required app fields after a real scan.
4. **App tests and build**: catch UI and TypeScript consumers that no longer understand the generated contract.

The raw baseline contains field names, types, coverage, model ids, request-shape enums, and side-file shapes. It deliberately excludes prompts, responses, local paths, tool arguments, and tool results.

## Weekly Procedure

### 1. Run controlled probes after updating

One ordinary session does not exercise the whole schema. Before auditing, create a small set of Agent sessions with the new VS Code/Copilot runtime:

- **Basic request**: one prompt and one response.
- **Tool loop**: ask the agent to list a directory and read two files. This exercises tool calls, cached input, and `function_call_output` continuations.
- **Customization setup**: use a workspace with instructions plus at least one MCP tool or skill available. Invocation is optional; the goal is to exercise discovery and side files.
- **Alternate request options when practical**: use another model or reasoning effort if the update specifically concerns models or reasoning.

Let the sessions finish before running the audit. The command selects up to 25 sessions from the newest complete VS Code/Copilot runtime and unions their observed shapes. This reduces false “field removed” findings caused by one narrow session.

### 2. Audit without importing

```bash
npm run schema:audit
```

Outputs:

- `tmp/schema-audit.md`: readable review report.
- `tmp/schema-audit.json`: complete machine-readable current/baseline comparison.

To audit one known session directly:

```bash
node scripts/audit-vscode-schema.mjs --session "<debug-log-session-directory>"
```

To audit a custom VS Code user directory:

```bash
node scripts/audit-vscode-schema.mjs --root "<VS Code User directory>"
```

### 3. Triage the result

| Severity | Meaning | Required response |
| --- | --- | --- |
| `breaking` | Cost-critical fields disappeared or changed type, logs cannot parse, no model calls exist, or token/cache invariants fail | Do not import or accept the baseline. Inspect raw logs, update the scanner contract, and add a regression fixture. |
| `warning` | A previously supported capability or side file was not observed | Run a more targeted probe first. If the removal is real, decide whether the app needs fallback behavior or should drop the feature. |
| `info` | Additive field, event type, request shape, model, or semantic event appeared | Evaluate it as a feature candidate. Do not expose it until its meaning is evidenced across useful sessions. |

Absence is not proof of removal until an appropriate probe has exercised that behavior.

### 4. Adapt the contract

For a real schema change:

1. Save a sanitized raw shape as a scanner fixture. Never commit user prompts or repository payloads.
2. Update the scanner conservatively. Prefer supporting old and new shapes during a transition.
3. Update `docs/debug-log-schema.md` with the exact observed runtime and field meaning.
4. Update UI behavior only when the new field answers a real developer question reliably.
5. Keep uncertain fields in diagnostics or private planning notes rather than promoting them into product claims.

### 5. Run the full compatibility gate

```bash
npm run refresh:data
npm run test:scripts
npm test -- --watch=false
npm run build
```

Review the latest imported session manually in Cost, Calls, and Trace when the change touches tokens, usage, request flow, side files, or event classification.

### 6. Accept the new baseline

Only after the scanner, verifier, tests, docs, and UI are correct:

```bash
npm run schema:accept
```

Then review the Git diff of `data/vscode-schema-baseline.json`. Git history is the schema-change history; the generated reports remain under ignored `tmp/`.

`schema:accept` refuses breaking drift. An intentional breaking source-contract migration requires the explicit `--allow-breaking` flag and should only happen after compatibility has been deliberately redesigned:

```bash
node scripts/audit-vscode-schema.mjs --accept --allow-breaking
```

## Feature Discovery Rules

A new field becomes a feature candidate when:

- it appears in the raw audit as additive data;
- its semantics can be explained from the event context or authoritative documentation;
- it appears consistently in more than one useful session or has a clear optional fallback;
- it answers a concrete developer question;
- the UI can label observed facts separately from inference.

Examples:

- `copilotUsageNanoAiu` qualified because it is source usage, reconciles across model calls, and directly answers usage questions.
- `requestShape.hasPreviousResponseId` qualifies as request-flow evidence, but not as exact per-tool cost attribution.
- tool-schema character counts qualify as efficiency evidence, but not as billed token totals.
- a model-catalogue zero price does not qualify as proof of free billing.

## Pull Request Checklist

- [ ] `npm run schema:audit` reviewed.
- [ ] Controlled probes cover the affected behavior.
- [ ] Breaking/warning findings explained.
- [ ] Scanner fixture added for a real new shape.
- [ ] Old and new shapes supported where practical.
- [ ] `npm run refresh:data` passes.
- [ ] `npm run test:scripts` passes.
- [ ] `npm test -- --watch=false` passes.
- [ ] `npm run build` passes.
- [ ] Schema and ingestion docs updated.
- [ ] Baseline accepted only after review.
- [ ] No prompt, response, local path, argument, or result payload committed.
