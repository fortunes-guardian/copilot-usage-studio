import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const skippedTraversalDirs = new Set([
  '.angular',
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.pnpm-store',
  '.svn',
  '.turbo',
  '.venv',
  '__pycache__',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  'venv',
]);

export function defaultCodeUserDirs() {
  const home = homedir();

  if (platform() === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [join(appData, 'Code', 'User'), join(appData, 'Code - Insiders', 'User')];
  }

  if (platform() === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Code', 'User'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'),
    ];
  }

  return [join(home, '.config', 'Code', 'User'), join(home, '.config', 'Code - Insiders', 'User')];
}

export function listDirs(dir, options = {}) {
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => join(dir, entry.name));
  } catch (error) {
    warn(options, `${dir}: directory listing skipped: ${error.message}`);
    return [];
  }
}

export function listFiles(dir, suffix, options = {}) {
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name));
  } catch (error) {
    warn(options, `${dir}: file listing skipped: ${error.message}`);
    return [];
  }
}

export function listDebugLogFiles(root, options = {}) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  const pending = [{ path: root, depth: 0 }];
  const maxDepth = Number(options.maxDepth ?? 4);
  const maxDirs = Number(options.maxDirs ?? 2000);
  let visitedDirs = 0;

  while (pending.length && visitedDirs < maxDirs) {
    const current = pending.pop();
    visitedDirs += 1;
    let entries = [];
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch (error) {
      warn(options, `${current.path}: debug-log side-file scan skipped: ${error.message}`);
      continue;
    }
    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory() && current.depth < maxDepth && !skippedTraversalDirs.has(entry.name)) {
        pending.push({ path, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path);
      }
    }
  }
  if (pending.length) {
    warn(options, `${root}: debug-log side-file scan capped at ${maxDirs} directories.`);
  }

  return files.sort();
}

export function listFilesRecursive(root, predicate, limit, options = {}) {
  if (!existsSync(root)) {
    return [];
  }

  const maxDepth = Number(options.maxDepth ?? 8);
  const maxDirs = Number(options.maxDirs ?? 5000);
  const label = options.label ?? 'recursive';
  const fileLimit = Number(limit ?? 5000);
  const files = [];
  const pending = [{ path: root, depth: 0 }];
  let visitedDirs = 0;

  while (pending.length && files.length < fileLimit && visitedDirs < maxDirs) {
    const current = pending.pop();
    visitedDirs += 1;
    let entries = [];

    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch (error) {
      options.onUnreadable?.(current.path, error);
      warn(options, `${current.path}: ${label} directory skipped: ${error.message}`);
      continue;
    }

    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < maxDepth && !skippedTraversalDirs.has(entry.name)) {
          pending.push({ path, depth: current.depth + 1 });
        }
      } else if (entry.isFile() && predicate(path)) {
        files.push(path);
        if (files.length >= fileLimit) {
          warn(options, `${root}: ${label} scan capped at ${fileLimit} files.`);
          break;
        }
      }
    }
  }
  if (pending.length) {
    warn(options, `${root}: ${label} scan capped at ${maxDirs} directories.`);
  }

  return files;
}

export function workspaceDirsFromUserDir(userDir, options = {}) {
  const workspaceStorage = join(userDir, 'workspaceStorage');
  return listDirs(workspaceStorage, options);
}

export function workspaceDirsForRoot(root, options = {}) {
  if (existsSync(join(root, 'workspace.json'))) {
    return [root];
  }
  if (basename(root) === 'workspaceStorage') {
    return listDirs(root, options);
  }
  return workspaceDirsFromUserDir(root, options);
}

export function userDirForRoot(root) {
  if (existsSync(join(root, 'workspaceStorage'))) {
    return root;
  }
  if (basename(root) === 'workspaceStorage') {
    return dirname(root);
  }
  if (basename(dirname(root)) === 'workspaceStorage') {
    return dirname(dirname(root));
  }
  return null;
}

export function uniqueResolvedRoots(configuredRoots) {
  return [...new Set(configuredRoots.map((root) => resolve(String(root))))];
}

function warn(options, message) {
  if (typeof options.onWarning === 'function') {
    options.onWarning(message);
  }
}
