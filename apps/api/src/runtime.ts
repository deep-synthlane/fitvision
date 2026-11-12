import type { FastifyServerOptions } from 'fastify';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { LocalDiskStorage, S3Storage, type Storage } from './storage/index.js';

export function createStorage(config: AppConfig): Storage {
  const s = config.storage;
  return s.driver === 's3'
    ? new S3Storage({
        bucket: s.bucket,
        region: s.region,
        endpoint: s.endpoint,
        accessKeyId: s.accessKeyId,
        secretAccessKey: s.secretAccessKey,
        keyPrefix: s.keyPrefix,
        forcePathStyle: s.forcePathStyle,
      })
    : new LocalDiskStorage(s.dir);
}

/** Structured JSON logs; secrets and credentials are redacted, bodies (and images) are never logged. */
export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    base: { service: 'fitvision-api', env: config.appEnv },
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash', '*.token', '*.apiToken'],
      censor: '[redacted]',
    },
  };
}

/** Loads configuration for an entry point; unsafe or invalid settings print a clear list and exit. */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): AppConfig {
  try {
    return loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
