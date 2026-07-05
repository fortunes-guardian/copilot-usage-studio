import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseNotesGitArgs } from './generate-release-notes.mjs';

test('release-note git commands use normalized safe.directory paths', () => {
  const args = releaseNotesGitArgs(
    ['log', '--pretty=format:- `%h` %s', 'v0.1.0..v0.2.0'],
    'C:\\Users\\admin\\repo',
  );

  assert.deepEqual(args, [
    '-c',
    'safe.directory=C:/Users/admin/repo',
    'log',
    '--pretty=format:- `%h` %s',
    'v0.1.0..v0.2.0',
  ]);
});
