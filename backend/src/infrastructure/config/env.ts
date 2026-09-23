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

    STORAGE_DIR: z.string().default('./storage'),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'AUTH_MODE=dev is not allowed in production' });
    }
    if (env.AUTH_MODE === 'dev' && !env.DEV_JWT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['DEV_JWT_SECRET'], message: 'required when AUTH_MODE=dev' });
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
