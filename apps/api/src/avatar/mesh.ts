import type { BodyParameters } from '@fitvision/shared';

/**
 * Base human model + proportion morph. A neutral mannequin built from elliptical cross-sections
 * ("rings"). The template supplies vertical proportions (fractions of height) and limb tapers;
 * the user's body parameters set height, inseam, shoulder width, chest/waist/hip sections and
 * arm length. Units are centimetres; y is up, the body faces +z, feet at y = 0.
 */

export interface Ring {
  y: number;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

export type Part =
  | { name: string; kind: 'loft'; rings: Ring[]; capBottom?: boolean; capTop?: boolean; pivot?: { x: number; y: number }; angle?: number }
  | { name: string; kind: 'ellipsoid'; center: [number, number, number]; radii: [number, number, number] };

/** Template proportions as fractions of height (approximate adult averages). */
const TEMPLATE = {
  hipAboveCrotch: 0.035,
  waist: 0.62,
  chest: 0.72,
  armpitAboveChest: 0.025,
  shoulder: 0.818,
  neckAboveShoulder: 0.022,
  headHeight: 0.13,
  knee: 0.285,
  calf: 0.2,
  ankle: 0.039,
  neckGirth: 0.21,
  kneeGirth: 0.215,
  calfGirth: 0.21,
  ankleGirth: 0.125,
  thighToHipGirth: 0.58,
  upperArmGirth: 0.17,
  wristGirth: 0.098,
  armAbductionDeg: 12,
};

const r = (girth: number) => girth / (2 * Math.PI);

export interface BodyLevels {
  crotchY: number;
  hipY: number;
  waistY: number;
  chestY: number;
  shoulderY: number;
}

export function buildBody(p: Omit<BodyParameters, 'fidelity'>): { parts: Part[]; levels: BodyLevels } {
  const H = p.resolved.heightCm.valueCm;
  const { chest, waist, hips } = p.sections;
  const shoulderW = p.resolved.shoulderCm.valueCm;
  const armLength = p.resolved.armLengthCm.valueCm;

  // Vertical layout: the inseam fixes the crotch; other levels keep template proportions
  // but are pushed up if a long inseam would make them overlap.
  const crotchY = p.resolved.inseamCm.valueCm;
  const hipY = crotchY + TEMPLATE.hipAboveCrotch * H;
  const waistY = Math.max(TEMPLATE.waist * H, hipY + 0.07 * H);
  const chestY = Math.max(TEMPLATE.chest * H, waistY + 0.07 * H);
  const armpitY = chestY + TEMPLATE.armpitAboveChest * H;
  const shoulderY = Math.max(TEMPLATE.shoulder * H, armpitY + 0.05 * H);
  const neckBaseY = shoulderY + TEMPLATE.neckAboveShoulder * H;
  const chinY = H - TEMPLATE.headHeight * H;
  const neckR = r(TEMPLATE.neckGirth * H);

  const torso: Part = {
    name: 'torso',
    kind: 'loft',
    capTop: true,
    rings: [
      // Rounded underside (lowest point = crotch = inseam height) tapering into the thighs.
      { y: crotchY, cx: 0, cz: 0, rx: hips.widthCm * 0.06, rz: hips.depthCm * 0.06 },
      { y: crotchY + 0.012 * H, cx: 0, cz: 0, rx: (hips.widthCm * 0.5) / 2, rz: (hips.depthCm * 0.6) / 2 },
      { y: crotchY + 0.024 * H, cx: 0, cz: 0, rx: (hips.widthCm * 0.86) / 2, rz: (hips.depthCm * 0.85) / 2 },
      { y: hipY, cx: 0, cz: 0, rx: hips.widthCm / 2, rz: hips.depthCm / 2 },
      { y: waistY, cx: 0, cz: 0, rx: waist.widthCm / 2, rz: waist.depthCm / 2 },
      { y: chestY, cx: 0, cz: 0, rx: chest.widthCm / 2, rz: chest.depthCm / 2 },
      { y: armpitY, cx: 0, cz: 0, rx: Math.max(chest.widthCm * 0.97, shoulderW * 0.9) / 2, rz: (chest.depthCm * 0.92) / 2 },
      { y: shoulderY, cx: 0, cz: -0.01 * H, rx: shoulderW / 2, rz: (chest.depthCm * 0.6) / 2 },
      { y: neckBaseY, cx: 0, cz: -0.005 * H, rx: neckR, rz: neckR },
      { y: chinY + 0.01 * H, cx: 0, cz: 0, rx: neckR * 0.95, rz: neckR * 0.95 },
    ],
  };

  const head: Part = {
    name: 'head',
    kind: 'ellipsoid',
    center: [0, H - (TEMPLATE.headHeight / 2) * H, 0.005 * H],
    radii: [0.044 * H, (TEMPLATE.headHeight / 2) * H, 0.056 * H],
  };

  const thighR = r(TEMPLATE.thighToHipGirth * p.resolved.hipsCm.valueCm);
  const legs: Part[] = [1, -1].map((side) => {
    const topX = side * (hips.widthCm / 2 - thighR) * 0.95;
    const footX = side * 0.055 * H;
    const x = (y: number) => footX + ((topX - footX) * y) / hipY;
    const ring = (y: number, radius: number, depthScale = 1): Ring => ({ y, cx: x(y), cz: 0, rx: radius, rz: radius * depthScale });
    return {
      name: side > 0 ? 'leftLeg' : 'rightLeg',
      kind: 'loft',
      capBottom: true,
      rings: [
        ring(0.01 * H, r(TEMPLATE.ankleGirth * H)),
        ring(TEMPLATE.ankle * H, r(TEMPLATE.ankleGirth * H)),
        ring(TEMPLATE.calf * H, r(TEMPLATE.calfGirth * H), 1.05),
        ring(TEMPLATE.knee * H, r(TEMPLATE.kneeGirth * H)),
        ring(crotchY - 0.02 * H, thighR, 1.05),
        ring(hipY, thighR * 1.05, 1.05),
      ],
    };
  });

  const feet: Part[] = [1, -1].map((side) => ({
    name: side > 0 ? 'leftFoot' : 'rightFoot',
    kind: 'ellipsoid',
    center: [side * 0.055 * H, 0.022 * H, 0.04 * H],
    radii: [0.026 * H, 0.022 * H, 0.075 * H],
  }));

  // Arms are built hanging straight down from the shoulder joint, then rotated outward.
  const upperArmR = r(TEMPLATE.upperArmGirth * H);
  const wristR = r(TEMPLATE.wristGirth * H);
  const arms: Part[] = [1, -1].map((side) => {
    const pivot = { x: side * (shoulderW / 2 - upperArmR * 0.8), y: shoulderY - 0.015 * H };
    const ring = (along: number, radius: number): Ring => ({ y: pivot.y - along, cx: pivot.x, cz: -0.01 * H, rx: radius, rz: radius });
    return {
      name: side > 0 ? 'leftArm' : 'rightArm',
      kind: 'loft',
      capBottom: true,
      capTop: true,
      pivot,
      angle: side * TEMPLATE.armAbductionDeg,
      // Bottom (wrist) to top (shoulder) so the rings ascend in y.
      rings: [
        ring(armLength, wristR),
        ring(armLength * 0.72, wristR * 1.35),
        ring(armLength * 0.55, upperArmR * 0.78),
        ring(armLength * 0.25, upperArmR),
        ring(0, upperArmR * 0.95),
      ],
    };
  });

  const hands: Part[] = arms.map((arm) => {
    if (arm.kind !== 'loft' || !arm.pivot) throw new Error('unreachable');
    const end = rotate({ x: arm.pivot.x, y: arm.pivot.y - armLength - 0.045 * H }, arm.pivot, arm.angle ?? 0);
    return { name: `${arm.name}Hand`, kind: 'ellipsoid', center: [end.x, end.y, -0.01 * H], radii: [0.012 * H, 0.05 * H, 0.025 * H] };
  });

  return { parts: [torso, head, ...legs, ...feet, ...arms, ...hands], levels: { crotchY, hipY, waistY, chestY, shoulderY } };
}

/** Rotates a point in the xy-plane about a pivot (positive = outward for the left side). */
export function rotate(pt: { x: number; y: number }, pivot: { x: number; y: number }, deg: number) {
  const a = (deg * Math.PI) / 180;
  const dx = pt.x - pivot.x;
  const dy = pt.y - pivot.y;
  return { x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

export interface MeshData {
  positions: number[];
  indices: number[];
  /** Index range [start, end) of each part's triangles, for measuring individual parts. */
  partTriangles: Record<string, [number, number]>;
}

const SEGMENTS = 48;

function addLoft(mesh: MeshData, part: Extract<Part, { kind: 'loft' }>) {
  const base = mesh.positions.length / 3;
  for (const ring of part.rings) {
    for (let j = 0; j < SEGMENTS; j++) {
      const t = (2 * Math.PI * j) / SEGMENTS;
      let x = ring.cx + ring.rx * Math.cos(t);
      let y = ring.y;
      if (part.pivot && part.angle) ({ x, y } = rotate({ x, y }, part.pivot, part.angle));
      mesh.positions.push(x, y, ring.cz + ring.rz * Math.sin(t));
    }
  }
  for (let i = 0; i < part.rings.length - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = base + i * SEGMENTS + j;
      const b = base + (i + 1) * SEGMENTS + j;
      const c = base + i * SEGMENTS + ((j + 1) % SEGMENTS);
      const d = base + (i + 1) * SEGMENTS + ((j + 1) % SEGMENTS);
      mesh.indices.push(a, b, c, b, d, c);
    }
  }
  const cap = (ringIndex: number, top: boolean) => {
    const ring = part.rings[ringIndex]!;
    let { cx: x, y } = { cx: ring.cx, y: ring.y };
    if (part.pivot && part.angle) ({ x, y } = rotate({ x, y }, part.pivot, part.angle));
    const centre = mesh.positions.length / 3;
    mesh.positions.push(x, y, ring.cz);
    for (let j = 0; j < SEGMENTS; j++) {
      const p = base + ringIndex * SEGMENTS + j;
      const q = base + ringIndex * SEGMENTS + ((j + 1) % SEGMENTS);
      if (top) mesh.indices.push(centre, q, p);
      else mesh.indices.push(centre, p, q);
    }
  };
  if (part.capBottom) cap(0, false);
  if (part.capTop) cap(part.rings.length - 1, true);
}

function addEllipsoid(mesh: MeshData, part: Extract<Part, { kind: 'ellipsoid' }>) {
  const [cx, cy, cz] = part.center;
  const [rx, ry, rz] = part.radii;
  const stacks = 16;
  const rings: Ring[] = [];
  for (let i = 0; i <= stacks; i++) {
    const lat = -Math.PI / 2 + (Math.PI * i) / stacks;
    const k = Math.max(Math.cos(lat), 1e-4);
    rings.push({ y: cy + ry * Math.sin(lat), cx, cz, rx: rx * k, rz: rz * k });
  }
  addLoft(mesh, { name: part.name, kind: 'loft', rings });
}

export function buildMesh(parts: Part[]): MeshData {
  const mesh: MeshData = { positions: [], indices: [], partTriangles: {} };
  for (const part of parts) {
    const start = mesh.indices.length / 3;
    if (part.kind === 'loft') addLoft(mesh, part);
    else addEllipsoid(mesh, part);
    mesh.partTriangles[part.name] = [start, mesh.indices.length / 3];
  }
  return mesh;
}

/** Smooth per-vertex normals from area-weighted face normals. */
export function computeNormals(positions: number[], indices: number[]): number[] {
  const n = new Array<number>(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i]! * 3, indices[i + 1]! * 3, indices[i + 2]! * 3];
    const e1 = [positions[b]! - positions[a]!, positions[b + 1]! - positions[a + 1]!, positions[b + 2]! - positions[a + 2]!];
    const e2 = [positions[c]! - positions[a]!, positions[c + 1]! - positions[a + 1]!, positions[c + 2]! - positions[a + 2]!];
    const fx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    const fy = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    const fz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    for (const v of [a, b, c]) {
      n[v]! += fx;
      n[v + 1]! += fy;
      n[v + 2]! += fz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i]! /= len;
    n[i + 1]! /= len;
    n[i + 2]! /= len;
  }
  return n;
}

