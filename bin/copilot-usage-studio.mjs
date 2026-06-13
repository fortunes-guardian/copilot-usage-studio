#!/usr/bin/env node

import { runCli } from '../lib/cli.mjs';

try {
  await runCli();
} catch (error) {
  console.error(`Copilot Usage Studio: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
