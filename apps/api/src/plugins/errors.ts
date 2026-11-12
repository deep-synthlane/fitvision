import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiErrorBody } from '@fitvision/shared';
import { AppError } from '../lib/errors.js';
import type { ErrorReporter } from '../observability/errors.js';

export function registerErrorHandling(app: FastifyInstance, reporter: ErrorReporter) {
  app.setNotFoundHandler((_req, reply) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      const body: ApiErrorBody = { error: { code: err.code, message: err.message, fields: err.fields } };
      return reply.status(err.statusCode).send(body);
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      reporter.report(err, { requestId: req.id, route: req.routeOptions.url, userId: req.userId });
      const body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong' } };
      return reply.status(500).send(body);
    }
    // Fastify-level client errors: malformed JSON, payload too large, rate limited, etc.
    const code = status === 429 ? 'RATE_LIMITED' : (err.code ?? 'BAD_REQUEST');
    const body: ApiErrorBody = { error: { code, message: err.message } };
    return reply.status(status).send(body);
  });
}
