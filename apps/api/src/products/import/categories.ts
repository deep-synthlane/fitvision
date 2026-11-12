import type { ProductCategory } from '@fitvision/shared';

/** Checked in order: more specific garments first (e.g. "denim jacket" → jackets, "t-shirt" before "shirt"). */
const RULES: [ProductCategory, RegExp][] = [
  ['dresses', /\b(dress(es)?|gown|jumpsuit|playsuit)\b/i],
  ['jackets', /\b(jacket|coat|blazer|parka|bomber|anorak|gilet|windbreaker)s?\b/i],
  ['jeans', /\bjeans?\b/i],
  ['skirts', /\bskirts?\b/i],
  ['shorts', /\bshorts\b/i],
  ['trousers', /\b(trousers?|pants?|chinos?|leggings?|joggers?|slacks|culottes)\b/i],
  ['t_shirts', /\b(t-?shirts?|tees?)\b/i],
  ['shirts', /\b(shirts?|blouses?)\b/i],
  ['tops', /\b(tops?|sweaters?|jumpers?|hoodies?|sweatshirts?|cardigans?|polos?|tanks?|camis?|vests?|knitwear|tunics?|bodysuits?)\b/i],
];

/** Outside the initial try-on scope. */
const UNSUPPORTED = /\b(shoes?|sneakers?|trainers?|boots?|sandals?|heels|loafers?|slippers?|bags?|handbags?|backpacks?|belts?|hats?|caps?|beanies?|scarf|scarves|gloves?|jewell?ery|necklaces?|earrings?|bracelets?|rings?|watch(es)?|sunglasses|socks?|wallets?|underwear|bras?|lingerie|swimwear|bikinis?)\b/i;

export function mapCategory(hints: string[]): { category: ProductCategory | null; subcategory: string | null; unsupported: boolean } {
  const texts = hints.map((h) => h.trim()).filter(Boolean);
  for (const t of texts) {
    for (const [category, re] of RULES) {
      if (re.test(t)) return { category, subcategory: leaf(t), unsupported: false };
    }
  }
  return { category: null, subcategory: texts[0] ? leaf(texts[0]) : null, unsupported: texts.some((t) => UNSUPPORTED.test(t)) };
}

/** "Women > Clothing > Denim Jackets" → "Denim Jackets". */
function leaf(t: string): string | null {
  const parts = t.split(/\s*[>/|›»]\s*/).filter(Boolean);
  const last = parts[parts.length - 1]?.trim();
  return last && last.length <= 100 ? last : null;
}
