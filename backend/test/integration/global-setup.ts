/**
 * Starts the built API (dist/main.js) and worker (dist/worker.js) once for all integration tests,
 * in dev auth mode with the log mail driver, and hands the API's URL to the tests. Both share a
 * fresh STORAGE_DIR, so GET /api/dev/mail sees the emails the worker "sent". Set API_URL to test
 * an API (and worker) that are already running instead.
 *
 * The database must exist and be migrated (`npm run db:migrate`). The API connects with
 * DATABASE_URL, which must be the non-owner runtime role so row-level security applies.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { DEFAULT_DATABASE_URL } from './env';

declare module 'vitest' {
  export interface ProvidedContext {
    apiUrl: string;
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  await assertRuntimeRole(databaseUrl);
  project.provide('databaseUrl', databaseUrl);

  if (process.env.API_URL) {
    const apiUrl = process.env.API_URL.replace(/\/$/, '');
    await waitForReady(apiUrl, null);
    project.provide('apiUrl', apiUrl);
    return;
  }

  const backendDir = project.config.root;
  const main = join(backendDir, 'dist', 'main.js');
  if (!existsSync(main)) throw new Error(`${main} not found. Run "npm run build" first (npm run test:integration does).`);

  const port = process.env.INTEGRATION_API_PORT || '3101';
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: port,
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    DATABASE_URL: databaseUrl,
    AUTH_MODE: 'dev',
    DEV_JWT_SECRET: process.env.DEV_JWT_SECRET || 'integration-tests-secret-at-least-32-characters',
    CORS_ORIGINS: '',
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'crm-integration-')),
    APP_URL: 'http://app.example.test',
    MAIL_DRIVER: 'log',
    // Fast retries, so a failing send reaches "failed" within a test.
    MAIL_RETRY_LIMIT: '1',
    MAIL_RETRY_DELAY_SECONDS: '1',
  };
  let output = '';
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-20_000);
  };
  const child = spawn(process.execPath, [main], { cwd: backendDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', collect);
  child.stderr!.on('data', collect);
  const worker = spawn(process.execPath, [join(backendDir, 'dist', 'worker.js')], { cwd: backendDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout!.on('data', collect);
  worker.stderr!.on('data', collect);

  const apiUrl = `http://localhost:${port}`;
  try {
    await waitForReady(apiUrl, child);
  } catch (err) {
    child.kill();
    worker.kill();
    throw new Error(`${(err as Error).message}\n--- API output ---\n${output}`, { cause: err });
  }
  project.provide('apiUrl', apiUrl);

  return async () => {
    await Promise.all([stop(child), stop(worker)]);
  };
}

async function stop(proc: ChildProcess) {
  if (proc.exitCode !== null) return;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (proc.exitCode === null) proc.kill('SIGKILL');
}

/** Fails fast when DATABASE_URL points at a role that would bypass row-level security. */
async function assertRuntimeRole(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`Cannot connect to the test database (${redact(databaseUrl)}): ${(err as Error).message}`, { cause: err });
  }
  try {
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; migrated: boolean }>(
      `select rolsuper, rolbypassrls, to_regclass('public.deals') is not null as migrated from pg_roles where rolname = current_user`,
    );
    const role = rows[0]!;
    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(`DATABASE_URL (${redact(databaseUrl)}) must be the non-owner runtime role: this role bypasses row-level security.`);
    }
    if (!role.migrated) throw new Error(`The database at ${redact(databaseUrl)} has no tables. Run "npm run db:migrate" first.`);
  } finally {
    await client.end();
  }
}

const redact = (url: string) => url.replace(/:[^:@/]*@/, ':***@');

async function waitForReady(apiUrl: string, child: ChildProcess | null) {
  const deadline = Date.now() + 45_000;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`The API exited with code ${child.exitCode} before it was ready`);
    try {
      const res = await fetch(`${apiUrl}/api/health/ready`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`The API at ${apiUrl} did not become ready: ${lastError}`);
}
