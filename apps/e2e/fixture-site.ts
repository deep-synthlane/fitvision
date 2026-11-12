// Local stand-in retailer site for the product-import E2E flow (no live websites in tests).
import { startProductSite } from '../api/test/fixtures/productSite.js';

const port = Number(process.env.FIXTURE_PORT ?? 4599);
const site = await startProductSite(port);
console.log(`Fixture product site on ${site.origin}`);
