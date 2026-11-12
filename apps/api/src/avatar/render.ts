import sharp from 'sharp';
import type { AvatarRenderFraming } from '@fitvision/shared';

/**
 * Front view of an avatar as a clean 2D image, for use as the person input of a try-on.
 *
 * A small deterministic software rasteriser (orthographic camera, z-buffer, smooth shading, 2×
 * supersampling) over the avatar's stored GLB, so it runs on the server without a GPU and always
 * shows exactly the model the user saw. The mannequin stands straight with its arms slightly
 * away from the torso (the parametric model's built-in pose).
 */
export const AVATAR_RENDERER_VERSION = 'avatar-front-render-1';

export const AVATAR_RENDER_SIZE = { width: 768, height: 1024 } as const;
const SUPERSAMPLE = 2;
/** Neutral, plain studio background. */
const BACKGROUND = [242, 242, 240] as const;
/** Light, neutral mannequin colour (linear 0–1). */
const BASE = [0.83, 0.81, 0.79] as const;
/** Visible fraction of the body height, measured down from the top of the head. */
const FRAMING_SPAN: Record<AvatarRenderFraming, number> = { upper_body: 0.68, full_body: 1 };
const MARGIN = 0.04;

export interface GlbTriangleMesh {
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array;
}

/** Reads the first mesh primitive of a GLB (as written by `writeGlb`). */
export function readGlbMesh(glb: Buffer): GlbTriangleMesh {
  if (glb.length < 20 || glb.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { bufferView: number; count: number; componentType: number; byteOffset?: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const binStart = 20 + jsonLength + 8;
  const view = (accessorIndex: number) => {
    const acc = gltf.accessors[accessorIndex]!;
    const bv = gltf.bufferViews[acc.bufferView]!;
    const offset = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    // Copy so the typed array is aligned regardless of the Buffer's pool offset.
    const bytes = new Uint8Array(glb.subarray(offset, offset + bv.byteLength));
    return { acc, buffer: bytes.buffer };
  };
  const prim = gltf.meshes[0]!.primitives[0]!;
  const pos = view(prim.attributes.POSITION!);
  const idx = view(prim.indices);
  if (idx.acc.componentType !== 5125) throw new Error('Expected 32-bit indices');
  const normals = prim.attributes.NORMAL === undefined ? null : new Float32Array(view(prim.attributes.NORMAL).buffer, 0, view(prim.attributes.NORMAL).acc.count * 3);
  return { positions: new Float32Array(pos.buffer, 0, pos.acc.count * 3), normals, indices: new Uint32Array(idx.buffer, 0, idx.acc.count) };
}

const norm = (v: [number, number, number]) => {
  const l = Math.hypot(...v);
  return v.map((c) => c / l) as [number, number, number];
};
const KEY = norm([0.35, 0.55, 1]);
const FILL = norm([-0.6, 0.15, 0.8]);

function shade(nx: number, ny: number, nz: number): number {
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const ambient = 0.38 + 0.12 * ny;
  const key = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]) * 0.62;
  const fill = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]) * 0.2;
  return Math.min(1.1, ambient + key + fill);
}

/** Renders the avatar facing the camera; returns a PNG of AVATAR_RENDER_SIZE. */
export async function renderAvatarFront(glb: Buffer, framing: AvatarRenderFraming): Promise<Buffer> {
  const { positions: P, normals: N, indices } = readGlbMesh(glb);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    minX = Math.min(minX, P[i]!);
    maxX = Math.max(maxX, P[i]!);
    minY = Math.min(minY, P[i + 1]!);
    maxY = Math.max(maxY, P[i + 1]!);
  }
  const bodyHeight = maxY - minY;
  const top = maxY + MARGIN * bodyHeight;
  const bottom = framing === 'full_body' ? minY - MARGIN * bodyHeight : maxY - FRAMING_SPAN[framing] * bodyHeight;

  const W = AVATAR_RENDER_SIZE.width * SUPERSAMPLE;
  const H = AVATAR_RENDER_SIZE.height * SUPERSAMPLE;
  const scale = Math.min(H / (top - bottom), W / ((maxX - minX) * (1 + 2 * MARGIN)));
  const offsetX = W / 2 - ((minX + maxX) / 2) * scale;
  const sx = (x: number) => offsetX + x * scale;
  const sy = (y: number) => (top - y) * scale;

  const depth = new Float32Array(W * H).fill(-Infinity);
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) rgb.set(BACKGROUND, i * 3);

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ax = sx(P[a]!), ay = sy(P[a + 1]!), bx = sx(P[b]!), by = sy(P[b + 1]!), cx = sx(P[c]!), cy = sy(P[c + 1]!);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    // Flat normal as a fallback when the GLB has none.
    const fn = N ? null : norm([
      (P[b + 1]! - P[a + 1]!) * (P[c + 2]! - P[a + 2]!) - (P[b + 2]! - P[a + 2]!) * (P[c + 1]! - P[a + 1]!),
      (P[b + 2]! - P[a + 2]!) * (P[c]! - P[a]!) - (P[b]! - P[a]!) * (P[c + 2]! - P[a + 2]!),
      (P[b]! - P[a]!) * (P[c + 1]! - P[a + 1]!) - (P[b + 1]! - P[a + 1]!) * (P[c]! - P[a]!),
    ]);
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // The body faces +z (towards the camera), so a larger z is nearer.
        const z = w0 * P[a + 2]! + w1 * P[b + 2]! + w2 * P[c + 2]!;
        const i = y * W + x;
        if (z <= depth[i]!) continue;
        depth[i] = z;
        const light = N
          ? shade(w0 * N[a]! + w1 * N[b]! + w2 * N[c]!, w0 * N[a + 1]! + w1 * N[b + 1]! + w2 * N[c + 1]!, w0 * N[a + 2]! + w1 * N[b + 2]! + w2 * N[c + 2]!)
          : shade(Math.abs(fn![0]), fn![1], Math.abs(fn![2]));
        rgb[i * 3] = Math.min(255, Math.round(BASE[0] * light * 255));
        rgb[i * 3 + 1] = Math.min(255, Math.round(BASE[1] * light * 255));
        rgb[i * 3 + 2] = Math.min(255, Math.round(BASE[2] * light * 255));
      }
    }
  }

  return sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .resize(AVATAR_RENDER_SIZE.width, AVATAR_RENDER_SIZE.height, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}
