import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import {
  bodyMeasurementsInputSchema,
  type BodyMeasurements,
  type CurrentMeasurementsResponse,
  type MeasurementHistoryResponse,
} from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { bodyMeasurements, type BodyMeasurementsRow } from '../../db/schema.js';
import { parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';

const HISTORY_LIMIT = 20;

export function toMeasurements(row: BodyMeasurementsRow): BodyMeasurements {
  return {
    id: row.id,
    heightCm: row.heightCm,
    chestCm: row.chestCm,
    waistCm: row.waistCm,
    hipsCm: row.hipsCm,
    shoulderCm: row.shoulderCm,
    inseamCm: row.inseamCm,
    armLengthCm: row.armLengthCm,
    source: row.source as BodyMeasurements['source'],
    scanId: row.scanId,
    scanEstimates: row.scanEstimates,
    createdAt: row.createdAt.toISOString(),
  };
}

export function measurementRoutes(db: Db, session: SessionTools) {
  const latestFirst = (userId: string) =>
    db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(desc(bodyMeasurements.createdAt), desc(bodyMeasurements.id));

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/current', async (req): Promise<CurrentMeasurementsResponse> => {
      const [row] = await latestFirst(req.userId!).limit(1);
      return { measurements: row ? toMeasurements(row) : null };
    });

    app.get('/', async (req): Promise<MeasurementHistoryResponse> => {
      const rows = await latestFirst(req.userId!).limit(HISTORY_LIMIT);
      return { history: rows.map(toMeasurements) };
    });

    /** Saves a new measurement set; earlier sets are kept as history. */
    app.post('/', async (req, reply): Promise<CurrentMeasurementsResponse> => {
      const input = parseInput(bodyMeasurementsInputSchema, req.body);
      const [row] = await db
        .insert(bodyMeasurements)
        .values({ userId: req.userId!, ...input })
        .returning();
      reply.status(201);
      return { measurements: toMeasurements(row!) };
    });
  };
}
