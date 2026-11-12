import { rotate, type Part } from './mesh.js';

/**
 * Front-view silhouette (orthographic) as a self-contained SVG. Generated server-side from the
 * same parts as the 3D model, so it needs no GPU. Contains no user-supplied text.
 */
export function renderFrontPreview(parts: Part[], heightCm: number): Buffer {
  const shapes: string[] = [];
  const fmt = (n: number) => n.toFixed(1);
  // SVG y grows downward; flip so feet sit at the bottom.
  const Y = (y: number) => heightCm - y;

  const sorted = [...parts].sort((a, b) => order(a) - order(b));
  for (const part of sorted) {
    if (part.kind === 'ellipsoid') {
      const [cx, cy] = part.center;
      shapes.push(`<ellipse cx="${fmt(cx)}" cy="${fmt(Y(cy))}" rx="${fmt(part.radii[0])}" ry="${fmt(part.radii[1])}"/>`);
      continue;
    }
    const left: string[] = [];
    const right: string[] = [];
    for (const ring of part.rings) {
      let l = { x: ring.cx - ring.rx, y: ring.y };
      let r = { x: ring.cx + ring.rx, y: ring.y };
      if (part.pivot && part.angle) {
        l = rotate(l, part.pivot, part.angle);
        r = rotate(r, part.pivot, part.angle);
      }
      left.push(`${fmt(l.x)},${fmt(Y(l.y))}`);
      right.unshift(`${fmt(r.x)},${fmt(Y(r.y))}`);
    }
    shapes.push(`<polygon points="${[...left, ...right].join(' ')}"/>`);
  }

  const pad = 4;
  const halfWidth = heightCm * 0.32;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(-halfWidth)} ${-pad} ${fmt(halfWidth * 2)} ${fmt(heightCm + pad * 2)}" role="img" aria-label="Avatar front view">` +
    `<g fill="#cfd5dd" stroke="#8a96a8" stroke-width="0.4" stroke-linejoin="round">${shapes.join('')}</g></svg>`;
  return Buffer.from(svg, 'utf8');
}

/** Draw arms and legs behind the torso, head last. */
function order(p: Part): number {
  if (p.name.includes('Arm') || p.name.includes('Hand')) return 0;
  if (p.name.includes('Leg') || p.name.includes('Foot')) return 1;
  if (p.name === 'torso') return 2;
  return 3;
}
