# Local Deployment

The app is intended to run locally, near the VS Code data it reads. It should not require a hosted SaaS backend for the core workflow.

## Recommended For Development

Use the Angular dev server:

```bash
npm install
npm run refresh:data
npm start
```

Then open the local Angular URL, usually:

```text
http://127.0.0.1:4200/
```

Why: this is the fastest loop while the UI and scanner are changing. It keeps scans explicit, uses local files only, and makes errors easy to see in the terminal.

## First Public Release Path

For the first public release, use a simple clone-and-run flow:

```bash
git clone <repo-url>
cd copilot-cost-debugger
npm install
npm run refresh:data
npm start
```

Then open the local Angular URL printed by the dev server.

This is acceptable for an early developer tool because the audience is technical, the product is changing quickly, and the scanner needs local VS Code storage access anyway. The release page should be explicit that generated data stays local and may contain prompts, file paths, repository context, and tool results.

Before publishing a release post, run:

```bash
npm run refresh:data
npm test -- --watch=false
npm run test:scripts
npm run build
```

Release copy should describe the app as a local Copilot usage debugger, not an invoice replacement. The strongest promise is: "VS Code already logs useful usage data locally; this app makes it understandable for developers who do not have billing-console access."

If the browser shows updated markup with stale component styles, stop the dev server and restart it with a cache reset:

```bash
npm run start:clean
```

This clears Angular's local build cache before starting `ng serve`. Use it after larger component-style moves if the dev server appears to mix old CSS with new templates.

## Recommended For Local Use Without Dev Mode

Build static files and serve them locally:

```bash
npm run scan
npm run verify:data
npm run build
```

Then serve the generated `dist/` output with a small local static server.

Why: Angular production output is just static assets plus the generated `public/data/sessions.json` copy. This is a good first packaging target because it avoids an app server and keeps the data model simple.

Current build status: `npm run build` passes without a component style budget warning after the Prices, loading/error, and Compare component extraction passes.

For day-to-day local use, `npm run refresh:data` is the intended one-command data refresh. It regenerates `public/data/sessions.json` from local VS Code data and immediately verifies the generated file.

## Future Option: Desktop App

A desktop wrapper, likely Tauri or Electron, could bundle:

- the static Angular UI
- the scanner command
- local settings for VS Code paths and exchange rate
- optional app-owned SQLite later

Why: a desktop app would make the project easier for non-frontend developers to run. It also gives a natural place for “refresh data” buttons and local file permissions. It is heavier than static hosting, so it should wait until the scanner and UI contract settle.

## Future Option: Installer Or Single Command

A lightweight local CLI could provide commands such as:

```bash
copilot-cost-debugger scan
copilot-cost-debugger serve
```

Why: this keeps the project local and scriptable without committing to a desktop shell too early.

## Not The Current Direction

Do not optimize for a hosted SaaS version yet.

Reasons:

- The strongest data source is on the developer machine under VS Code workspace storage.
- Local debug logs can contain sensitive prompts, file paths, repo context, and tool results.
- The product is currently a cost debugger, not an organization billing system.

If billing reconciliation becomes important later, it can be added as an optional import without changing the local-first default.
