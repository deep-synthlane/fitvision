import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { z } from 'zod';
import {
  REQUIRED_SCAN_VIEWS,
  SCAN_VIEWS,
  deriveScanSource,
  scanSubmissionSchema,
  type BodyScan,
  type ScanListResponse,
  type ScanResponse,
  type ScanView,
} from '@fitvision/shared';
import type { Db } from '../../db/client.js';
import { bodyMeasurements, bodyScans, type BodyScanRow } from '../../db/schema.js';
import { AppError, parseInput } from '../../lib/errors.js';
import type { SessionTools } from '../../plugins/auth.js';
import type { Storage } from '../../storage/index.js';
import { toMeasurements } from '../measurements/routes.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const SCAN_UPLOAD_LIMITS = {
  fileSize: MAX_IMAGE_BYTES,
  files: SCAN_VIEWS.length,
  fields: 1,
  fieldSize: 64 * 1024,
  parts: SCAN_VIEWS.length + 1,
};

const IMAGE_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', matches: (b: Buffer) => b.subarray(0, 4).toString('hex') === '89504e47' },
  {
    ext: 'webp',
    mime: 'image/webp',
    matches: (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
] as const;

/** Detects the image type from its bytes; the client-declared content type is not trusted. */
function sniffImage(data: Buffer) {
  return IMAGE_TYPES.find((t) => t.matches(data)) ?? null;
}

/**
 * Decodes and re-encodes a scan photo as JPEG: applies EXIF orientation and drops all metadata
 * (EXIF including GPS location, XMP, ICC), and rejects files that only look like images.
 */
async function reencodeScanPhoto(data: Buffer, view: ScanView): Promise<Buffer> {
  try {
    return await sharp(data, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch {
    throw new AppError(400, 'BAD_IMAGE', `The ${view} photo could not be read`, { [view]: 'Unreadable image' });
  }
}

const mimeForKey = (key: string) => IMAGE_TYPES.find((t) => key.endsWith(`.${t.ext}`))?.mime ?? 'application/octet-stream';

const idParams = z.object({ id: z.uuid() });
const imageParams = idParams.extend({ view: z.enum(SCAN_VIEWS) });

function imagePath(row: BodyScanRow, view: ScanView): string | null {
  return view === 'front' ? row.frontImagePath : view === 'side' ? row.sideImagePath : row.backImagePath;
}

function toScan(row: BodyScanRow): BodyScan {
  const views = SCAN_VIEWS.filter((v) => imagePath(row, v));
  return {
    id: row.id,
    status: row.status as BodyScan['status'],
    views,
    imageUrls: Object.fromEntries(views.map((v) => [v, `/api/scans/${row.id}/images/${v}`])),
    processingVersion: row.processingVersion,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** Reads the multipart upload: one image per view plus a `data` JSON field. */
async function readUpload(req: FastifyRequest) {
  const images: Partial<Record<ScanView, { data: Buffer; ext: string }>> = {};
  let json: unknown;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const view = SCAN_VIEWS.find((v) => v === part.fieldname);
      if (!view || images[view]) throw new AppError(400, 'BAD_UPLOAD', `Unexpected file field "${part.fieldname}"`);
      const data = await part.toBuffer();
      const type = sniffImage(data);
      if (!type) throw new AppError(400, 'BAD_IMAGE', `The ${view} photo must be a JPEG, PNG or WebP image`, { [view]: 'Unsupported image' });
      images[view] = { data: await reencodeScanPhoto(data, view), ext: 'jpg' };
    } else if (part.fieldname === 'data' && typeof part.value === 'string') {
      try {
        json = JSON.parse(part.value);
      } catch {
        throw new AppError(400, 'BAD_UPLOAD', 'The data field must be valid JSON');
      }
    } else {
      throw new AppError(400, 'BAD_UPLOAD', `Unexpected field "${part.fieldname}"`);
    }
  }
  const missing = REQUIRED_SCAN_VIEWS.filter((v) => !images[v]);
  if (missing.length > 0) {
    throw new AppError(
      400,
      'MISSING_IMAGES',
      `Front and side photos are required`,
      Object.fromEntries(missing.map((v) => [v, 'Photo required'])),
    );
  }
  return { images, submission: parseInput(scanSubmissionSchema, json) };
}

export function scanRoutes(db: Db, storage: Storage, session: SessionTools) {
  async function findOwnScan(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(bodyScans)
      .where(and(eq(bodyScans.id, id), eq(bodyScans.userId, userId)))
      .limit(1);
    // Someone else's scan is reported as missing, so scan ids can't be probed.
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Scan not found');
    return row;
  }

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', session.requireAuth);

    app.get('/', async (req): Promise<ScanListResponse> => {
      const rows = await db
        .select()
        .from(bodyScans)
        .where(eq(bodyScans.userId, req.userId!))
        .orderBy(desc(bodyScans.createdAt))
        .limit(20);
      return { scans: rows.map(toScan) };
    });

    /** Saves the photos, the scan metadata and the confirmed measurements in one step. */
    app.post('/', async (req, reply): Promise<ScanResponse> => {
      if (!req.isMultipart()) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected multipart/form-data');
      const userId = req.userId!;
      const { images, submission } = await readUpload(req);
      const scanId = randomUUID();

      const keys: Partial<Record<ScanView, string>> = {};
      try {
        for (const view of SCAN_VIEWS) {
          const image = images[view];
          if (!image) continue;
          const key = `scans/${userId}/${scanId}/${view}.${image.ext}`;
          await storage.put(key, image.data);
          keys[view] = key;
        }

        const source = deriveScanSource(submission.scan.estimates, submission.measurements);
        const now = new Date();
        const { scan, measurement } = await db.transaction(async (tx) => {
          const [scan] = await tx
            .insert(bodyScans)
            .values({
              id: scanId,
              userId,
              status: 'completed',
              frontImagePath: keys.front!,
              sideImagePath: keys.side!,
              backImagePath: keys.back ?? null,
              processingVersion: submission.scan.processingVersion,
              completedAt: now,
            })
            .returning();
          const [measurement] = await tx
            .insert(bodyMeasurements)
            .values({ userId, ...submission.measurements, source, scanId, scanEstimates: submission.scan })
            .returning();
          return { scan: scan!, measurement: measurement! };
        });

        req.server.analytics.track('scan_completed', userId, { source });
        reply.status(201);
        return { scan: toScan(scan), measurements: toMeasurements(measurement) };
      } catch (err) {
        await Promise.all(Object.values(keys).map((key) => storage.delete(key)));
        throw err;
      }
    });

    app.get('/:id', async (req): Promise<ScanResponse> => {
      const params = idParams.safeParse(req.params);
      if (!params.success) throw new AppError(404, 'NOT_FOUND', 'Scan not found');
      const scan = await findOwnScan(req.userId!, params.data.id);
      const [measurement] = await db
        .select()
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.scanId, scan.id))
        .orderBy(desc(bodyMeasurements.createdAt))
        .limit(1);
      return { scan: toScan(scan), measurements: measurement ? toMeasurements(measurement) : null };
    });

    app.get('/:id/images/:view', async (req, reply) => {
      const params = imageParams.safeParse(req.params);
      if (!params.success) throw new AppError(404, 'NOT_FOUND', 'Image not found');
      const scan = await findOwnScan(req.userId!, params.data.id);
      const key = imagePath(scan, params.data.view);
      const data = key ? await storage.get(key) : null;
      if (!key || !data) throw new AppError(404, 'NOT_FOUND', 'Image not found');
      return reply
        .header('content-type', mimeForKey(key))
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', 'inline')
        .send(data);
    });

    /** Deletes the photos and scan record. Measurements derived from it are kept (unlinked). */
    app.delete('/:id', async (req, reply) => {
      const params = idParams.safeParse(req.params);
      if (!params.success) throw new AppError(404, 'NOT_FOUND', 'Scan not found');
      const scan = await findOwnScan(req.userId!, params.data.id);
      await db.delete(bodyScans).where(eq(bodyScans.id, scan.id));
      await Promise.all(SCAN_VIEWS.map((v) => imagePath(scan, v)).filter((k): k is string => Boolean(k)).map((k) => storage.delete(k)));
      return reply.status(204).send();
    });
  };
}
