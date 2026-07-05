# Copilot Usage Studio

Local GitHub Copilot usage, memory, and customization evidence for VS Code.

This extension is the primary local host for Copilot Usage Studio. It opens the full app inside VS Code:

- Usage
- Sessions
- Memory
- Customizations preview
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

Available on the VS Code Marketplace.

Copilot Usage Studio is a local-first developer tool for understanding VS Code GitHub Copilot usage, memories, sessions, and customization evidence. The Customizations page is still a preview because VS Code request-log formats can change and the app only reports evidence visible in local logs.

The npm/browser app remains available as a development and fallback host:

```bash
npx copilot-usage-studio
```
