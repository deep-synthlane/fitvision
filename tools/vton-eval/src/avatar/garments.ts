import sharp from 'sharp';
import type { GarmentRegion, ProductCategory } from '@fitvision/shared';

/**
 * Synthetic flat-lay garment images (768 × 1024, white background) drawn as SVG, so the test set
 * has no licensing or consent questions. They include plain, striped and logo garments to check
 * colour and pattern/logo preservation. Real product photos should be added to the test set later
 * (VALIDATION_TRACKING.md §3b).
 */
export interface TestGarment {
  id: string;
  category: ProductCategory;
  region: GarmentRegion;
  /** Sent as the provider's garment description. */
  description: string;
  features: ('plain' | 'pattern' | 'logo' | 'structured')[];
  svg: string;
}

const W = 768;
const H = 1024;
const STROKE = 'stroke="#3f3f46" stroke-width="3" stroke-linejoin="round"';

const tee = 'M254 170 Q384 250 514 170 L640 215 L690 360 L590 395 L560 330 L560 850 L208 850 L208 330 L178 395 L78 360 L128 215 Z';
const longSleeveTop = 'M254 170 Q384 245 514 170 L640 215 L715 640 L645 660 L560 360 L560 850 L208 850 L208 360 L123 660 L53 640 L128 215 Z';
const svg = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><defs>${defs}</defs>${body}</svg>`;

export const GARMENTS: TestGarment[] = [
  {
    id: 'u1-white-tee',
    category: 't_shirts',
    region: 'upper_body',
    description: 'plain white cotton crew-neck t-shirt, short sleeves',
    features: ['plain'],
    svg: svg('', `<path d="${tee}" fill="#f4f4f5" ${STROKE}/><path d="M290 190 Q384 262 478 190" fill="none" stroke="#a1a1aa" stroke-width="6"/>`),
  },
  {
    id: 'u2-striped-longsleeve',
    category: 'tops',
    region: 'upper_body',
    description: 'navy and white horizontal striped long-sleeve top',
    features: ['pattern'],
    svg: svg(
      '<pattern id="stripes" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="20" fill="#1e3a8a"/><rect y="20" width="40" height="20" fill="#ffffff"/></pattern>',
      `<path d="${longSleeveTop}" fill="url(#stripes)" ${STROKE}/>`,
    ),
  },
  {
    id: 'u3-logo-tee',
    category: 't_shirts',
    region: 'upper_body',
    description: 'black t-shirt with large white FITVISION logo and star on the chest',
    features: ['logo'],
    svg: svg(
      '',
      `<path d="${tee}" fill="#18181b" ${STROKE}/>
       <polygon points="384,330 400,375 448,375 410,402 424,448 384,420 344,448 358,402 320,375 368,375" fill="#facc15"/>
       <text x="384" y="520" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="64" fill="#ffffff">FITVISION</text>`,
    ),
  },
  {
    id: 'u4-olive-jacket',
    category: 'jackets',
    region: 'upper_body',
    description: 'olive green button-front jacket with collar and long sleeves',
    features: ['structured'],
    svg: svg(
      '',
      `<path d="${longSleeveTop}" fill="#4d5d2a" ${STROKE}/>
       <path d="M300 175 L384 330 L468 175 L430 165 L384 260 L338 165 Z" fill="#3b4720" ${STROKE}/>
       <line x1="384" y1="330" x2="384" y2="850" stroke="#2b3417" stroke-width="4"/>
       ${[390, 480, 570, 660, 750].map((y) => `<circle cx="402" cy="${y}" r="9" fill="#d6cfa8" stroke="#2b3417" stroke-width="2"/>`).join('')}
       <rect x="232" y="560" width="100" height="80" fill="none" stroke="#2b3417" stroke-width="3"/><rect x="436" y="560" width="100" height="80" fill="none" stroke="#2b3417" stroke-width="3"/>`,
    ),
  },
  {
    id: 'l1-blue-jeans',
    category: 'jeans',
    region: 'lower_body',
    description: 'mid-blue straight-leg denim jeans',
    features: ['plain'],
    svg: svg(
      '',
      `<path d="M234 110 L534 110 L560 920 L412 920 L384 330 L356 920 L208 920 Z" fill="#3b6ea8" ${STROKE}/>
       <rect x="234" y="110" width="300" height="44" fill="#2f5a8c" ${STROKE}/>
       <path d="M384 154 L384 300" stroke="#c99a3b" stroke-width="4"/>
       <path d="M250 170 Q300 230 330 170" fill="none" stroke="#c99a3b" stroke-width="4"/><path d="M438 170 Q468 230 518 170" fill="none" stroke="#c99a3b" stroke-width="4"/>`,
    ),
  },
  {
    id: 'l2-red-pleated-skirt',
    category: 'skirts',
    region: 'lower_body',
    description: 'red pleated A-line midi skirt',
    features: ['structured'],
    svg: svg(
      '',
      `<path d="M274 150 L494 150 L614 800 L154 800 Z" fill="#b91c1c" ${STROKE}/>
       <rect x="274" y="150" width="220" height="44" fill="#991b1b" ${STROKE}/>
       ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="${294 + i * 30}" y1="194" x2="${194 + i * 63}" y2="800" stroke="#7f1d1d" stroke-width="3"/>`).join('')}`,
    ),
  },
  {
    id: 'l3-khaki-shorts',
    category: 'shorts',
    region: 'lower_body',
    description: 'khaki chino shorts, knee length',
    features: ['plain'],
    svg: svg(
      '',
      `<path d="M234 250 L534 250 L580 640 L414 660 L384 420 L354 660 L188 640 Z" fill="#c3a36b" ${STROKE}/>
       <rect x="234" y="250" width="300" height="44" fill="#a8884f" ${STROKE}/>`,
    ),
  },
  {
    id: 'f1-polka-dress',
    category: 'dresses',
    region: 'full_body',
    description: 'sleeveless navy midi dress with white polka dots, A-line skirt',
    features: ['pattern'],
    svg: svg(
      '<pattern id="dots" width="56" height="56" patternUnits="userSpaceOnUse"><rect width="56" height="56" fill="#1e293b"/><circle cx="14" cy="14" r="7" fill="#ffffff"/><circle cx="42" cy="42" r="7" fill="#ffffff"/></pattern>',
      `<path d="M300 90 L332 90 Q384 170 436 90 L468 90 L505 200 L486 430 L620 940 L148 940 L282 430 L263 200 Z" fill="url(#dots)" ${STROKE}/>
       <path d="M282 430 L486 430" stroke="#0f172a" stroke-width="6"/>`,
    ),
  },
  {
    id: 'f2-green-shirt-dress',
    category: 'dresses',
    region: 'full_body',
    description: 'emerald green long-sleeve shirt dress with collar, buttons and belt',
    features: ['structured'],
    svg: svg(
      '',
      `<path d="M262 120 Q384 175 506 120 L620 160 L700 560 L636 578 L560 300 L548 440 L610 950 L158 950 L220 440 L208 300 L132 578 L68 560 L148 160 Z" fill="#047857" ${STROKE}/>
       <path d="M300 120 L384 210 L468 120 L440 108 L384 170 L328 108 Z" fill="#065f46" ${STROKE}/>
       <rect x="214" y="430" width="340" height="34" fill="#064e3b" ${STROKE}/>
       ${[250, 330, 520, 610, 700].map((y) => `<circle cx="384" cy="${y}" r="8" fill="#ecfdf5"/>`).join('')}`,
    ),
  },
];

export const garmentPng = (g: TestGarment) => sharp(Buffer.from(g.svg)).png().toBuffer();
