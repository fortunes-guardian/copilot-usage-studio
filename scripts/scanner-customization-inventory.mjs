import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userDirForRoot } from './scanner-traversal.mjs';

const customizationFileLimit = 1000;
const customizationFileSizeLimit = 1024 * 1024;

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripJsonComments(text) {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (character === '\n' || character === '\r') {
        inLineComment = false;
        output += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += character;
  }

  return output;
}

function memoryTitle(content, file) {
  const heading = String(content)
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,3}\s+(.+?)\s*#*$/)?.[1]?.trim())
    .find(Boolean);

  if (heading) {
    return heading.slice(0, 160);
  }

  return basename(file, extname(file))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .slice(0, 160);
}

function memoryExcerpt(content) {
  return String(content)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[\x60*_>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

export function createCustomizationInventoryScanner(context = {}) {
  const diagnostics = () => context.diagnostics?.() ?? context.diagnostics ?? { warnings: [] };
  const listDirs = (...args) => context.listDirs?.(...args) ?? [];
  const listFilesRecursive = (...args) => context.listFilesRecursive?.(...args) ?? [];
  const workspaceName = (...args) => context.workspaceName?.(...args) ?? '';
  const workspaceFolderPath = (...args) => context.workspaceFolderPath?.(...args) ?? '';

  function readJsoncFile(file) {
    if (!existsSync(file)) {
      return {};
    }

    try {
      const json = stripJsonComments(readFileSync(file, 'utf8')).replace(/,\s*([}\]])/g, '$1');
      return safeJson(json) ?? {};
    } catch (error) {
      diagnostics().warnings.push(String(file) + ': settings file skipped: ' + error.message);
      return {};
    }
  }

  function readJsonl(file) {
    if (context.readJsonl) {
      return context.readJsonl(file);
    }
    if (!existsSync(file)) {
      return [];
    }

    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeJson(line))
      .filter(Boolean);
  }

