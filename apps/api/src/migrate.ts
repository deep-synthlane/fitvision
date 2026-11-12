/** Applies pending migrations and exits (used by deploy pipelines before starting the API). */
import { loadConfigOrExit } from './runtime.js';
import { openDb } from './db/client.js';

const config = loadConfigOrExit();
const { close } = await openDb(config); // openDb applies migrations
await close();
console.log(`Migrations applied (${config.databaseUrl ? 'PostgreSQL' : 'PGlite'}).`);
