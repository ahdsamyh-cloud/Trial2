import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { config } from '../../config';
import { redis } from '../../common/redis';
import { runAsSystem } from '../../common/context';
import { logger } from '../../common/logger';

export type JobHandler = (data: any) => Promise<unknown>;
export const QUEUE_NAME = 'ldms';

/**
 * Background jobs on one BullMQ queue, dispatched by job name. With QUEUE_INLINE=true
 * (tests/dev only) jobs run synchronously in-process. Handlers always run in system context.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly handlers = new Map<string, JobHandler>();
  private queue?: Queue;

  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  handler(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }

  names() {
    return [...this.handlers.keys()];
  }

  private q(): Queue {
    this.queue ??= new Queue(QUEUE_NAME, { connection: redis() });
    return this.queue;
  }

  async enqueue(name: string, data: Record<string, unknown> = {}, opts: { delayMs?: number; jobId?: string } = {}) {
    if (config().QUEUE_INLINE) {
      const h = this.handlers.get(name);
      if (!h) throw new Error(`No handler for job ${name}`);
      await runAsSystem(() => h(data) as Promise<unknown>).catch((err) => logger.error({ job: name, err: String(err) }, 'inline job failed'));
      return;
    }
    await this.q().add(name, data, {
      delay: opts.delayMs, jobId: opts.jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000, removeOnFail: 5000,
    });
  }

  /** Run a job now in-process (used by tests, and by the worker dispatcher). */
  async runNow(name: string, data: Record<string, unknown> = {}) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler for job ${name}`);
    return runAsSystem(() => h(data) as Promise<unknown>);
  }

  async schedule(name: string, pattern: string) {
    await this.q().upsertJobScheduler(`sched:${name}`, { pattern, tz: 'Indian/Maldives' }, { name, data: {} });
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
