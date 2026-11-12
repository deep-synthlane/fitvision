import type { FastifyBaseLogger } from 'fastify';

export interface ErrorContext {
  requestId?: string;
  route?: string;
  userId?: string | null;
  job?: string;
}

/**
 * Error tracking hook. The default reporter writes a structured `error_report` log line (with the
 * request id) that a log pipeline can alert on. A vendor SDK (e.g. Sentry) can be plugged in by
 * implementing this interface — none is bundled.
 */
export interface ErrorReporter {
  report(err: unknown, context: ErrorContext): void;
}

export const logErrorReporter = (log: FastifyBaseLogger): ErrorReporter => ({
  report(err, context) {
    const e = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { message: String(err) };
    log.error({ error_report: true, err: e, ...context }, 'Unhandled error');
  },
});
