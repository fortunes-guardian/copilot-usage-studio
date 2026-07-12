import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type LocalRuntime = {
  address(): string | { port?: number } | null;
  cancelScan?(): boolean;
  close(): Promise<void>;
  listen(): Promise<string | { port?: number }>;
  refresh(reason?: string, options?: { mode?: 'quick' | 'full' | 'customizations' }): Promise<unknown>;
  diagnostics?(): unknown;
};

type LocalRuntimeModule = {
  createLocalRuntime(options: Record<string, unknown>): LocalRuntime;
};

type RuntimeHandle = {
  runtime: LocalRuntime;
  baseUrl: string;
};

type CustomizationKind = 'instruction' | 'skill' | 'prompt' | 'hook' | 'agent';

type CustomizationDiscoveryLocation = {
  path: string;
  kind: CustomizationKind;
  source: string;
  settingKey: string;
  scope: string;
  rawLocation: string;
  workspaceFolder: string;
};

type CustomizationSettingSpec = {
  section: string;
  key: string;
  settingKey: string;
  kind: CustomizationKind;
  documentedDefault: Record<string, boolean>;
};

const customizationSettingSpecs: CustomizationSettingSpec[] = [
  {
    section: 'chat',
    key: 'instructionsFilesLocations',
    settingKey: 'chat.instructionsFilesLocations',
    kind: 'instruction',
    documentedDefault: { '.github/instructions': true, '~/.claude/rules': false },
  },
  {
    section: 'chat',
    key: 'promptFilesLocations',
    settingKey: 'chat.promptFilesLocations',
    kind: 'prompt',
    documentedDefault: { '.github/prompts': true },
  },
  {
    section: 'chat',
    key: 'agentFilesLocations',
    settingKey: 'chat.agentFilesLocations',
    kind: 'agent',
    documentedDefault: { '.github/agents': true },
  },
  {
    section: 'chat',
    key: 'agentSkillsLocations',
    settingKey: 'chat.agentSkillsLocations',
    kind: 'skill',
    documentedDefault: {
      '.github/skills': true,
      '.claude/skills': true,
      '~/.copilot/skills': true,
      '~/.claude/skills': true,
    },
  },
  {
    section: 'chat',
    key: 'hookFilesLocations',
    settingKey: 'chat.hookFilesLocations',
    kind: 'hook',
    documentedDefault: {},
  },
];

let output: vscode.OutputChannel;
let runtimeHandle: Promise<RuntimeHandle> | null = null;
let panel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Copilot Usage Studio');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotUsageStudio.open', () => openStudio(context)),
    vscode.commands.registerCommand('copilotUsageStudio.refresh', () => refreshData(context, 'quick')),
    vscode.commands.registerCommand('copilotUsageStudio.fullRescan', () => refreshData(context, 'full')),
    vscode.commands.registerCommand('copilotUsageStudio.showLogs', () => output.show(true)),
    vscode.commands.registerCommand('copilotUsageStudio.exportDiagnostics', () => exportDiagnostics(context)),
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

async function refreshData(
  context: vscode.ExtensionContext,
  mode: 'quick' | 'full' = 'quick',
): Promise<void> {
  const handle = await ensureRuntime(context);
  output.show(true);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: mode === 'full' ? 'Rebuilding Copilot Usage Studio data' : 'Checking for new Copilot data',
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => handle.runtime.cancelScan?.());
      await handle.runtime.refresh('vscode-command', { mode });
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

async function exportDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const handle = await ensureRuntime(context);
  const diagnostics = typeof handle.runtime.diagnostics === 'function'
    ? handle.runtime.diagnostics()
    : { status: 'Runtime diagnostics are unavailable in this build.' };
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const diagnosticsPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    `copilot-usage-studio-diagnostics-${timestamp}.json`,
  );
  mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
  writeFileSync(diagnosticsPath.fsPath, JSON.stringify(diagnostics, null, 2), 'utf8');
  output.appendLine(`Exported Copilot Usage Studio diagnostics: ${diagnosticsPath.fsPath}`);
  const open = 'Open diagnostics';
  const choice = await vscode.window.showInformationMessage(
    'Copilot Usage Studio diagnostics exported.',
    open,
  );
  if (choice === open) {
    const document = await vscode.workspace.openTextDocument(diagnosticsPath);
    await vscode.window.showTextDocument(document, { preview: true });
  }
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
    scanOptions: {
      roots: [vsCodeUserDataRoot(context)],
      customizationWorkspaceFolders: currentWorkspaceFolders(),
      customizationDiscovery: buildCustomizationDiscovery(),
      includeCustomizations: false,
    },
    startupScanMode: 'quick',
    logger: extensionLogger(),
  });
  logDebugSettings();
  const address = await runtime.listen();
  const port = typeof address === 'object' ? address.port : runtime.address()?.toString();

  if (!port || !Number.isFinite(Number(port))) {
    throw new Error('Copilot Usage Studio runtime did not report a local port.');
  }

  const baseUrl = `http://127.0.0.1:${Number(port)}`;
  output.appendLine(`Copilot Usage Studio webview API: ${baseUrl}`);
  return { runtime, baseUrl };
}

