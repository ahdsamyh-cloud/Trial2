import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { redis } from './common/redis';
import { logger } from './common/logger';
import { runAsSystem } from './common/context';
import { JobsService, QUEUE_NAME } from './core/jobs/jobs.service';

/** Recurring jobs (cron in Indian/Maldives time). */
export const SCHEDULES: Record<string, string> = {
  'sla.scan': '*/10 * * * *',
  'reminders.send': '*/15 * * * *',
  'mail.flush': '*/5 * * * *',
  'digest.daily': '0 7 * * 0-4',
  'digest.weekly': '0 7 * * 0',
  'audit.verify': '30 2 * * *',
  'lit.no-update': '0 6 * * *',
  'cmp.cycles': '15 6 * * *',
  'cmp.ack-reminders': '0 9 * * 0-4',
  'cmp.findings-overdue': '30 6 * * *',
  'drf.expiry-scan': '45 6 * * *',
  'retention.scan': '0 3 * * 6',
  'crypto.rotate': '0 4 * * 5',
};

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
