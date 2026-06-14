import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const packArgs = ['pack', '--dry-run', '--ignore-scripts', '--json'];
const result = spawnSync(
  process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm',
  process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${packArgs.join(' ')}`]
    : packArgs,
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: resolve('tmp', 'npm-cache'),
    },
  },
);

if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || 'npm pack --dry-run failed.');
}

const reports = JSON.parse(result.stdout);
const report = reports[0];
const files = report.files.map((entry) => entry.path.replaceAll('\\', '/'));
const forbidden = files.filter((file) =>
  file.endsWith('/sessions.json') ||
  file === 'sessions.json' ||
  file.startsWith('public/data/') ||
  file.startsWith('tmp/') ||
  file.includes('vscode-schema-baseline'),
);

if (forbidden.length) {
  throw new Error(`Package contains forbidden local/generated data:\n${forbidden.join('\n')}`);
}

const required = [
  'CHANGELOG.md',
  'bin/copilot-usage-studio.mjs',
  'data/github-copilot-pricing.json',
  'dist/copilot-usage-studio/browser/usage-studio.svg',
  'dist/copilot-usage-studio/browser/index.html',
  'lib/cli.mjs',
  'lib/local-runtime.mjs',
  'lib/scanner-api.mjs',
  'scripts/pricing-utils.mjs',
  'scripts/scan-vscode-sessions.mjs',
];
const missing = required.filter((file) => !files.includes(file));
if (missing.length) {
  throw new Error(`Package is missing required runtime files:\n${missing.join('\n')}`);
}

console.log(
  `Package verification passed: ${report.name}@${report.version}, ${files.length} files, ${report.size} bytes.`,
);