function parseSimpleFrontmatter(content) {
    const text = String(content ?? '');
    if (!text.startsWith('---')) {
      return {};
    }
  
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      return {};
    }
  
    const result = {};
    const lines = match[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const scalar = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!scalar) {
        continue;
      }
  
      const key = scalar[1];
      let value = scalar[2].trim();
      if (value === '|') {
        const block = [];
        index += 1;
        while (index < lines.length && /^\s+/.test(lines[index])) {
          block.push(lines[index].replace(/^\s{2}/, ''));
          index += 1;
        }
        index -= 1;
        result[key] = block.join('\n').trim();
        continue;
      }
  
      const list = [];
      while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])) {
        index += 1;
        list.push(lines[index].replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '').trim());
      }
      result[key] = list.length ? list : value.replace(/^["']|["']$/g, '');
    }
  
    return result;
  }
  
  function markdownTitle(content, file) {
    const frontmatter = parseSimpleFrontmatter(content);
    if (frontmatter.title) {
      return String(frontmatter.title).slice(0, 160);
    }
  
    return memoryTitle(content, file);
  }
  
  function titleFromFileName(file) {
    return basename(file, extname(file))
      .replace(/\.instructions$/i, '')
      .replace(/\.skill$/i, '')
      .replace(/\.agent$/i, '')
      .replace(/^copilot-instructions$/i, 'Copilot Instructions')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .slice(0, 160);
  }
  
  function isMarkdownFile(file) {
    return extname(file).toLowerCase() === '.md';
  }
  
  function isCustomizationSourceFile(file) {
    const extension = extname(file).toLowerCase();
    return extension === '.md' || extension === '.json';
  }
  
  function looksLikeCopilotCustomizationPath(file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const name = basename(file).toLowerCase();
  
    return (
      normalized.includes('/.github/instructions/') ||
      normalized.includes('/.claude/rules/') ||
      normalized.includes('/.copilot/instructions/') ||
      normalized.includes('/.github/skills/') ||
      normalized.includes('/.claude/skills/') ||
      normalized.includes('/.agents/skills/') ||
      normalized.includes('/.copilot/skills/') ||
      normalized.includes('/.github/prompts/') ||
      normalized.includes('/.copilot/prompts/') ||
      normalized.includes('/.github/hooks/') ||
      normalized.includes('/.copilot/hooks/') ||
      normalized.includes('/.github/agents/') ||
      normalized.includes('/.claude/agents/') ||
      normalized.includes('/user/prompts/') ||
      normalized.includes('/.copilot/agents/') ||
      name === 'copilot-instructions.md' ||
      name === 'agents.md' ||
      name === 'claude.md' ||
      name === 'claude.local.md' ||
      name === 'gemini.md' ||
      name === 'settings.json' ||
      name === 'settings.local.json' ||
      name.endsWith('.instructions.md') ||
      name.endsWith('.prompt.md') ||
      name.endsWith('.skill.md') ||
      name.endsWith('.agent.md') ||
      name === 'skill.md'
    );
  }
  
  function customizationKind(file) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const name = basename(file).toLowerCase();
  
    if (
      normalized.includes('/.github/instructions/') ||
      normalized.includes('/.claude/rules/') ||
      normalized.includes('/.copilot/instructions/') ||
      name === 'copilot-instructions.md' ||
      name === 'agents.md' ||
      name === 'claude.md' ||
      name === 'claude.local.md' ||
      name === 'gemini.md' ||
      name.endsWith('.instructions.md')
    ) {
      return 'instruction';
    }
    if (
      normalized.includes('/.github/skills/') ||
      normalized.includes('/.claude/skills/') ||
      normalized.includes('/.agents/skills/') ||
      normalized.includes('/.copilot/skills/') ||
      name === 'skill.md' ||
      name.endsWith('.skill.md')
    ) {
      return 'skill';
    }
    if (
      normalized.includes('/.github/prompts/') ||
      normalized.includes('/.copilot/prompts/') ||
      normalized.includes('/user/prompts/') ||
      name.endsWith('.prompt.md')
    ) {
      return 'prompt';
    }
    if (
      normalized.includes('/.github/hooks/') ||
      normalized.includes('/.copilot/hooks/') ||
      name === 'settings.json' ||
      name === 'settings.local.json'
    ) {
      return 'hook';
    }
    if (
      normalized.includes('/.github/agents/') ||
      normalized.includes('/.claude/agents/') ||
      normalized.includes('/.copilot/agents/') ||
      name.endsWith('.agent.md')
    ) {
      return 'agent';
    }
    return 'other';
  }
  
  function customizationFromFile(file, root, workspace, forcedKind = '') {
    try {
      const stats = statSync(file);
      if (stats.size > customizationFileSizeLimit) {
        diagnostics().skippedOversizedCustomizations += 1;
        diagnostics().warnings.push(`${file}: customization skipped because it exceeds 1 MiB.`);
        return null;
      }
  
      const content = readFileSync(file, 'utf8');
      const frontmatter = parseSimpleFrontmatter(content);
      const kind = forcedKind || customizationKind(file);
      const relativePath = relative(root, file);
      const description = String(frontmatter.description ?? '').trim();
      const applyTo = Array.isArray(frontmatter.applyTo)
        ? frontmatter.applyTo.map(String)
        : String(frontmatter.applyTo ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
  
      return {
        id: createHash('sha256').update(resolve(file)).digest('hex').slice(0, 24),
        kind,
        title: frontmatter.title ? markdownTitle(content, file) : titleFromFileName(file),
        name: String(frontmatter.id ?? basename(file, extname(file))).trim(),
        description: description || memoryExcerpt(content).slice(0, 180),
        applyTo,
        triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers.map(String) : [],
        scope: frontmatter.scope ? String(frontmatter.scope) : 'workspace',
        workspace,
        sourcePath: resolve(file),
        relativePath,
        createdAt: stats.birthtimeMs > 0 ? stats.birthtime.toISOString() : '',
        modifiedAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
        characterCount: content.length,
        lineCount: content ? content.split(/\r?\n/).length : 0,
        excerpt: memoryExcerpt(content),
        _content: content,
      };
    } catch (error) {
      diagnostics().skippedUnreadableCustomizations += 1;
      diagnostics().warnings.push(`${file}: customization skipped: ${error.message}`);
      return null;
    }
  }
  
  function nearestGitRoot(folder) {
    let current = resolve(folder);
  
    while (true) {
      if (existsSync(join(current, '.git'))) {
        return current;
      }
  
      const parent = dirname(current);
      if (parent === current) {
        return '';
      }
      current = parent;
    }
  }
  
  function customizationCandidateBases(folder) {
    const resolvedFolder = resolve(folder);
    const gitRoot = nearestGitRoot(resolvedFolder);
    if (!gitRoot) {
      return [resolvedFolder];
    }
  
    const bases = [];
    let current = resolvedFolder;
    while (true) {
      bases.push(current);
      if (current === gitRoot) {
        break;
      }
  
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  
    return [...new Set(bases)];
  }
  
  function containedByBase(candidate, base) {
    const resolvedCandidate = resolve(candidate);
    const resolvedBase = resolve(base);
    return resolvedCandidate === resolvedBase || resolvedCandidate.startsWith(`${resolvedBase}${sep}`);
  }
  
  function directCustomizationFiles(base) {
    const files = [
      join(base, '.github', 'copilot-instructions.md'),
      join(base, '.claude', 'CLAUDE.md'),
      join(base, '.claude', 'CLAUDE.local.md'),
      join(base, '.claude', 'settings.json'),
      join(base, '.claude', 'settings.local.json'),
      join(base, 'AGENTS.md'),
      join(base, 'CLAUDE.md'),
      join(base, 'GEMINI.md'),
    ].filter((file) => existsSync(file) && isCustomizationSourceFile(file));
  
    for (const file of files) {
      recordCustomizationLocation(file, 'file');
    }
  
    return files;
  }
  
  function customizationFilesFromKnownRoots(base) {
    const roots = [
      join(base, '.github', 'instructions'),
      join(base, '.claude', 'rules'),
      join(base, '.copilot', 'instructions'),
      join(base, '.github', 'skills'),
      join(base, '.claude', 'skills'),
      join(base, '.agents', 'skills'),
      join(base, '.copilot', 'skills'),
      join(base, '.github', 'prompts'),
      join(base, 'prompts'),
      join(base, '.copilot', 'prompts'),
      join(base, '.github', 'hooks'),
      join(base, '.copilot', 'hooks'),
      join(base, '.github', 'agents'),
      join(base, '.claude', 'agents'),
      join(base, '.copilot', 'agents'),
    ].filter(existsSync);
  
    return roots.flatMap((root) => {
      diagnostics().scannedCustomizationRoots += 1;
      recordCustomizationLocation(root, 'root');
      const files = listFilesRecursive(
        root,
        (file) => isCustomizationSourceFile(file) && looksLikeCopilotCustomizationPath(file),
        customizationFileLimit,
        { label: 'customization', maxDepth: 5, maxDirs: 300 },
      );
      if (files.length >= customizationFileLimit) {
        diagnostics().warnings.push(`${root}: customization scan capped at ${customizationFileLimit} files.`);
      }
      return files;
    });
  }
  
  function configuredCustomizationLocationEntries(workspaceDir, workspaceFolder) {
    const entries = [];
    const userDir = userDirForRoot(workspaceDir);
    const settingsFiles = [
      userDir ? { file: join(userDir, 'settings.json'), base: workspaceFolder, scope: 'user-settings' } : null,
      { file: join(workspaceFolder, '.vscode', 'settings.json'), base: workspaceFolder, scope: 'workspace-settings' },
    ].filter(Boolean);
    const settingKinds = [
      ['chat.instructionsFilesLocations', 'instruction'],
      ['chat.promptFilesLocations', 'prompt'],
      ['chat.agentFilesLocations', 'agent'],
      ['chat.agentSkillsLocations', 'skill'],
      ['chat.hookFilesLocations', 'hook'],
    ];
  
    for (const settingsFile of settingsFiles) {
      const settings = readJsoncFile(settingsFile.file);
      for (const [settingKey, kind] of settingKinds) {
        const configured = settings[settingKey];
        if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
          continue;
        }
  
        for (const [location, enabled] of Object.entries(configured)) {
          if (enabled !== true) {
            continue;
          }
  
          const normalized = normalizeLocalPathCandidate(location);
          const path = normalized.startsWith('~/') || normalized.startsWith('~\\')
            ? resolve(homedir(), normalized.slice(2))
            : isAbsolute(normalized)
              ? resolve(normalized)
              : resolve(settingsFile.base, normalized);
          entries.push({ path, kind, source: settingsFile.scope, settingKey });
        }
      }
    }
  
    return entries;
  }
  
  function defaultUserCustomizationLocationEntries() {
    return [
      {
        path: join(homedir(), '.copilot', 'skills'),
        kind: 'skill',
        source: 'user-default',
        settingKey: 'chat.agentSkillsLocations',
      },
      {
        path: join(homedir(), '.claude', 'skills'),
        kind: 'skill',
        source: 'user-default',
        settingKey: 'chat.agentSkillsLocations',
      },
      {
        path: join(homedir(), '.agents', 'skills'),
        kind: 'skill',
        source: 'user-default',
        settingKey: 'chat.agentSkillsLocations',
      },
      {
        path: join(homedir(), '.copilot', 'hooks'),
        kind: 'hook',
        source: 'user-default',
        settingKey: 'chat.hookFilesLocations',
      },
      {
        path: join(homedir(), '.claude', 'settings.json'),
        kind: 'hook',
        source: 'user-default',
        settingKey: 'chat.hookFilesLocations',
      },
      {
        path: join(homedir(), '.claude', 'settings.local.json'),
        kind: 'hook',
        source: 'user-default',
        settingKey: 'chat.hookFilesLocations',
      },
    ];
  }
  
  function configuredCustomizationFilePredicate(kind, file) {
    const name = basename(file).toLowerCase();
    const extension = extname(file).toLowerCase();
  
    if (kind === 'instruction') {
      return extension === '.md' && (
        name === 'copilot-instructions.md' ||
        name === 'agents.md' ||
        name === 'claude.md' ||
        name === 'claude.local.md' ||
        name === 'gemini.md' ||
        name.endsWith('.instructions.md')
      );
    }
  
    if (kind === 'skill') {
      return extension === '.md' && (name === 'skill.md' || name.endsWith('.skill.md'));
    }
  
    if (kind === 'prompt') {
      return extension === '.md' && name.endsWith('.prompt.md');
    }
  
    if (kind === 'hook') {
      return extension === '.json';
    }
  
    return isCustomizationSourceFile(file) && looksLikeCopilotCustomizationPath(file);
  }
  
  function customizationsFromConfiguredSettings(workspaceDir, workspaceFolder, workspace, options = {}) {
    const files = new Map();
    for (const entry of [
      ...configuredCustomizationLocationEntries(workspaceDir, workspaceFolder),
      ...defaultUserCustomizationLocationEntries(),
    ]) {
      if (!includeCustomizationPath(entry.path, options)) {
        continue;
      }
      if (!existsSync(entry.path)) {
        continue;
      }
  
      diagnostics().scannedCustomizationRoots += 1;
      recordCustomizationLocation(
        entry.path,
        entry.source === 'user-default' ? 'user-default-root' : 'vscode-setting-root',
      );
      if (statSync(entry.path).isFile()) {
        if (configuredCustomizationFilePredicate(entry.kind, entry.path) && includeCustomizationPath(entry.path, options)) {
          files.set(resolve(entry.path), { base: dirname(entry.path), kind: entry.kind });
        }
        continue;
      }
  
      if (!statSync(entry.path).isDirectory()) {
        continue;
      }
  
      for (const file of listFilesRecursive(
        entry.path,
        (candidate) =>
          configuredCustomizationFilePredicate(entry.kind, candidate) &&
          includeCustomizationPath(candidate, options),
        customizationFileLimit,
        { label: 'customization', maxDepth: 5, maxDirs: 300 },
      )) {
        files.set(resolve(file), { base: entry.path, kind: entry.kind });
      }
    }
  
    return [...files.entries()]
      .map(([file, entry]) => customizationFromFile(file, entry.base, workspace, entry.kind))
      .filter(Boolean);
  }
  
  function localMarkdownPathCandidates(text, bases) {
    const content = String(text ?? '');
    const candidates = new Set();
    const fileTagPattern = /<file>([^<>"']+?\.md)<\/file>/gi;
    const windowsPathPattern = /[a-zA-Z]:[\\/][^<>"'\r\n]+?\.md/gi;
    const posixPathPattern = /\/(?:[^<>"'\r\n]+\/)*[^<>"'\r\n]+?\.md/gi;
  
    for (const pattern of [fileTagPattern, windowsPathPattern, posixPathPattern]) {
      for (const match of content.matchAll(pattern)) {
        candidates.add((match[1] ?? match[0]).trim().replace(/[),.;\]}]+$/g, ''));
      }
    }
  
    const files = [];
    for (const rawCandidate of candidates) {
      const candidate = normalizeLocalPathCandidate(rawCandidate);
      const possiblePaths = isAbsolute(candidate)
        ? [candidate]
        : bases.map((base) => resolve(base, candidate));
  
      for (const possiblePath of possiblePaths) {
        if (
          existsSync(possiblePath) &&
          isMarkdownFile(possiblePath) &&
          looksLikeCopilotCustomizationPath(possiblePath) &&
          (isAbsolute(candidate) || bases.some((base) => containedByBase(possiblePath, base)))
        ) {
          files.push(resolve(possiblePath));
        }
      }
    }
  
    return files;
  }
  
  function normalizeLocalPathCandidate(candidate) {
    let value = String(candidate ?? '').trim().replace(/^["']|["']$/g, '');
    if (/^file:/i.test(value)) {
      try {
        value = fileURLToPath(value);
      } catch {
        value = value.replace(/^file:\/+/i, '');
      }
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw value when VS Code logged a non-URI-encoded path fragment.
    }
    value = value.replace(/\\/g, '/').replace(/[),.;\]}]+$/g, '');
  
    if (platform() === 'win32' && /^\/[a-zA-Z]:\//.test(value)) {
      value = value.slice(1);
    }
  
    return value;
  }
  
  function discoveryFolderPathCandidates(text) {
    const content = String(text ?? '');
    const folders = new Set();
    const absolutePathPattern = /(?:[a-zA-Z]:[\\/][^,\]\r\n]+|\/[a-zA-Z]:[\\/][^,\]\r\n]+|~[\\/][^,\]\r\n]+|\/[^,\]\r\n]+)/g;
  
    for (const match of content.matchAll(absolutePathPattern)) {
      const candidate = normalizeLocalPathCandidate(match[0]);
      if (!candidate) {
        continue;
      }
      const resolved = candidate.startsWith('~/') || candidate.startsWith('~\\')
        ? resolve(homedir(), candidate.slice(2))
        : resolve(candidate);
      if (existsSync(resolved) && statSync(resolved).isDirectory() && looksLikeCustomizationRoot(resolved)) {
        folders.add(resolved);
      }
    }
  
    return [...folders];
  }
  
  function looksLikeCustomizationRoot(folder) {
    const normalized = folder.replace(/\\/g, '/').toLowerCase();
    return (
      normalized.endsWith('/.github/instructions') ||
      normalized.endsWith('/.claude/rules') ||
      normalized.endsWith('/.copilot/instructions') ||
      normalized.endsWith('/.github/skills') ||
      normalized.endsWith('/.claude/skills') ||
      normalized.endsWith('/.agents/skills') ||
      normalized.endsWith('/.copilot/skills') ||
      normalized.includes('/.github/skills/') ||
      normalized.includes('/.claude/skills/') ||
      normalized.includes('/.agents/skills/') ||
      normalized.includes('/.copilot/skills/') ||
      normalized.endsWith('/.github/prompts') ||
      normalized.endsWith('/prompts') ||
      normalized.endsWith('/.copilot/prompts') ||
      normalized.endsWith('/.github/hooks') ||
      normalized.endsWith('/.copilot/hooks') ||
      normalized.endsWith('/.github/agents') ||
      normalized.endsWith('/.claude/agents') ||
      normalized.endsWith('/.copilot/agents')
    );
  }
  
  function customizationsFromDiscoveryFolders(debugRoot, workspace, options = {}) {
    if (!existsSync(debugRoot)) {
      return [];
    }
  
    const folders = new Set();
    for (const sessionDir of listDirs(debugRoot)) {
      const main = readJsonl(join(sessionDir, 'main.jsonl'));
      for (const event of main) {
        const category = String(event.attrs?.category ?? '').toLowerCase();
        const eventName = String(event.name ?? '').toLowerCase();
        if (event.type !== 'discovery' && category !== 'customization' && !eventName.includes('discovery')) {
          continue;
        }
        for (const folder of discoveryFolderPathCandidates(event.attrs?.details)) {
          folders.add(folder);
        }
      }
    }
  
    const files = new Map();
    for (const folder of folders) {
      if (!includeCustomizationPath(folder, options)) {
        continue;
      }
      diagnostics().scannedCustomizationRoots += 1;
      recordCustomizationLocation(folder, 'debug-discovery-root');
      for (const file of listFilesRecursive(
        folder,
        (candidate) =>
          isCustomizationSourceFile(candidate) &&
          looksLikeCopilotCustomizationPath(candidate) &&
          includeCustomizationPath(candidate, options),
        customizationFileLimit,
        { label: 'customization', maxDepth: 5, maxDirs: 300 },
      )) {
        files.set(resolve(file), folder);
      }
    }
  
    return [...files.entries()]
      .map(([file, base]) => customizationFromFile(file, base, workspace))
      .filter(Boolean);
  }
  
  function customizationsFromDebugReferences(debugRoot, bases, workspace, options = {}) {
    if (!existsSync(debugRoot) || !bases.length) {
      return [];
    }
  
    const files = new Map();
  
    for (const sessionDir of listDirs(debugRoot)) {
      for (const file of readdirSync(sessionDir).map((entry) => join(sessionDir, entry))) {
        if (!statSync(file).isFile()) {
          continue;
        }
        const extension = extname(file).toLowerCase();
        if (!['.json', '.txt'].includes(extension)) {
          continue;
        }
        const stats = statSync(file);
        if (stats.size > 2 * 1024 * 1024) {
          continue;
        }
  
        for (const candidate of localMarkdownPathCandidates(readFileSync(file, 'utf8'), bases)) {
          if (!includeCustomizationPath(candidate, options)) {
            continue;
          }
          const base = bases.find((candidateBase) => containedByBase(candidate, candidateBase)) ?? dirname(candidate);
          recordCustomizationLocation(candidate, 'debug-reference');
          files.set(candidate, base);
        }
      }
    }
  
    return [...files.entries()]
      .map(([file, base]) => customizationFromFile(file, base, workspace))
      .filter(Boolean);
  }
  
  function customizationsFromWorkspace(workspaceDir, options = {}) {
    const folder = workspaceFolderPath(workspaceDir);
    if (!folder) {
      return { customizations: [], bases: [] };
    }
  
    const bases = customizationCandidateBases(folder);
    const files = new Map();
  
    for (const base of bases) {
      const directFiles = directCustomizationFiles(base);
      if (directFiles.length) {
        diagnostics().scannedCustomizationRoots += 1;
      }
  
      for (const file of [...directFiles, ...customizationFilesFromKnownRoots(base)]) {
        files.set(resolve(file), base);
      }
    }
  
    const workspace = workspaceName(workspaceDir);
    const knownCustomizations = [...files.entries()]
      .map(([file, base]) => customizationFromFile(file, base, workspace))
      .filter(Boolean);
  
    return {
      bases,
      customizations: [
        ...knownCustomizations,
        ...customizationsFromConfiguredSettings(workspaceDir, folder, workspace, options),
      ],
    };
  }
  
  function recordCustomizationLocation(path, kind) {
    const location = { kind, path: resolve(path) };
    const key = `${location.kind}:${location.path}`;
    if (diagnostics().scannedCustomizationLocations.some((item) => `${item.kind}:${item.path}` === key)) {
      return;
    }
    if (diagnostics().scannedCustomizationLocations.length < 200) {
      diagnostics().scannedCustomizationLocations.push(location);
    }
  }
  
  function isSystemCustomizationPath(file) {
    const normalized = resolve(file).replace(/\\/g, '/').toLowerCase();
    return (
      /(^|\/)\.vscode(?:-insiders)?\/extensions\//.test(normalized) ||
      normalized.includes('/resources/app/extensions/')
    );
  }
  
  function includeCustomizationPath(file, options = {}) {
    if (options.includeSystemCustomizations === true || !isSystemCustomizationPath(file)) {
      return true;
    }
    diagnostics().skippedSystemCustomizations += 1;
    return false;
  }
  

  return {
    customizationsFromDebugReferences,
    customizationsFromDiscoveryFolders,
    customizationsFromWorkspace,
  };
}
