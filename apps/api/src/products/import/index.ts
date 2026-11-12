import { GenericHtmlImporter } from './genericHtml.js';
import { OpenGraphImporter } from './openGraph.js';
import { StructuredDataImporter } from './structuredData.js';
import type { ProductImporter } from './types.js';

/** Store-specific adapters (origin `store_adapter`) go between OpenGraph and generic HTML. */
const STORE_ADAPTERS: ProductImporter[] = [];

export const defaultImporters = (): ProductImporter[] => [
  new StructuredDataImporter(),
  new OpenGraphImporter(),
  ...STORE_ADAPTERS,
  new GenericHtmlImporter(),
];

export { ImportFailure, importFromUrl } from './pipeline.js';
