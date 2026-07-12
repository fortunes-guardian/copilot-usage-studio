import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackagePath = join(repoRoot, 'package.json');
const extensionPackagePath = join(repoRoot, 'vscode-extension', 'package.json');
const rootPackage = readJson(rootPackagePath);
const extensionPackage = readJson(extensionPackagePath);

extensionPackage.version = rootPackage.version;
writeFileSync(extensionPackagePath, `${JSON.stringify(extensionPackage, null, 2)}\n`);
execFileSync(
  'git',
  ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'add', 'vscode-extension/package.json'],
  { cwd: repoRoot, stdio: 'inherit' },
);

console.log(`Synchronized VS Code extension version to ${rootPackage.version}.`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
