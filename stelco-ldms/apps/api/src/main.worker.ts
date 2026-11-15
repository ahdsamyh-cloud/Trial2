import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { redis } from './common/redis';
import { logger } from './common/logger';
import { runAsSystem } from './common/context';
import { JobsService, QUEUE_NAME } from './core/jobs/jobs.service';
import { SCHEDULES } from './core/jobs/schedules';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const jobs = app.get(JobsService);
  for (const [name, pattern] of Object.entries(SCHEDULES)) if (jobs.handler(name)) await jobs.schedule(name, pattern);
  const worker = new Worker(QUEUE_NAME, async (job) => {
    const h = jobs.handler(job.name);
    if (!h) throw new Error(`No handler for ${job.name}`);
    return runAsSystem(() => h(job.data) as Promise<unknown>);
  }, { connection: redis(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) });
  worker.on('failed', (job, err) => logger.error({ job: job?.name, id: job?.id, err: err.message }, 'job failed'));
  worker.on('completed', (job) => logger.info({ job: job.name, id: job.id }, 'job done'));
  logger.info({ handlers: jobs.names() }, 'LDMS worker started');
  const stop = async () => { await worker.close(); await app.close(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((e) => {
  logger.fatal({ err: String(e) }, 'worker failed to start');
  process.exit(1);
});
