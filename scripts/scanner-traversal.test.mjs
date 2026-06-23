import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  listFilesRecursive,
  uniqueResolvedRoots,
  workspaceDirsForRoot,
} from './scanner-traversal.mjs';

test('discovers only direct VS Code workspace storage entries from a user-data root', () => {
  const root = mkdtempSync(join(tmpdir(), 'cus-traversal-'));
  try {
    const userDir = join(root, 'Code', 'User');
    const workspaceA = join(userDir, 'workspaceStorage', 'workspace-a');
    const workspaceB = join(userDir, 'workspaceStorage', 'workspace-b');
    const unrelatedNested = join(userDir, 'workspaceStorage', 'workspace-a', 'nested-workspace');
    mkdirSync(workspaceA, { recursive: true });
    mkdirSync(workspaceB, { recursive: true });
    mkdirSync(unrelatedNested, { recursive: true });
    writeFileSync(join(workspaceA, 'workspace.json'), '{}', 'utf8');
    writeFileSync(join(workspaceB, 'workspace.json'), '{}', 'utf8');
    writeFileSync(join(unrelatedNested, 'workspace.json'), '{}', 'utf8');

    assert.deepEqual(workspaceDirsForRoot(userDir).sort(), [workspaceA, workspaceB].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recursive traversal skips dependency and build directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'cus-traversal-'));
  try {
    const allowed = join(root, '.github', 'instructions');
    const ignoredDependency = join(root, 'node_modules', 'bad-package');
    const ignoredBuild = join(root, 'dist', 'generated');
    mkdirSync(allowed, { recursive: true });
    mkdirSync(ignoredDependency, { recursive: true });
    mkdirSync(ignoredBuild, { recursive: true });
    writeFileSync(join(allowed, 'good.instructions.md'), 'Use validators.', 'utf8');
    writeFileSync(join(ignoredDependency, 'bad.instructions.md'), 'Do not scan.', 'utf8');
    writeFileSync(join(ignoredBuild, 'bad.instructions.md'), 'Do not scan.', 'utf8');

    const files = listFilesRecursive(root, (file) => file.endsWith('.md'), 20, {
      label: 'test',
      maxDepth: 5,
      maxDirs: 50,
    });

    assert.deepEqual(files, [join(allowed, 'good.instructions.md')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('configured roots are resolved and de-duplicated before scanning', () => {
  const root = mkdtempSync(join(tmpdir(), 'cus-traversal-'));
  try {
    assert.deepEqual(uniqueResolvedRoots([root, `${root}/.`]), [root]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
