import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(repoRoot, 'vscode-extension');
const extensionDist = join(extensionRoot, 'dist');

const required = [
  'extension.cjs',
  'webview/index.html',
  'webview/usage-studio.svg',
  'runtime/lib/local-runtime.mjs',
  'runtime/lib/scanner-api.mjs',
  'runtime/lib/scanner-worker.mjs',
  'runtime/scripts/scan-vscode-sessions.mjs',
  'runtime/scripts/pricing-utils.mjs',
  'runtime/data/github-copilot-pricing.json',
];

const missing = required.filter((file) => !existsSync(join(extensionDist, file)));
if (missing.length) {
  throw new Error(`VS Code extension build is missing required files:\n${missing.join('\n')}`);
}

const forbidden = listFiles(extensionRoot)
  .map((file) => relative(extensionRoot, file).replaceAll('\\', '/'))
  .filter((file) =>
    file.endsWith('/sessions.json') ||
    file === 'sessions.json' ||
    file.startsWith('dist/webview/data/') ||
    file.startsWith('dist/runtime/public/data/') ||
    file.includes('vscode-schema-baseline'),
  );

if (forbidden.length) {
  throw new Error(`VS Code extension package contains forbidden local/generated data:\n${forbidden.join('\n')}`);
}

console.log(`VS Code extension verification passed: ${required.length} required files present.`);

function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          pending.push(path);
        }
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return files.filter((file) => statSync(file).isFile());
}
