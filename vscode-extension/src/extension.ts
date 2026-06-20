import * as vscode from 'vscode';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type LocalRuntime = {
  address(): string | { port?: number } | null;
  close(): Promise<void>;
  listen(): Promise<string | { port?: number }>;
  refresh(reason?: string): Promise<unknown>;
};

type LocalRuntimeModule = {
  createLocalRuntime(options: Record<string, unknown>): LocalRuntime;
};

type RuntimeHandle = {
  runtime: LocalRuntime;
  baseUrl: string;
};

let output: vscode.OutputChannel;
let runtimeHandle: Promise<RuntimeHandle> | null = null;
let panel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Copilot Usage Studio');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotUsageStudio.open', () => openStudio(context)),
    vscode.commands.registerCommand('copilotUsageStudio.refresh', () => refreshData(context)),
    vscode.commands.registerCommand('copilotUsageStudio.showLogs', () => output.show(true)),
    vscode.commands.registerCommand('copilotUsageStudio.openInBrowser', () => openInBrowser(context)),
  );
}

export async function deactivate(): Promise<void> {
  const handle = runtimeHandle ? await runtimeHandle.catch(() => null) : null;
  await handle?.runtime.close();
  runtimeHandle = null;
}

async function openStudio(context: vscode.ExtensionContext): Promise<void> {
  const handle = await ensureRuntime(context);

  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    panel.webview.html = webviewHtml(context, panel.webview, handle.baseUrl);
    return;
  }

  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  panel = vscode.window.createWebviewPanel(
    'copilotUsageStudio',
    'Copilot Usage Studio',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewRoot],
    },
  );
  panel.iconPath = vscode.Uri.joinPath(webviewRoot, 'usage-studio.svg');
  panel.webview.html = webviewHtml(context, panel.webview, handle.baseUrl);
  panel.onDidDispose(() => {
    panel = null;
  });
}

async function refreshData(context: vscode.ExtensionContext): Promise<void> {
  const handle = await ensureRuntime(context);
  output.show(true);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Refreshing Copilot Usage Studio data',
      cancellable: false,
    },
    async () => {
      await handle.runtime.refresh('vscode-command');
    },
  );

  if (panel) {
    panel.webview.html = webviewHtml(context, panel.webview, handle.baseUrl);
  }
}

async function openInBrowser(context: vscode.ExtensionContext): Promise<void> {
  const handle = await ensureRuntime(context);
  await vscode.env.openExternal(vscode.Uri.parse(handle.baseUrl));
}

function ensureRuntime(context: vscode.ExtensionContext): Promise<RuntimeHandle> {
  runtimeHandle ??= startRuntime(context);
  return runtimeHandle;
}

async function startRuntime(context: vscode.ExtensionContext): Promise<RuntimeHandle> {
  mkdirSync(context.globalStorageUri.fsPath, { recursive: true });

  const runtimeRoot = join(context.extensionPath, 'dist', 'runtime');
  const runtimeModule = await import(
    pathToFileURL(join(runtimeRoot, 'lib', 'local-runtime.mjs')).href
  ) as LocalRuntimeModule;
  const runtime = runtimeModule.createLocalRuntime({
    host: '127.0.0.1',
    port: 0,
    backendOnly: true,
    staticDir: join(context.extensionPath, 'dist', 'webview'),
    dataFile: join(context.globalStorageUri.fsPath, 'sessions.json'),
    seedDataFile: null,
    logFile: join(context.globalStorageUri.fsPath, 'runtime.log'),
    logger: extensionLogger(),
  });
  const address = await runtime.listen();
  const port = typeof address === 'object' ? address.port : runtime.address()?.toString();

  if (!port || !Number.isFinite(Number(port))) {
    throw new Error('Copilot Usage Studio runtime did not report a local port.');
  }

  const baseUrl = `http://127.0.0.1:${Number(port)}`;
  output.appendLine(`Copilot Usage Studio webview API: ${baseUrl}`);
  return { runtime, baseUrl };
}

function extensionLogger(): Pick<Console, 'log' | 'warn' | 'error'> {
  return {
    log: (...args: unknown[]) => output.appendLine(args.map(String).join(' ')),
    warn: (...args: unknown[]) => output.appendLine(`Warning: ${args.map(String).join(' ')}`),
    error: (...args: unknown[]) => output.appendLine(`Error: ${args.map(String).join(' ')}`),
  };
}

function webviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  apiBaseUrl: string,
): string {
  const nonce = randomNonce();
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const indexPath = join(context.extensionPath, 'dist', 'webview', 'index.html');
  let html = readFileSync(indexPath, 'utf8');
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `connect-src ${apiBaseUrl}`,
  ].join('; ');
  const config = {
    mode: 'vscode',
    apiBaseUrl,
    initialView: 'usage',
    allowedViews: ['usage', 'memory', 'pricing'],
  };

  html = html.replace(
    /<base\s+href="[^"]*"\s*>/i,
    `<base href="${webview.asWebviewUri(webviewRoot).toString()}/">`,
  );
  html = html.replace(/\smedia="print"\s+onload="this\.media='all'"/g, ' media="all"');
  html = rewriteAssetUris(html, webview, webviewRoot);
  html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
  html = html.replace(
    '</head>',
    [
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      `<script nonce="${nonce}">window.__COPILOT_USAGE_STUDIO_HOST__=${JSON.stringify(config)};</script>`,
      '</head>',
    ].join(''),
  );

  return html;
}

function rewriteAssetUris(html: string, webview: vscode.Webview, root: vscode.Uri): string {
  return html.replace(/\b(src|href)="([^"]+)"/g, (match, attribute: string, value: string) => {
    if (
      value.startsWith('#') ||
      value.startsWith('data:') ||
      /^[a-z][a-z0-9+.-]*:/i.test(value)
    ) {
      return match;
    }

    const cleanValue = value.replace(/^\.\//, '').replace(/^\/+/, '');
    if (!cleanValue || cleanValue === '.') {
      return match;
    }

    return `${attribute}="${webview.asWebviewUri(vscode.Uri.joinPath(root, cleanValue)).toString()}"`;
  });
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
