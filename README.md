# Copilot Cost Debugger

Local-first cost debugger for VS Code GitHub Copilot chat and agent sessions.

Status: early local developer preview. It is useful today for local VS Code sessions; the first release path is clone-and-run.

Supported scope today: VS Code GitHub Copilot Chat and Agent sessions on the local machine. This does not currently support Visual Studio, JetBrains IDEs, Copilot CLI, GitHub.com chat, or GitHub billing exports.

Supported local VS Code storage locations:

- Windows: `%APPDATA%\Code\User`
- macOS: `~/Library/Application Support/Code/User`
- Linux: `~/.config/Code/User`

VS Code Insiders paths are scanned too.

The app helps answer two practical questions:

> How much GitHub Copilot usage did I burn today, this week, and this month?
>
> Why did this Copilot run cost what it cost?

It scans local VS Code data, uses GitHub source usage when VS Code logs it, falls back to GitHub published model prices when it has to, and shows which models, token categories, and model calls drove the usage.

## Start Here

1. Run the app locally:

```bash
npm install
npm run refresh:data
npm start
```

2. Open the local Angular URL printed by the dev server, usually:

```text
http://127.0.0.1:4200/
```

3. Read [docs/how-to-read-the-app.md](docs/how-to-read-the-app.md) if the UI terms are not obvious yet.

That is the release path for now: clone the repo, refresh local VS Code data, run the local dev server. The app stays local because the useful source data can contain prompts, file paths, repository context, and tool results.

## What Works Now

- **Usage**: last session, today, this week, current calendar month, visible filtered total, and recent daily usage in GitHub AI credits.
- **Sessions**: selected-run debugging with Overview, Cost, Calls, and Trace views.
- **Cost**: source usage when VS Code logs it, fallback pricing when it does not, and separate normal input, cached input, cache write, and output buckets.
- **Calls**: model-call timeline, context-load timeline, setup-footprint clues, and links back to the raw Trace event.
- **Trace**: filterable raw log timeline with clickable event inspection.
- **Compare**: baseline/candidate run comparison with cost, token, model, and same-prompt cues.
- **Analytics**: multi-session cohort totals, model breakdowns, trends, distribution, and outlier signals.
- **Prices**: GitHub pricing rows used by the app plus Copilot Business/Enterprise AI-credit allowance context.

If the dev server ever shows new markup with old component styles, stop it and restart with a cache reset:

```bash
npm run start:clean
```

For a local production build:

```bash
npm run scan
npm run verify:data
npm run build
```

See [docs/local-deployment.md](docs/local-deployment.md) for packaging options and why the app stays local-first.

## Current Boundaries

- Local app, not SaaS.
- Developer usage visibility, not enterprise billing-console access.
- Local VS Code sessions, not Visual Studio, JetBrains, Copilot CLI, GitHub.com chat, or billing exports.

The app is a local developer visibility tool. It shows what can be understood from local VS Code Copilot data.

## Docs

- [docs/how-to-read-the-app.md](docs/how-to-read-the-app.md): plain-English guide to the UI.
- [docs/pricing.md](docs/pricing.md): GitHub price source, calculation rules, AI-credit allowances, and real-world caveats.
- [docs/local-deployment.md](docs/local-deployment.md): local run, build, and future packaging options.
- [docs/data-ingestion.md](docs/data-ingestion.md): where the data comes from and what it means.
- [docs/debug-log-schema.md](docs/debug-log-schema.md): observed VS Code Agent Debug Log schema and generated app data contract.
- [docs/roadmap.md](docs/roadmap.md): current state, completed work, and planned build order.

## License

MIT. See [LICENSE](LICENSE).

## Refresh Local Session Data

The app reads `public/data/sessions.json`. Running `npm run scan` regenerates that file from local VS Code data.

Normal refresh:

```bash
npm run refresh:data
```

That runs the scan and verifier together.

## Pricing

Prices are copied from GitHub's published Copilot usage-based pricing table:

https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

Rates are USD per 1 million tokens. The app also converts USD into GitHub AI credits using GitHub's fixed conversion of `1 AI credit = $0.01 USD`.

See [docs/pricing.md](docs/pricing.md) for the exact calculation rules, source usage behavior, and known limits.

## Useful Commands

```bash
npm run scan
npm run refresh:data
npm run verify:data
npm test -- --watch=false
npm run build
```

You can scan a custom VS Code user directory or workspace storage folder:

```bash
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "%APPDATA%\Code\User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "$HOME/Library/Application Support/Code/User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "%APPDATA%\Code\User\workspaceStorage\<workspace-id>"
```
