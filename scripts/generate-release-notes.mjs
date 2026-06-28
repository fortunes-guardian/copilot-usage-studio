import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (isMainModule()) {
  main();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const tag = args.tag ?? `v${packageJson.version}`;
  const version = tag.replace(/^v/, '');
  const outFile = args.out ? resolve(args.out) : null;
  const previousTag = findPreviousTag(tag);
  const commits = listCommits(previousTag, tag);
  const changes = changelogEntries(version);

  const notes = [
    `# Copilot Usage Studio ${tag}`,
    '',
    'Local-first Copilot usage visibility for VS Code. This release includes the npm app and, when built by GitHub Actions, a VS Code extension VSIX attached to the GitHub Release.',
    '',
    '## Install',
    '',
    '```bash',
    `npx ${packageJson.name}@${version}`,
    '```',
    '',
    'For the VS Code extension preview, download the `.vsix` asset from this GitHub Release and install it with:',
    '',
    '```bash',
    'code --install-extension copilot-usage-studio-vscode-' + version + '.vsix --force',
    '```',
    '',
    '## Highlights',
    '',
    ...(changes.length ? changes : ['- No curated changelog entries found for this release.']),
    '',
    '## Verification',
    '',
    '- npm package is built from the tagged source.',
    '- VS Code extension VSIX is built from the same tagged source.',
    '- CI runs script tests, Angular tests, production build, npm package verification, and VSIX verification.',
    '',
    '## Commit Audit Trail',
    '',
    ...(commits.length ? commits : ['- No commits found for this tag range.']),
    '',
    '## Notes',
    '',
    '- Independent open-source developer tool. Not affiliated with or endorsed by GitHub or Microsoft.',
    '- The app reads local VS Code Copilot data and keeps generated data on the developer machine.',
    '',
  ].join('\n');

  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, notes);
    console.log(`Release notes written to ${outFile}`);
  } else {
    process.stdout.write(notes);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--tag') {
      parsed.tag = values[index + 1];
      index += 1;
    } else if (value === '--out') {
      parsed.out = values[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function findPreviousTag(currentTag) {
  try {
    return git(['describe', '--tags', '--abbrev=0', `${currentTag}^`]);
  } catch {
    return '';
  }
}

function listCommits(previousTag, currentTag) {
  const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
  try {
    return git(['log', '--pretty=format:- `%h` %s', range])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function changelogEntries(version) {
  const text = readFileSync('CHANGELOG.md', 'utf8');
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionMatch = text.match(
    new RegExp(`## ${escapedVersion}(?:\\s+-\\s+[^\\n]+)?\\s*(?<body>[\\s\\S]*?)(?:\\n##\\s|$)`),
  );
  const unreleasedMatch = text.match(/## Unreleased\s*(?<body>[\s\S]*?)(?:\n##\s|$)/);
  const body = versionMatch?.groups?.body ?? unreleasedMatch?.groups?.body ?? '';
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
}

function git(args) {
  return execFileSync('git', releaseNotesGitArgs(args), { encoding: 'utf8' }).trim();
}

export function releaseNotesGitArgs(args, cwd = process.cwd()) {
  const safeDirectory = cwd.replaceAll('\\', '/');
  return ['-c', `safe.directory=${safeDirectory}`, ...args];
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}
