import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const E2E_ENV = resolve(ROOT, '.env.e2e');

function loadDotEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function sh(cmd: string, env: NodeJS.ProcessEnv): void {
  execSync(cmd, { cwd: ROOT, env, stdio: 'inherit', timeout: 300_000 });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 403) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function globalSetup(): Promise<void> {
  const fileEnv = loadDotEnv(E2E_ENV);
  const DATABASE_URL =
    process.env.E2E_DATABASE_URL ??
    fileEnv.DATABASE_URL ??
    'postgresql://tmg:change_me_postgres@localhost:5432/chroniclex_e2e?schema=public';

  // eslint-disable-next-line no-console
  console.log('[e2e] docker compose up -d postgres redis minio');
  sh('docker compose up -d postgres redis minio', process.env);

  // eslint-disable-next-line no-console
  console.log('[e2e] waiting for minio health');
  await waitFor('http://localhost:9000/minio/health/live', 120_000);

  const dbEnv = { ...process.env, DATABASE_URL };
  // eslint-disable-next-line no-console
  console.log('[e2e] prisma migrate reset --force (chroniclex_e2e)');
  sh('pnpm --filter @chroniclex/api exec prisma migrate reset --force', dbEnv);

  // eslint-disable-next-line no-console
  console.log('[e2e] seeding (base + E2E users)');
  sh('pnpm --filter @chroniclex/api exec prisma db seed', {
    ...dbEnv,
    SEED_E2E_USERS: 'true',
  });
  // eslint-disable-next-line no-console
  console.log('[e2e] global setup done');
}

export default globalSetup;
