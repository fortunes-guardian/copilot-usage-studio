import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(repoRoot, 'vscode-extension');
const extensionDist = join(extensionRoot, 'dist');
const extensionOnly = process.argv.includes('--extension-only');

mkdirSync(extensionDist, { recursive: true });

if (!extensionOnly) {
  rmSync(extensionDist, { recursive: true, force: true });
  mkdirSync(extensionDist, { recursive: true });
  copyRequiredRuntimeAssets();
}

await esbuild.build({
  entryPoints: [join(extensionRoot, 'src', 'extension.ts')],
  outfile: join(extensionDist, 'extension.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: false,
  logLevel: 'info',
});

function copyRequiredRuntimeAssets() {
  const webviewSource = join(repoRoot, 'dist', 'copilot-usage-studio', 'browser');
  const webviewTarget = join(extensionDist, 'webview');

  if (!existsSync(join(webviewSource, 'index.html'))) {
    throw new Error('Angular build output is missing. Run npm run build before building the VS Code extension.');
  }

  cpSync(webviewSource, webviewTarget, { recursive: true });
  cpSync(join(repoRoot, 'lib'), join(extensionDist, 'runtime', 'lib'), { recursive: true });
  mkdirSync(join(extensionDist, 'runtime', 'scripts'), { recursive: true });
  cpSync(
    join(repoRoot, 'scripts', 'scan-vscode-sessions.mjs'),
    join(extensionDist, 'runtime', 'scripts', 'scan-vscode-sessions.mjs'),
  );
  cpSync(
    join(repoRoot, 'scripts', 'pricing-utils.mjs'),
    join(extensionDist, 'runtime', 'scripts', 'pricing-utils.mjs'),
  );
  mkdirSync(join(extensionDist, 'runtime', 'data'), { recursive: true });
  cpSync(
    join(repoRoot, 'data', 'github-copilot-pricing.json'),
    join(extensionDist, 'runtime', 'data', 'github-copilot-pricing.json'),
  );
}
