import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(repoRoot, 'vscode-extension');
const extensionPackage = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const outputDir = join(repoRoot, 'tmp');
const outputFile = join(outputDir, `${extensionPackage.name}-${extensionPackage.version}.vsix`);
const vsceBin = join(repoRoot, 'node_modules', '@vscode', 'vsce', 'vsce');

mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [vsceBin, 'package', '--no-dependencies', '--out', outputFile],
  {
    cwd: extensionRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`VSIX written to ${outputFile}`);
