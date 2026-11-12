/**
 * Builds the avatar try-on test set: avatar renders (per style) × synthetic garments → a manifest
 * that `run-eval` runs through the app's VirtualTryOnProvider. Writes under data/avatar/ (git-ignored).
 *
 *   pnpm --filter @fitvision/vton-eval avatar-build              # 24 cases per style
 *   pnpm --filter @fitvision/vton-eval avatar-build --all        # every body × garment (45 per style)
 *   pnpm --filter @fitvision/vton-eval avatar-build --style avatar-render-1.0-flat
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FRAMING_FOR_REGION } from '@fitvision/shared';
import { ParametricAvatarGenerator } from '../../../../apps/api/src/avatar/generator.js';
import { BODIES } from './bodies.js';
import { GARMENTS, garmentPng } from './garments.js';
import { selectCases } from './cases.js';
import { RENDER_STYLES } from './styles.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const styleArg = args[args.indexOf('--style') + 1];
const styles = args.includes('--style') ? RENDER_STYLES.filter((s) => s.id === styleArg) : RENDER_STYLES;
if (styles.length === 0) throw new Error(`Unknown style. Available: ${RENDER_STYLES.map((s) => s.id).join(', ')}`);

const root = path.resolve(import.meta.dirname, '../../data/avatar');
mkdirSync(path.join(root, 'garments'), { recursive: true });
for (const g of GARMENTS) writeFileSync(path.join(root, 'garments', `${g.id}.png`), await garmentPng(g));

const generator = new ParametricAvatarGenerator();
const avatars = await Promise.all(BODIES.map(async (b) => ({ body: b, avatar: await generator.generate(b.inputs) })));
const cases = selectCases(all);

for (const style of styles) {
  const dir = path.join(root, style.id);
  mkdirSync(path.join(dir, 'bodies'), { recursive: true });
  for (const { body, avatar } of avatars) {
    for (const framing of ['upper_body', 'full_body'] as const) {
      writeFileSync(path.join(dir, 'bodies', `${body.id}-${framing}.png`), await style.render(avatar.asset.data, framing));
    }
  }
  const manifest = {
    $comment: `Avatar try-on test set, style ${style.id}, avatar model ${generator.modelVersion}. Synthetic bodies and garments only.`,
    style: style.id,
    appRendererVersion: style.appRendererVersion,
    avatarModelVersion: generator.modelVersion,
    cases: cases.map(({ body, garment }) => ({
      id: `${style.id}__${body.id}__${garment.id}`,
      person: `bodies/${body.id}-${FRAMING_FOR_REGION[garment.region]}.png`,
      garment: `../garments/${garment.id}.png`,
      region: garment.region,
      description: garment.description,
      notes: `${body.label} · ${garment.category} · ${garment.features.join(', ')}`,
      style: style.id,
      bodyId: body.id,
      garmentId: garment.id,
      category: garment.category,
    })),
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`${style.id}: ${manifest.cases.length} cases → ${path.relative(process.cwd(), path.join(dir, 'manifest.json'))}`);
}
