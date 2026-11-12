/**
 * Dedicated background-job worker (JOB_MODE=worker). Runs avatar and try-on jobs queued by API
 * processes started with JOB_MODE=api. Safe to run more than one: jobs are claimed with atomic
 * updates, so duplicate pick-ups do nothing, and polling resumes in-flight provider jobs after a
 * restart.
 */
import { buildApp } from './app.js';
import { openDb } from './db/client.js';
import { createStorage, loadConfigOrExit, loggerOptions } from './runtime.js';

const config = loadConfigOrExit({ ...process.env, JOB_MODE: 'worker' });
const { db, close } = await openDb(config);
const app = await buildApp(config, { db, storage: createStorage(config) }, { logger: loggerOptions(config) });
await app.ready();

await app.avatarJobs.failInterrupted();
await app.tryOnJobs.recover();
app.log.info({ pollMs: config.workerPollMs }, 'FitVision worker started');

let stopping = false;
const tick = async () => {
  if (stopping) return;
  try {
    await app.avatarJobs.pollPending();
    await app.tryOnJobs.pollPending();
  } catch (err) {
    app.log.error({ err }, 'Worker poll failed');
  }
};
const timer = setInterval(() => void tick(), config.workerPollMs);
const purge = setInterval(
  () => void app.tryOnJobs.purgeOld(config.tryOn.failedRetentionDays).catch((err: unknown) => app.log.error({ err }, 'Purge failed')),
  60 * 60 * 1000,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopping = true;
    clearInterval(timer);
    clearInterval(purge);
    await app.close(); // waits for avatar jobs; try-on polling pauses and resumes on next start
    await close();
    process.exit(0);
  });
}
