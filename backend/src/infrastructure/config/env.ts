import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Runtime connection: a non-owner role, so PostgreSQL row-level security applies.
    DATABASE_URL: z.string().url(),
    // Owner connection: used only by migrations.
    MIGRATION_DATABASE_URL: z.string().url().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    // "dev" issues local tokens from /api/auth/dev-login. "oidc" verifies tokens from an
    // external identity provider (Auth0, Clerk, Zitadel, Keycloak, Entra ID, ...).
    AUTH_MODE: z.enum(['dev', 'oidc']).default('dev'),
    DEV_JWT_SECRET: z.string().min(32).optional(),
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_AUDIENCE: z.string().optional(),

    // Comma-separated. Leave empty when the frontend and API share one hostname.
    CORS_ORIGINS: z.string().default(''),

    // API rate limits (CD-18). Only the test suites turn them off: they sign in far more often
    // from one address than any person would.
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    // Error tracking (CD-8): the backend project's Sentry DSN. Unset or empty = off.
    SENTRY_DSN: z.union([z.literal(''), z.url()]).optional(),
    // Which deployment the errors come from (production, staging). Defaults to NODE_ENV.
    SENTRY_ENVIRONMENT: z.string().optional(),
    // The deployed commit (set by scripts/deploy.sh), sent with each error as its release.
    APP_VERSION: z.string().optional(),

    STORAGE_DIR: z.string().default('./storage'),

    // Public address of the web app, for links in emails (invitations, digests). Never taken
    // from the request. Required in production.
    APP_URL: z.url().default('http://localhost:5173'),
    // Encrypts invite links at rest so they can be emailed again (CD-7). At least 32 characters;
    // required in production. Development falls back to DEV_JWT_SECRET.
    APP_SECRET: z.string().min(32).optional(),

    // Email (CD-7, CD-16). "log" writes messages to the log (and, outside production, to an outbox
    // file the dev-only /api/dev/mail endpoint reads). "smtp" sends through any SMTP provider.
    MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    SMTP_URL: z.string().optional(), // e.g. smtps://user:password@smtp.postmarkapp.com:465
    MAIL_FROM: z.string().default('Cadence <no-reply@localhost>'),
    // pg-boss retries of a failed send, with exponential backoff from the delay.
    MAIL_RETRY_LIMIT: z.coerce.number().int().min(0).max(20).default(4),
    MAIL_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'AUTH_MODE=dev is not allowed in production' });
    }
    if (env.AUTH_MODE === 'dev' && !env.DEV_JWT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['DEV_JWT_SECRET'], message: 'required when AUTH_MODE=dev' });
    }
    if (env.NODE_ENV === 'production' && !env.APP_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['APP_SECRET'], message: 'required in production (openssl rand -hex 32)' });
    }
    if (env.NODE_ENV === 'production' && !process.env.APP_URL) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'required in production (e.g. https://app.yourdomain.com)' });
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'required when MAIL_DRIVER=smtp' });
    }
    if (env.AUTH_MODE === 'oidc' && (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE)) {
      ctx.addIssue({ code: 'custom', path: ['OIDC_ISSUER'], message: 'OIDC_ISSUER and OIDC_AUDIENCE are required when AUTH_MODE=oidc' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  if (process.env.NODE_ENV !== 'production') {
    try {
      process.loadEnvFile();
    } catch {
      // no .env file — rely on the real environment
    }
  }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}