function vsCodeUserDataRoot(context: vscode.ExtensionContext): string {
  return dirname(dirname(context.globalStorageUri.fsPath));
}

function currentWorkspaceFolders(): string[] {
  return vscode.workspace.workspaceFolders
    ?.filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath) ?? [];
}

function logDebugSettings(): void {
  const debugConfig = vscode.workspace.getConfiguration('github.copilot.chat.agentDebugLog');
  const fileLogging = agentDebugLogFileLoggingEnabled();
  const agentLogs = debugConfig.get<boolean>('enabled');
  output.appendLine(
    `VS Code root scan is limited to this VS Code user-data folder; startup scans skip customization evidence for speed.`,
  );
  const workspaceFolders = currentWorkspaceFolders();
  output.appendLine(
    workspaceFolders.length
      ? `Customization evidence scans are limited to the current VS Code workspace folder${workspaceFolders.length === 1 ? '' : 's'}: ${workspaceFolders.join('; ')}.`
      : 'No current VS Code workspace folder is open; customization evidence scans will not scan every historical workspace by default.',
  );
  output.appendLine(
    `Agent debug log settings: enabled=${String(agentLogs)}, fileLogging.enabled=${String(fileLogging)}.`,
  );
  logCustomizationSettings();
  if (fileLogging === false) {
    output.appendLine(
      `Agent debug file logging is off. Existing cached sessions may still show, but new exact usage requires github.copilot.chat.agentDebugLog.fileLogging.enabled.`,
    );
  }
}

function logCustomizationSettings(): void {
  const discovery = buildCustomizationDiscovery();
  const sourceCounts = discovery.locations.reduce<Record<string, number>>((counts, location) => {
    counts[location.source] = (counts[location.source] ?? 0) + 1;
    return counts;
  }, {});
  const summary = Object.entries(sourceCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, count]) => `${source}=${count}`);
  output.appendLine(
    `Resolved Copilot customization discovery from VS Code API: ${discovery.locations.length} location${discovery.locations.length === 1 ? '' : 's'} (${summary.join(', ') || 'none'}).`,
  );
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
    allowedViews: ['usage', 'sessions', 'memory', 'customizations', 'compare', 'analytics', 'pricing'],
    agentDebugLogFileLoggingEnabled: agentDebugLogFileLoggingEnabled(),
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

function agentDebugLogFileLoggingEnabled(): boolean | undefined {
  return vscode.workspace
    .getConfiguration('github.copilot.chat.agentDebugLog')
    .get<boolean>('fileLogging.enabled');
}

