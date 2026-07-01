import { validateEnv } from './env.schema';

const baseEnv = {
  DATABASE_URL: 'postgres://dfs:dfs@localhost:5432/dfs',
  REDIS_URL: 'redis://localhost:6379',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  SQS_DEFAULT_QUEUE_URL: 'http://localhost:4566/000000000000/dfs-default',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = validateEnv(baseEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_SSL).toBe(false);
  });

  it('coerces numeric strings', () => {
    const env = validateEnv({ ...baseEnv, PORT: '8080', DATABASE_POOL_MAX: '25' });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(25);
  });

  it('fails fast when a required value is missing', () => {
    const { DATABASE_URL: _omit, ...withoutDb } = baseEnv;
    expect(() => validateEnv(withoutDb)).toThrow(/Invalid environment configuration/);
  });

  it('rejects a too-short JWT secret', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