/** Perimeter of a part's cross-section at height y (sum of triangle/plane intersection segments). */
export function sliceGirth(mesh: MeshData, part: string, y: number): number {
  const [start, end] = mesh.partTriangles[part]!;
  const P = mesh.positions;
  let total = 0;
  for (let t = start; t < end; t++) {
    const pts: [number, number][] = [];
    const idx = [mesh.indices[t * 3]!, mesh.indices[t * 3 + 1]!, mesh.indices[t * 3 + 2]!];
    for (let k = 0; k < 3; k++) {
      const p = idx[k]! * 3;
      const q = idx[(k + 1) % 3]! * 3;
      const y1 = P[p + 1]!;
      const y2 = P[q + 1]!;
      if ((y1 - y) * (y2 - y) < 0) {
        const s = (y - y1) / (y2 - y1);
        pts.push([P[p]! + s * (P[q]! - P[p]!), P[p + 2]! + s * (P[q + 2]! - P[p + 2]!)]);
      }
    }
    if (pts.length === 2) total += Math.hypot(pts[0]![0] - pts[1]![0], pts[0]![1] - pts[1]![1]);
  }
  return total;
}

/** Width (x extent) of a part at height y, from its vertices within `tolerance`. */
export function widthAt(mesh: MeshData, part: string, y: number, tolerance = 0.01): number {
  const [start, end] = mesh.partTriangles[part]!;
  let min = Infinity;
  let max = -Infinity;
  for (let i = start * 3; i < end * 3; i++) {
    const v = mesh.indices[i]! * 3;
    if (Math.abs(mesh.positions[v + 1]! - y) <= tolerance) {
      min = Math.min(min, mesh.positions[v]!);
      max = Math.max(max, mesh.positions[v]!);
    }
  }
  return max - min;
}

/** Vertical extent of the whole mesh, or of one part. */
export function verticalExtent(mesh: MeshData, part?: string): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  const [start, end] = part ? mesh.partTriangles[part]! : [0, mesh.indices.length / 3];
  for (let i = start * 3; i < end * 3; i++) {
    const y = mesh.positions[mesh.indices[i]! * 3 + 1]!;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minY, maxY };
}
