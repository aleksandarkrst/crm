/**
 * Starts the built API (dist/main.js) and worker (dist/worker.js) once for all integration tests,
 * in dev auth mode with the log mail driver, and hands the API's URL to the tests. GET /api/dev/mail
 * reads the emails the worker "sent" from STORAGE_DIR. Set API_URL to test an API that is
 * already running instead (then its worker must be running too, and the tests that look at files
 * on disk need STORAGE_DIR set to that API's storage folder).
 *
 * The database must exist and be migrated (`npm run db:migrate`). The API connects with
 * DATABASE_URL, which must be the non-owner runtime role so row-level security applies.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { DEFAULT_DATABASE_URL } from './env';

declare module 'vitest' {
  export interface ProvidedContext {
    apiUrl: string;
    databaseUrl: string;
    /** Where the API keeps files; empty when unknown (API_URL without STORAGE_DIR). */
    storageDir: string;
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
    project.provide('storageDir', process.env.STORAGE_DIR ? resolve(process.env.STORAGE_DIR) : '');
    return;
  }

  const backendDir = project.config.root;
  const main = join(backendDir, 'dist', 'main.js');
  const workerMain = join(backendDir, 'dist', 'worker.js');
  if (!existsSync(main)) throw new Error(`${main} not found. Run "npm run build" first (npm run test:integration does).`);

  // The same folder a dev API and worker started from this checkout use (STORAGE_DIR, else the one
  // in .env, else ./storage): if a dev worker on the same database picks up a generation job, its
  // file still lands where this API serves it from.
  const storageDir = resolve(backendDir, process.env.STORAGE_DIR || dotEnv(backendDir).STORAGE_DIR || './storage');
  project.provide('storageDir', storageDir);
  const port = process.env.INTEGRATION_API_PORT || '3101';
  const env = {
    ...process.env,
    NODE_ENV: 'test' as const,
    PORT: port,
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    DATABASE_URL: databaseUrl,
    AUTH_MODE: 'dev',
    DEV_JWT_SECRET: process.env.DEV_JWT_SECRET || 'integration-tests-secret-at-least-32-characters',
    CORS_ORIGINS: '',
    STORAGE_DIR: storageDir,
    APP_URL: 'http://app.example.test',
    MAIL_DRIVER: 'log',
    // Fast retries, so a failing send reaches "failed" within a test.
    MAIL_RETRY_LIMIT: '1',
    MAIL_RETRY_DELAY_SECONDS: '1',
  };
  let output = '';
  const start = (file: string, name: string) => {
    const child = spawn(process.execPath, [file], { cwd: backendDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk: Buffer) => {
      output = (output + `[${name}] ` + chunk.toString()).slice(-20_000);
    };
    child.stdout!.on('data', collect);
    child.stderr!.on('data', collect);
    return child;
  };
  const child = start(main, 'api');
  // The worker runs the document generation (CD-13) and email (CD-7, CD-16) jobs.
  const worker = start(workerMain, 'worker');

  const stop = async (proc: ChildProcess) => {
    if (proc.exitCode !== null) return;
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
  };

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

/** backend/.env as key/values, without loading it into process.env (it would change DATABASE_URL). */
function dotEnv(backendDir: string): Record<string, string | undefined> {
  const file = join(backendDir, '.env');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
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
