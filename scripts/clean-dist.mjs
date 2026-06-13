import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const outputDir = resolve('dist');
if (basename(outputDir) !== 'dist' || dirname(outputDir) !== resolve('.')) {
  throw new Error(`Refusing to clean unexpected output path: ${outputDir}`);
}

rmSync(outputDir, { recursive: true, force: true });
