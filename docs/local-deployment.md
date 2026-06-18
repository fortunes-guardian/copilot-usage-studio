# Local Deployment

The app is intended to run locally, near the VS Code data it reads. It should not require a hosted SaaS backend for the core workflow.

Current release posture: early local developer preview. Version `0.2.0` is published publicly on npm, while clone-and-run remains available for contributors and development builds.

Packaging foundation now available: the scanner exposes an in-memory Node API through `lib/scanner-api.mjs`. The existing scan command uses that same API and only adds argument parsing plus JSON persistence. This is the common core for the next local host, an `npx` command, Electron packaging, and a future thin VS Code extension.

Supported source today: VS Code GitHub Copilot Chat and Agent local storage. Visual Studio, JetBrains IDEs, Copilot CLI, GitHub.com chat, and GitHub billing exports are outside the current importer scope.

Default scan paths:

- Windows: `%APPDATA%\Code\User` and `%APPDATA%\Code - Insiders\User`
- macOS: `~/Library/Application Support/Code/User` and `~/Library/Application Support/Code - Insiders/User`
- Linux: `~/.config/Code/User` and `~/.config/Code - Insiders/User`

SQLite title/metadata enrichment uses Node's `node:sqlite` support. If that is unavailable on a user's local Node version, the scanner should still import debug-log sessions and report enrichment as skipped.

## Recommended For Development

Use the Angular dev server:

```bash
npm install
npm start
```

Then open the local Angular URL, usually:

```text
http://127.0.0.1:4200/
```

Why: this is the fastest loop while the UI and scanner are changing. `npm start` launches the Angular dev server and the local runtime together. The runtime serves the last valid snapshot immediately, performs a background startup scan, and powers the in-app refresh action.

## Install From npm

The npm package is configured for a one-command local launch:

```bash
npx copilot-usage-studio
```

This starts the packaged production UI and scanner runtime on `http://127.0.0.1:4312/` by default. It downloads the latest published npm version rather than the current GitHub `main` branch.

Useful packaged commands:

```bash
npx copilot-usage-studio
npx copilot-usage-studio scan
npx copilot-usage-studio status
npx copilot-usage-studio --help
```

The CLI requires Node.js 22.5 or newer because optional VS Code `state.vscdb` enrichment uses Node's built-in SQLite support.

For development or the current GitHub source, use the repository flow:

```bash
git clone https://github.com/fortunes-guardian/copilot-usage-studio.git
cd copilot-usage-studio
npm install
npm start
```

Then open the local Angular URL printed by the dev server.

This is acceptable for an early developer preview because the audience is technical, the product is changing quickly, and the scanner needs local VS Code storage access anyway. The release page should be explicit that generated data stays local and may contain prompts, file paths, repository context, and tool results.

Before publishing a release post, run:

```bash
npm run refresh:data
npm test -- --watch=false
npm run test:scripts
npm run build
```

Release copy should describe the app as a local Copilot usage inspector for VS Code. The strongest promise is: "VS Code already logs useful usage data locally; this app makes it understandable for developers who do not have billing-console access."

### Packaged Data Location

The packaged CLI stores its current normalized snapshot outside the npm installation:

- Windows: `%LOCALAPPDATA%\Copilot Usage Studio\sessions.json`
- macOS: `~/Library/Application Support/Copilot Usage Studio/sessions.json`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/copilot-usage-studio/sessions.json`

The npm tarball contains the compiled UI, scanner, pricing table, and runtime code. It must never contain `public/data/sessions.json` or any other developer's imported session data.

## Automated Releases

GitHub Actions is the release control plane:

- `.github/workflows/ci.yml` runs the full release gate for pull requests and pushes to `main`.
- `.github/workflows/release.yml` runs automatically for version tags such as `v0.1.1`, with a manual existing-tag mode for repair and backfill.
- The release workflow verifies that the tag matches `package.json`, publishes the exact tagged source, and creates the matching GitHub Release.
- A failed workflow can be rerun safely: an existing npm version is accepted only when its published `gitHead` matches the exact tagged commit. Conflicting or unverifiable versions are refused.
- New versions must pass the full release gate before publication. An exact-commit backfill of an already-published historical version skips its old test suite and only repairs the missing GitHub Release.

This keeps GitHub, npm, and the source tag tied to the same commit. Ordinary pushes never publish.

### One-Time npm Setup

Commit and push the workflow files first, then configure npm Trusted Publishing for the existing `copilot-usage-studio` package:

1. Open the package settings on npm and add a GitHub Actions trusted publisher.
2. Set organization or user to `fortunes-guardian`.
3. Set repository to `copilot-usage-studio`.
4. Set workflow filename to `release.yml`.
5. Allow the `npm publish` action.
6. Leave the environment blank unless the workflow is later changed to use a protected GitHub environment.

The workflow uses GitHub's OIDC identity, so no long-lived `NPM_TOKEN` repository secret is required. npm automatically adds provenance for a public package published from a public repository through Trusted Publishing.

### Publishing a Version

Start from an up-to-date, clean `main` branch. Choose the semantic-version bump that matches the change:

```bash
git switch main
git pull --ff-only
npm run release:check
npm version patch
git push origin main --follow-tags
```

`npm version patch` updates both `package.json` and `package-lock.json`, creates a version commit, and creates an annotated `vX.Y.Z` tag. Use `npm version minor` for a backward-compatible feature release or `npm version major` for a breaking release.

After the tag is pushed:

1. Watch the **Release** workflow in GitHub Actions.
2. Confirm the new version appears on npm.
3. Confirm GitHub created a Release for the same tag.
4. Run `npx copilot-usage-studio@X.Y.Z --version` from a clean directory as a final smoke test.

If CI or release validation fails, fix the issue on `main` and publish a new version. Do not move or reuse a public release tag, and do not overwrite an npm version; both are immutable release coordinates.

The workflow also has a manual **Run workflow** action with a required existing tag. Use this to repair or backfill the GitHub Release for an exact tag. For the already-published first version, ensure `v0.1.0` exists on GitHub, then run the workflow once with `v0.1.0`; it will verify npm's published `gitHead`, skip the historical release gate and npm publication, and create the missing GitHub Release.

### Manual Emergency Fallback

Run the full package gate:

```bash
npm run release:check
```

Inspect the tarball list, confirm no local session data or absolute paths are present, then publish deliberately:

```bash
npm publish --access public
```

Use this only if Trusted Publishing or GitHub Actions is unavailable. The normal path is the tag-driven workflow above.

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

Current build status: `npm run build` passes. There is still an initial bundle budget warning to clean up later; it does not block the local preview release.

For day-to-day development, use the in-app **Refresh** action. `npm run refresh:data` remains the explicit command-line scan plus verification path.

## Local Runtime

The local runtime is available separately:

```bash
npm run runtime
```

It listens on `http://127.0.0.1:4312/` by default and exposes:

