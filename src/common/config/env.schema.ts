import { z } from 'zod';

/**
 * Environment schema. Validated once at boot (CLAUDE.md §2 / §4): the process fails fast
 * if any required config is missing or malformed. Add new config here, never read
 * `process.env` ad hoc elsewhere.
 */
const booleanish = z.enum(['true', 'false', '0', '1']).transform((v) => v === 'true' || v === '1');

/**
 * A blank env value (`KEY=` in a .env, or whitespace) means "not set", not "set to empty string".
 * `.optional()` alone only accepts a MISSING key, so a blank line would otherwise fail `.url()` /
 * `.min(1)`. These wrappers coerce blank → undefined first, so leaving an optional field empty in the
 * .env template is equivalent to omitting it.
 */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalUrl = z.preprocess(blank, z.string().url().optional());
const optionalNonEmpty = z.preprocess(blank, z.string().min(1).optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // CORS allowlist for browser clients (the admin dashboard). Comma-separated exact origins;
  // defaults to the Vite dev server. Set the real dashboard origin(s) in non-dev environments.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Postgres
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_SSL: booleanish.default(false),

  // Redis
  REDIS_URL: z.string().url(),

  // AWS / SQS
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  SQS_ENDPOINT: z.string().url().optional(),
  SQS_DEFAULT_QUEUE_URL: z.string().url(),

  // Auth. Access tokens are RS256 JWTs (Impl Spec Module 1). Keys come from Secrets Manager in
  // real environments; if unset, the auth module generates an EPHEMERAL dev/test keypair at boot
  // (tokens won't survive a restart — never rely on this in production). PEM may use literal "\n".
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_KID: z.string().min(1).default('dev'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  // Admin MFA. MANDATORY in production (always enforced regardless of this flag, CLAUDE.md §11).
  // Set to false ONLY in dev/test so engineers can sign in without enrolling an authenticator.
  ADMIN_MFA_REQUIRED: booleanish.default(true),

  // Cache / locks
  CACHE_VERSION: z.string().min(1).default('v1'),

  // Ingestion — GoalServe. The KEY is the only credential and lives in the URL PATH; load from
  // Secrets Manager, never commit/log it. Optional so the app boots without it (the provider
  // throws if used unconfigured). Poll gate keeps cron off in dev/test by default.
  GOALSERVE_KEY: optionalNonEmpty,
  GOALSERVE_BASE_URL: z.string().url().default('http://www.goalserve.com/getfeed'),
  GOALSERVE_POLL_ENABLED: booleanish.default(false),
  // Optional egress proxy for GoalServe traffic ONLY (e.g. a static-IP proxy GoalServe whitelists
  // for live/in-play odds). When unset, GoalServe is called directly. Scoped to the GoalServe
  // fetcher — the rest of the app is unaffected. Example: http://3.151.144.97:8888
  GOALSERVE_PROXY_URL: optionalUrl,
  // In-play (live) odds feed — a SEPARATE GoalServe product (inplay.goalserve.com), IP-whitelisted
  // (no key in URL) and gzipped. The poll is gated by GOALSERVE_INPLAY_ENABLED *and* a configured
  // GOALSERVE_PROXY_URL (the whitelisted egress IP) — without the proxy GoalServe returns 403.
  GOALSERVE_INPLAY_BASE_URL: z.string().url().default('http://inplay.goalserve.com'),
  GOALSERVE_INPLAY_ENABLED: booleanish.default(false),
  // In-play WebSocket (push) — an alternative to the in-play HTTP poll above: a persistent stream of
  // live odds/scores. `GOALSERVE_INPLAY_WS_URL` is the ws(s):// endpoint (auth via GOALSERVE_KEY).
  // Gated by GOALSERVE_INPLAY_WS_ENABLED AND a URL; runs only in the worker process. If updated_ts
  // goes stale (>30s) the consumer suspends all in-play markets per GoalServe's heartbeat rule.
  GOALSERVE_INPLAY_WS_ENABLED: booleanish.default(false),
  GOALSERVE_INPLAY_WS_URL: optionalNonEmpty,
  // Shared secret for verifying inbound GoalServe webhook notifications (HMAC-SHA256 over the raw
  // body). Optional so dev/test can receive unsigned test posts; REQUIRED in production (the webhook
  // rejects unsigned requests when NODE_ENV=production). Comes from Secrets Manager in real envs.
  GOALSERVE_WEBHOOK_SECRET: optionalNonEmpty,

  // Player images (object storage). The GoalServe profile feed inlines each player's headshot as a
  // base64 PNG; when enabled, import decodes it and uploads the bytes to S3, storing only the URL on
  // the player. Off by default so dev/test never reach out to S3. Requires S3_BUCKET + the public base
  // URL (CDN or bucket) when on; reuses the AWS_* creds/region already configured for SQS.
  PLAYER_IMAGES_ENABLED: booleanish.default(false),
  S3_BUCKET: optionalNonEmpty,
  // Public base for stored images (CloudFront domain or the bucket's public URL), no trailing slash.
  // Final URL = `${S3_PUBLIC_BASE_URL}/players/<sha256>.png`.
  S3_PUBLIC_BASE_URL: optionalUrl,
  // Set only for LocalStack / custom S3 endpoints; LEAVE BLANK for real AWS (blank → the SDK uses the
  // real AWS endpoint automatically). A blank line here is treated as unset.
  S3_ENDPOINT: optionalUrl,

  // Outbox relay (§8). Off by default so dev/test don't publish to SQS; enable in the worker fleet.
  OUTBOX_RELAY_ENABLED: booleanish.default(false),
  // Settlement consumer (§8) — polls `settlement.requested` and drives the settlement engine. Off by
  // default; enable in the worker fleet (needs SQS_DEFAULT_QUEUE_URL).
  SETTLEMENT_CONSUMER_ENABLED: booleanish.default(false),

  // Email (Brevo transactional API) — used for auth OTP delivery. Optional so the app boots without
  // a mail provider in dev/test; EmailService logs and relies on the response `debugOtp` when
  // unconfigured, and throws in production. The API key comes from Secrets Manager in real
  // environments (CLAUDE.md §9) — never commit or log it. BREVO_SENDER_EMAIL must be a sender that
  // has been verified in the Brevo dashboard, or the API rejects the send.
  BREVO_API_KEY: optionalNonEmpty,
  BREVO_SENDER_EMAIL: optionalNonEmpty,
  BREVO_SENDER_NAME: z.preprocess(blank, z.string().min(1).default('HRA')),
});

export type Env = z.infer<typeof envSchema>;

/**
 * @nestjs/config `validate` hook. Throws (process exits) on the first invalid value,
 * with a readable list of every problem.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
