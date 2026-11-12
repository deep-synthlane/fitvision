import { createHmac } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { analyticsEvents } from '../db/schema.js';

/** Product funnel events. Anything else is rejected. */
export const ANALYTICS_EVENTS = [
  'onboarding_completed',
  'scan_started',
  'scan_completed',
  'avatar_generated',
  'product_uploaded',
  'product_imported',
  'try_on_started',
  'try_on_completed',
  'try_on_saved',
  'size_recommendation_generated',
  'size_feedback_submitted',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Only coarse, non-sensitive properties: never measurements, photos, URLs, names or emails. */
const ALLOWED_PROPERTIES = new Set(['category', 'source', 'confidence', 'status', 'engine_version', 'provider_source', 'fit_rating', 'chart_quality']);

/**
 * Privacy-conscious analytics. Events are stored with a pseudonymous subject (HMAC of the user id),
 * so they can't be joined back to an account without the server secret and remain anonymous after
 * the account is deleted.
 */
export class Analytics {
  constructor(
    private readonly db: Db,
    private readonly secret: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  subject(userId: string) {
    return createHmac('sha256', this.secret).update(`analytics:${userId}`).digest('hex').slice(0, 32);
  }

  track(name: AnalyticsEvent, userId: string, properties: Record<string, string | number | boolean | null | undefined> = {}) {
    const clean = Object.fromEntries(
      Object.entries(properties).filter((e): e is [string, string | number | boolean] => ALLOWED_PROPERTIES.has(e[0]) && e[1] !== null && e[1] !== undefined),
    );
    // Fire-and-forget: analytics must never break or slow down a user action.
    this.db
      .insert(analyticsEvents)
      .values({ name, subject: this.subject(userId), properties: clean })
      .catch((err: unknown) => this.log.warn({ err, event: name }, 'Analytics event not recorded'));
  }
}
