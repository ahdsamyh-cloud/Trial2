import type { INestApplication } from '@nestjs/common';
import { logger } from '../../common/logger';
import { JobsService } from './jobs.service';
import { cronMatches, SCHEDULES } from './schedules';

/**
 * Local edition only (LOCAL_SCHEDULER=true, refused in production): runs the recurring jobs
 * inside the API process once a minute instead of in the BullMQ worker. Jobs run one at a time.
 */
export function startLocalScheduler(app: INestApplication): () => void {
  const jobs = app.get(JobsService);
  let lastMinute = -1;
  let running = false;
  const tick = async () => {
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute === lastMinute || running) return;
    lastMinute = minute;
    running = true;
    try {
      for (const [name, pattern] of Object.entries(SCHEDULES)) {
        if (!jobs.handler(name) || !cronMatches(pattern, now)) continue;
        await jobs.runNow(name).catch((err) => logger.error({ job: name, err: String(err) }, 'scheduled job failed'));
      }
    } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 15_000);
  timer.unref();
  logger.info('local scheduler started (recurring jobs run inside the API)');
  return () => clearInterval(timer);
}
