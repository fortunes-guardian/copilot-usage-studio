# Copilot Usage Studio

Extension-first usage, memory, customization, and cost insights for VS Code GitHub Copilot chat and agent sessions.

[![npm version](https://img.shields.io/npm/v/copilot-usage-studio.svg)](https://www.npmjs.com/package/copilot-usage-studio)
[![CI](https://github.com/fortunes-guardian/copilot-usage-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/fortunes-guardian/copilot-usage-studio/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-2563eb.svg)](LICENSE)

Independent open-source developer tool. Not affiliated with or endorsed by GitHub or Microsoft.

Status: available as a VS Code extension. The Customizations page is preview because it depends on evidence visible in local VS Code request logs.

Supported scope today: VS Code GitHub Copilot Chat and Agent sessions on the local machine. This does not currently support Visual Studio, JetBrains IDEs, Copilot CLI, GitHub.com chat, or GitHub billing exports.

Supported local VS Code storage locations for the standalone/npm host:

- Windows: `%APPDATA%\Code\User`
- macOS: `~/Library/Application Support/Code/User`
- Linux: `~/.config/Code/User`

VS Code Insiders paths are scanned too by the standalone/npm host. The VS Code extension uses the VS Code user-data root for the VS Code installation it is running inside.

The app helps answer three practical questions:

> How much GitHub Copilot usage did I burn today, this week, and this month?
>
> Did Copilot actually send my local instructions, skills, prompts, hooks, or agents to the model?
>
> Why did this Copilot run cost what it cost?

It scans local VS Code data, uses GitHub source usage when VS Code logs it, falls back to GitHub published model prices when it has to, and shows which models, token categories, and model calls drove the usage. It also indexes Copilot's locally saved memories/plans. The Customizations page is a preview for inspecting local instructions, skills, prompts, hooks, and agents with evidence from visible VS Code request logs.

## Start Here

Recommended path: install the VS Code extension from the Marketplace:

https://marketplace.visualstudio.com/items?itemName=fortunes-guardian.copilot-usage-studio-vscode

Then run `Copilot Usage Studio: Open` from the VS Code command palette.

To build and install the current source locally:

Requirements for building locally: Node.js 22.5 or newer, npm, VS Code, and local VS Code GitHub Copilot session data.

```bash
npm install
npm run vscode:package
code --install-extension tmp/copilot-usage-studio-vscode-0.2.1.vsix --force
```

The npm/browser host remains available for development and fallback testing:

```bash
npx copilot-usage-studio
```

Then open `http://127.0.0.1:4312/`.

`npx` downloads the latest published package from npm. To run this exact release:

```bash
npx copilot-usage-studio@0.2.1
```

To contribute or run the current GitHub source:

```bash
git clone https://github.com/fortunes-guardian/copilot-usage-studio.git
cd copilot-usage-studio
npm install
npm start
```

Open the local Angular URL printed by the dev server, usually:

```text
http://127.0.0.1:4200/
```

Read [docs/how-to-read-the-app.md](docs/how-to-read-the-app.md) if the UI terms are not obvious yet.

`npm start` now launches both the Angular development UI and the local scanner runtime. It serves cached data immediately, refreshes from VS Code in the background, and enables the **Refresh** action in the app. The app stays local because the useful source data can contain prompts, file paths, repository context, and tool results.

The packaged CLI stores its cache in the current user's application-data directory. It does not write session data into the npm installation and does not include the maintainer's generated session data in the package.

If startup appears stuck, keep the terminal open and check the loading screen diagnostics. The runtime now reports the current scan step, recent log lines, and a local log-file path. You can also run:

```bash
npx copilot-usage-studio status
```

## What Works Now

- **Usage**: the default home for last session, today, this week, current calendar month, selected workspace/model scope, and recent daily usage in GitHub AI credits.
- **Sessions**: selected-run debugging with Overview, Cost, Calls, and Trace views.
- **Memory**: read-only search and inspection for global, repository, workspace, and session-scoped Copilot memories and saved plans.
- **Customizations preview**: read-only inventory and local-log text-match evidence for Copilot instructions, skills, prompts, hooks, and agents. Absence of a text match does not prove Copilot ignored a file.
- **Cost**: source usage when VS Code logs it, fallback pricing when it does not, and separate normal input, cached input, cache write, and output buckets.
- **Calls**: model-call timeline, context-load timeline, setup-footprint clues, and links back to the raw Trace event.
- **Trace**: filterable raw log timeline with clickable event inspection.
- **Compare**: baseline/candidate run comparison with cost, token, model, and same-prompt cues.
- **Insights**: multi-session model mix, trends, run-size distribution, and outlier signals without repeating the Usage dashboard.
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

Build the VS Code extension locally:

```bash
npm run vscode:package
code --install-extension tmp/copilot-usage-studio-vscode-0.2.1.vsix --force
```

The extension opens the full app inside VS Code: Usage, Sessions, Memory, Customizations preview, Compare, Insights, and Prices.
For release validation, prefer the VSIX artifact produced by CI when available. Users should normally install from the VS Code Marketplace.

## Releasing

Releases are tag-driven. After a change is merged to `main`, the maintainer bumps the version and pushes the generated tag:

```bash
npm version patch
git push origin main --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate. GitHub Actions tests and packages that exact tagged commit, builds the VS Code extension artifact, and creates release notes from `CHANGELOG.md`. See [docs/local-deployment.md](docs/local-deployment.md#automated-releases) for release mechanics.

## Current Boundaries

- Local app, not SaaS.
- Developer usage visibility, not enterprise billing-console access.
- Local VS Code sessions, not Visual Studio, JetBrains, Copilot CLI, GitHub.com chat, or billing exports.

The app is a local developer visibility tool. It shows what can be understood from local VS Code Copilot data.

## Docs

- [docs/how-to-read-the-app.md](docs/how-to-read-the-app.md): plain-English guide to the UI.
- [docs/pricing.md](docs/pricing.md): GitHub price source, calculation rules, AI-credit allowances, and real-world caveats.
- [docs/local-deployment.md](docs/local-deployment.md): local run, build, and release mechanics.
- [docs/vscode-extension.md](docs/vscode-extension.md): local VSIX preview architecture, build, and smoke-test flow.
- [docs/scanner-api.md](docs/scanner-api.md): reusable Node scanner contract for local hosts, desktop packaging, and extensions.
- [docs/data-ingestion.md](docs/data-ingestion.md): where the data comes from and what it means.
- [docs/copilot-memory.md](docs/copilot-memory.md): observed Copilot memory storage, normalized fields, and evidence boundaries.
- [docs/customization-evidence.md](docs/customization-evidence.md): how instruction/skill evidence is detected and what it proves.
- [docs/debug-log-schema.md](docs/debug-log-schema.md): observed VS Code Agent Debug Log schema and generated app data contract.

## License

MIT. See [LICENSE](LICENSE).

## Refresh Local Session Data

The app reads `public/data/sessions.json`. Running `npm run scan` regenerates that file from local VS Code data.

Normal refresh:

```bash
npm run refresh:data
```

That runs the scan and verifier together.

The scanner also has an in-memory Node API for future local-server, desktop, and extension hosts. See [docs/scanner-api.md](docs/scanner-api.md). The existing `npm run scan` command is now a thin CLI host over the same API.

## Pricing

Prices are copied from GitHub's published Copilot usage-based pricing table:

https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

Rates are USD per 1 million tokens. The app also converts USD into GitHub AI credits using GitHub's fixed conversion of `1 AI credit = $0.01 USD`.

See [docs/pricing.md](docs/pricing.md) for the exact calculation rules, source usage behavior, and known limits.

## Useful Commands

```bash
npm run scan
npm run refresh:data
npm run runtime
npm run preview:local
npm run cli -- --help
npm run verify:data
npm run schema:audit
npm test -- --watch=false
npm run build
```

You can scan a custom VS Code user directory or workspace storage folder:

```bash
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "%APPDATA%\Code\User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "$HOME/Library/Application Support/Code/User"
node scripts/scan-vscode-sessions.mjs public/data/sessions.json "%APPDATA%\Code\User\workspaceStorage\<workspace-id>"
```
