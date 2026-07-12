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
    'Local-first Copilot usage, memory, and customization visibility inside VS Code.',
    '',
    '## Install',
    '',
    '[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=fortunes-guardian.copilot-usage-studio-vscode).',
    '',
    `The npm/browser host remains available for development and fallback testing with \`npx ${packageJson.name}@${version}\`.`,
    '',
    '## Highlights',
    '',
    ...(changes.length ? changes : ['- No curated changelog entries found for this release.']),
    '',
    '## Verification',
    '',
    '- npm and VS Code extension versions match the tag.',
    '- npm package and Marketplace extension are published from the tagged source.',
    '- The exact Marketplace VSIX is attached to this GitHub Release.',
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
