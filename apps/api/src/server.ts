import { buildApp } from './app.js';
import { openDb } from './db/client.js';
import { createStorage, loadConfigOrExit, loggerOptions } from './runtime.js';

const config = loadConfigOrExit();
const { db, close } = await openDb(config);
const storage = createStorage(config);
const app = await buildApp(config, { db, storage }, { logger: loggerOptions(config), trustProxy: config.deployed });

// In "inline" mode the API also runs background jobs; with JOB_MODE=api a separate worker does.
if (config.jobMode === 'inline') {
  await app.avatarJobs.failInterrupted();
  await app.tryOnJobs.recover();
  const purge = () =>
    app.tryOnJobs
      .purgeOld(config.tryOn.failedRetentionDays)
      .then((n) => n && app.log.info(`Purged ${n} old failed/cancelled try-ons`))
      .catch((err: unknown) => app.log.error({ err }, 'Try-on purge failed'));
  void purge();
  setInterval(purge, 60 * 60 * 1000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  { database: config.databaseUrl ? 'postgresql' : 'pglite', storage: config.storage.driver, jobMode: config.jobMode, tryOnProvider: config.tryOn.provider },
  'FitVision API started',
);
