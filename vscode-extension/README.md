# Copilot Usage Studio

Local GitHub Copilot usage, memory, and customization evidence for VS Code.

This extension is the primary local host for Copilot Usage Studio. It opens the full app inside VS Code:

- Usage
- Sessions
- Memory
- Customizations
- Compare
- Insights
- Prices

The extension starts a local runtime on `127.0.0.1`, scans local VS Code Copilot data, and stores its generated cache in VS Code extension storage. No SaaS backend is used.

## Commands

- `Copilot Usage Studio: Open`
- `Copilot Usage Studio: Refresh Data`
- `Copilot Usage Studio: Show Logs`
- `Copilot Usage Studio: Export Diagnostics`
- `Copilot Usage Studio: Open in Browser`

## Status

Early local VSIX preview. Test locally before relying on it for daily use.

The npm/browser app remains available as a development and fallback host, but this extension is the product path:

```bash
npx copilot-usage-studio
```
