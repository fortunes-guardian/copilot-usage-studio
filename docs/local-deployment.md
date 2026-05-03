# Local Deployment

The app is intended to run locally, near the VS Code data it reads. It should not require a hosted SaaS backend for the core workflow.

## Recommended For Development

Use the Angular dev server:

```bash
npm install
npm run scan
npm run verify:data
npm start
```

Then open the local Angular URL, usually:

```text
http://127.0.0.1:4200/
```

Why: this is the fastest loop while the UI and scanner are changing. It keeps scans explicit, uses local files only, and makes errors easy to see in the terminal.

## Recommended For Local Use Without Dev Mode

Build static files and serve them locally:

```bash
npm run scan
npm run verify:data
npm run build
```

Then serve the generated `dist/` output with a small local static server.

Why: Angular production output is just static assets plus the generated `public/data/sessions.json` copy. This is a good first packaging target because it avoids an app server and keeps the data model simple.

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
copilot-cost-ledger scan
copilot-cost-ledger serve
```

Why: this keeps the project local and scriptable without committing to a desktop shell too early.

## Not The Current Direction

Do not optimize for a hosted SaaS version yet.

Reasons:

- The strongest data source is on the developer machine under VS Code workspace storage.
- Local debug logs can contain sensitive prompts, file paths, repo context, and tool results.
- The product is currently a cost debugger, not an organization billing system.

If billing reconciliation becomes important later, it can be added as an optional import without changing the local-first default.