- `GET /api/status`: scan state, timestamps, current progress, recent log lines, last error, and session count
- `GET /api/logs`: bounded in-memory runtime logs and the local log-file path
- `GET /api/sessions`: the current normalized in-memory `SessionData`
- `POST /api/scan`: run a scan, persist the new snapshot, and return it
- `GET /data/sessions.json`: compatibility route backed by the current in-memory snapshot

The runtime seeds itself from `public/data/sessions.json` when needed, then keeps its live cache under `tmp/local-runtime/`. This avoids triggering an Angular development rebuild every time the user refreshes data. It serves cached data while a scan is running, and a failed scan does not replace the last valid snapshot.

### Startup Diagnostics

If the app appears stuck on startup, there are three places to inspect:

1. The app loading screen shows the current scan step, recent runtime log messages, cached session count, and the runtime log-file path.
2. The terminal running `npm start` or `npx copilot-usage-studio` prints scan progress such as discovered workspace folders and debug-log folder counts.
3. The status endpoint can be queried directly:

```bash
npx copilot-usage-studio status
```

For packaged `npx` runs, the runtime log file is stored beside the local session cache:

- Windows: `%LOCALAPPDATA%\Copilot Usage Studio\runtime.log`
- macOS: `~/Library/Application Support/Copilot Usage Studio/runtime.log`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/copilot-usage-studio/runtime.log`

For repository development with `npm start`, the log is written to `tmp/local-runtime/runtime.log`.

To build the production UI and serve the complete local app with one command:

```bash
npm run preview:local
```

Then open `http://127.0.0.1:4312/`.

## Future Option: Desktop App

A desktop wrapper can bundle:

- the static Angular UI
- the scanner command
- local settings for VS Code paths
- optional app-owned SQLite later

Why: a desktop app would make the project easier for non-frontend developers to run. It also gives a natural place for refresh controls, background scanning, and local file permissions.

Recommended first implementation: Electron. The current scanner is Node ESM and uses `node:sqlite`, so Electron can reuse it directly. Tauri remains possible later, but it would require a Node sidecar or a scanner rewrite before it offers a meaningful simplicity advantage.

## Single Command

A lightweight local CLI now provides:

```bash
copilot-usage-studio scan
copilot-usage-studio
copilot-usage-studio scan
copilot-usage-studio status
```

Why: this keeps the project local and scriptable without committing to a desktop shell too early.

The shared scanner API, runtime, and npm executable are complete. The same runtime can be embedded by Electron later.

## Future Option: VS Code Companion Extension

A thin VS Code extension can call the shared scanner from the local extension host and show the existing UI in a webview. It should remain a host, not a fork of the pricing and parsing logic.

Why not move the whole product into an extension: keeping the scanner and analysis core editor-independent preserves a path to a desktop app and possible Visual Studio support if Visual Studio exposes equivalent local evidence later.

## Later, Not First Release

Do not optimize for a hosted SaaS version yet.

Reasons:

- The strongest data source is on the developer machine under VS Code workspace storage.
- Local debug logs can contain sensitive prompts, file paths, repo context, and tool results.
- The product is currently a cost debugger, not an organization billing system.

If billing reconciliation becomes important later, it can be added as an optional import without changing the local-first default.
