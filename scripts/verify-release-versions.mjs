import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = readJson(join(repoRoot, 'package.json'));
const extensionPackage = readJson(join(repoRoot, 'vscode-extension', 'package.json'));

if (rootPackage.version !== extensionPackage.version) {
  console.error(
    `Release version mismatch: package.json is ${rootPackage.version}, ` +
      `vscode-extension/package.json is ${extensionPackage.version}.`,
  );
  process.exit(1);
}

console.log(
  `Release versions match: npm and VS Code extension are ${rootPackage.version}.`,
);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
