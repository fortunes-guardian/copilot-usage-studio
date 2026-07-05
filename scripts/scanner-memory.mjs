import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, relative, resolve, sep } from 'node:path';

const defaultMemoryFileLimit = 5000;
const defaultMemoryFileSizeLimit = 1024 * 1024;

function decodeMemorySessionId(value) {
  try {
    const decoded = Buffer.from(String(value), 'base64').toString('utf8');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)
      ? decoded
      : '';
  } catch {
    return '';
  }
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
    .replace(/[`*_>~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function normalizeMemoryVirtualPath(value) {
  const path = String(value ?? '').trim().replace(/\\/g, '/');
  return path.startsWith('/') ? path : `/${path}`;
}

function virtualPathForMemory(memory) {
  const segments = String(memory.relativePath ?? '').split(/[\\/]+/).filter(Boolean);

  if (memory.scope === 'session') {
    return normalizeMemoryVirtualPath(`/memories/session/${segments.slice(1).join('/')}`);
  }

  return normalizeMemoryVirtualPath(`/memories/${segments.join('/')}`);
}

export function createMemoryScanner(context = {}) {
  const diagnostics = () => context.diagnostics?.() ?? context.diagnostics ?? { warnings: [] };
  const listFilesRecursive = (...args) => context.listFilesRecursive?.(...args) ?? [];
  const listDebugLogFiles = (...args) => context.listDebugLogFiles?.(...args) ?? [];
  const readJsonl = (...args) => context.readJsonl?.(...args) ?? [];
  const safeJson = (...args) => context.safeJson?.(...args) ?? null;
  const timestampForEvent = (...args) => context.timestampForEvent?.(...args) ?? '';
  const llmTokenFields = (...args) => context.llmTokenFields?.(...args) ?? {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  const normalizeModel = (...args) => context.normalizeModel?.(...args) ?? '';
  const memoryFileLimit = context.memoryFileLimit ?? defaultMemoryFileLimit;
  const memoryFileSizeLimit = context.memoryFileSizeLimit ?? defaultMemoryFileSizeLimit;

  function memoryFromFile(file, root, source, workspace) {
    try {
      const stats = statSync(file);
      if (stats.size > memoryFileSizeLimit) {
        diagnostics().skippedOversizedMemories += 1;
        diagnostics().warnings.push(`${file}: memory skipped because it exceeds 1 MiB.`);
        return null;
      }

      const content = readFileSync(file, 'utf8');
      const relativePath = relative(root, file);
      const segments = relativePath.split(sep).filter(Boolean);
      const sessionId = source === 'workspace' ? decodeMemorySessionId(segments[0]) : '';
      const kind = basename(file).toLowerCase() === 'plan.md' ? 'plan' : 'memory';
      const scope = source === 'global'
        ? 'global'
        : segments[0]?.toLowerCase() === 'repo'
          ? 'repository'
          : sessionId
            ? 'session'
            : 'workspace';

      return {
        id: createHash('sha256').update(resolve(file)).digest('hex').slice(0, 24),
        kind,
        scope,
        title: memoryTitle(content, file),
        excerpt: memoryExcerpt(content),
        content,
        workspace: source === 'global' ? '' : workspace,
        sessionId,
        sourcePath: resolve(file),
        relativePath,
        createdAt: stats.birthtimeMs > 0 ? stats.birthtime.toISOString() : '',
        modifiedAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
        characterCount: content.length,
        lineCount: content ? content.split(/\r?\n/).length : 0,
      };
    } catch (error) {
      diagnostics().skippedUnreadableMemories += 1;
      diagnostics().warnings.push(`${file}: memory skipped: ${error.message}`);
      return null;
    }
  }

  function memoriesFromRoot(root, source, workspace = '') {
    if (!existsSync(root)) {
      return [];
    }

    diagnostics().scannedMemoryRoots += 1;
    const memories = listFilesRecursive(
      root,
      (file) => extname(file).toLowerCase() === '.md',
      memoryFileLimit,
      { label: 'memory', maxDepth: 8, maxDirs: 2500 },
    )
      .map((file) => memoryFromFile(file, root, source, workspace))
      .filter(Boolean);

    diagnostics().importedMemories += memories.length;
    diagnostics().importedPlans += memories.filter((memory) => memory.kind === 'plan').length;
    return memories;
  }

  function memoryRecallsFromDebugLog(sessionDir, workspace = '') {
    const sessionId = basename(sessionDir);
    const recalls = [];

    for (const file of listDebugLogFiles(sessionDir)) {
      const events = readJsonl(file);
      let modelCallNumber = 0;
      const modelCallNumbers = new Map();

      events.forEach((event, index) => {
        if (event.type === 'llm_request') {
          modelCallNumber += 1;
          modelCallNumbers.set(index, modelCallNumber);
        }
      });

      events.forEach((event, index) => {
        if (event.type !== 'tool_call' || event.name !== 'memory') {
          return;
        }

        const args = safeJson(event.attrs?.args) ?? {};
        if (args.command !== 'view' || !args.path) {
          return;
        }

        const nextModelIndex = events.findIndex(
          (candidate, candidateIndex) => candidateIndex > index && candidate.type === 'llm_request',
        );
        const nextModel = nextModelIndex >= 0 ? events[nextModelIndex] : null;
        const tokenFields = nextModel ? llmTokenFields(nextModel) : null;
        const sourceLog = basename(file);

        recalls.push({
          id: createHash('sha256')
            .update(`${resolve(file)}:${index}:${args.path}`)
            .digest('hex')
            .slice(0, 24),
          sessionId,
          workspace,
          virtualPath: normalizeMemoryVirtualPath(args.path),
          timestamp: timestampForEvent(event),
          sourceLog,
          returnedCharacterCount: String(event.attrs?.result ?? '').length,
          ...(nextModel
            ? {
                followingModelCall: {
                  number: modelCallNumbers.get(nextModelIndex) ?? 0,
                  model: normalizeModel(nextModel.attrs?.model),
                  inputTokens: tokenFields.inputTokens,
                  cachedInputTokens: tokenFields.cachedInputTokens,
                  outputTokens: tokenFields.outputTokens,
                },
              }
            : {}),
        });
      });
    }

    return recalls.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  return {
    memoriesFromRoot,
    memoryRecallsFromDebugLog,
  };
}

export function attachMemoryRecalls(memories, sessions) {
  const recalls = sessions.flatMap((session) => session.memoryRecalls ?? []);

  return memories.map((memory) => {
    const virtualPath = virtualPathForMemory(memory);
    const matchingRecalls = recalls.filter((recall) => {
      if (recall.virtualPath !== virtualPath) {
        return false;
      }
      if (memory.scope === 'session') {
        return memory.sessionId === recall.sessionId;
      }
      if (memory.scope === 'repository' || memory.scope === 'workspace') {
        return memory.workspace === recall.workspace;
      }
      return memory.scope === 'global';
    });

    return matchingRecalls.length ? { ...memory, recalls: matchingRecalls } : memory;
  });
}