function buildCustomizationDiscovery(): { strict: true; generatedBy: string; locations: CustomizationDiscoveryLocation[] } {
  const locations = new Map<string, CustomizationDiscoveryLocation>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') {
      continue;
    }
    const workspaceFolder = folder.uri.fsPath;

    for (const spec of customizationSettingSpecs) {
      const config = vscode.workspace.getConfiguration(spec.section, folder.uri);
      const inspected = config.inspect<Record<string, boolean>>(spec.key);
      for (const [scope, value] of inspectedSettingObjects(inspected, spec.documentedDefault)) {
        for (const [rawLocation, enabled] of Object.entries(value)) {
          if (enabled !== true) {
            continue;
          }
          addCustomizationLocation(locations, {
            path: resolveCustomizationLocation(rawLocation, workspaceFolder),
            kind: spec.kind,
            source: scope === 'default' ? 'vscode-default' : `vscode-${scope}-setting`,
            settingKey: spec.settingKey,
            scope,
            rawLocation,
            workspaceFolder,
          });
        }
      }
    }

    addBooleanDefaultLocation(
      locations,
      folder.uri,
      workspaceFolder,
      'github.copilot.chat.codeGeneration',
      'useInstructionFiles',
      '.github/copilot-instructions.md',
      'instruction',
    );
    addBooleanDefaultLocation(
      locations,
      folder.uri,
      workspaceFolder,
      'chat',
      'useAgentsMdFile',
      'AGENTS.md',
      'instruction',
    );
    addBooleanDefaultLocation(
      locations,
      folder.uri,
      workspaceFolder,
      'chat',
      'useClaudeMdFile',
      'CLAUDE.md',
      'instruction',
    );

    if (vscode.workspace.getConfiguration('chat', folder.uri).get<boolean>('useCustomizationsInParentRepositories') === true) {
      for (const repoFolder of parentRepositoryFolders(workspaceFolder)) {
        for (const spec of customizationSettingSpecs) {
          for (const [rawLocation, enabled] of Object.entries(spec.documentedDefault)) {
            if (enabled !== true || rawLocation.startsWith('~')) {
              continue;
            }
            addCustomizationLocation(locations, {
              path: resolveCustomizationLocation(rawLocation, repoFolder),
              kind: spec.kind,
              source: 'vscode-parent-repo-default',
              settingKey: 'chat.useCustomizationsInParentRepositories',
              scope: 'parent-repo',
              rawLocation,
              workspaceFolder,
            });
          }
        }
      }
    }
  }

  return {
    strict: true,
    generatedBy: 'vscode-extension-api',
    locations: [...locations.values()].sort((a, b) =>
      `${a.workspaceFolder}:${a.kind}:${a.path}`.localeCompare(`${b.workspaceFolder}:${b.kind}:${b.path}`),
    ),
  };
}

function inspectedSettingObjects(
  inspected: ReturnType<vscode.WorkspaceConfiguration['inspect']> | undefined,
  documentedDefault: Record<string, boolean>,
): Array<[string, Record<string, boolean>]> {
  const values: Array<[string, unknown]> = [
    ['default', inspected?.defaultValue ?? documentedDefault],
    ['user', inspected?.globalValue],
    ['workspace', inspected?.workspaceValue],
    ['workspace-folder', inspected?.workspaceFolderValue],
  ];
  return values
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([scope, value]) => [scope, value as Record<string, boolean>]);
}

function addBooleanDefaultLocation(
  locations: Map<string, CustomizationDiscoveryLocation>,
  scopeUri: vscode.Uri,
  workspaceFolder: string,
  section: string,
  key: string,
  rawLocation: string,
  kind: CustomizationKind,
): void {
  const config = vscode.workspace.getConfiguration(section, scopeUri);
  if (config.get<boolean>(key) === false) {
    return;
  }
  const inspected = config.inspect<boolean>(key);
  const source = inspected?.workspaceFolderValue !== undefined
    ? 'vscode-workspace-folder-setting'
    : inspected?.workspaceValue !== undefined
      ? 'vscode-workspace-setting'
      : inspected?.globalValue !== undefined
        ? 'vscode-user-setting'
        : 'vscode-default';
  addCustomizationLocation(locations, {
    path: resolveCustomizationLocation(rawLocation, workspaceFolder),
    kind,
    source,
    settingKey: `${section}.${key}`,
    scope: source.replace(/^vscode-/, '').replace(/-setting$/, ''),
    rawLocation,
    workspaceFolder,
  });
}

function addCustomizationLocation(
  locations: Map<string, CustomizationDiscoveryLocation>,
  location: CustomizationDiscoveryLocation,
): void {
  const key = `${location.workspaceFolder}:${location.kind}:${location.path}:${location.source}:${location.settingKey}`;
  locations.set(key, location);
}

function resolveCustomizationLocation(rawLocation: string, workspaceFolder: string): string {
  if (rawLocation.startsWith('~/') || rawLocation.startsWith('~\\')) {
    return resolve(homedir(), rawLocation.slice(2));
  }
  return isAbsolute(rawLocation) ? resolve(rawLocation) : resolve(workspaceFolder, rawLocation);
}

function parentRepositoryFolders(workspaceFolder: string): string[] {
  const roots: string[] = [];
  let current = resolve(workspaceFolder);
  while (true) {
    if (existsSync(join(current, '.git')) && current !== resolve(workspaceFolder)) {
      roots.push(current);
    }
    const parent = dirname(current);
    if (parent === current) {
      return roots;
    }
    current = parent;
  }
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
