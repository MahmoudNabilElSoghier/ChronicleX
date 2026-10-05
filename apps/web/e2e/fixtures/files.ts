import { copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = __dirname;

/** Copy a fixture to a temp path under the desired filename. Returns the path. */
export function fixtureAs(dir: string, filename: string, source = 'sample.pdf'): string {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, filename);
  copyFileSync(join(FIXTURES, source), dest);
  return dest;
}

export function e2eTmpDir(): string {
  const dir = join(tmpdir(), 'chroniclex-e2e');
  mkdirSync(dir, { recursive: true });
  return dir;
}
