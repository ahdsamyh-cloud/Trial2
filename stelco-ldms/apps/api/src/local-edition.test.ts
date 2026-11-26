import { afterEach, describe, expect, it } from 'vitest';
import { cronMatches } from './core/jobs/schedules';
import { MemoryRedis } from './common/redis';
import { AvService } from './core/documents/av.service';
import { config, resetConfigForTests } from './config';

describe('local scheduler cron matcher (Maldives time, UTC+5)', () => {
  // 2026-11-15 is a Sunday. 01:00 UTC = 06:00 in Malé.
  const at = (iso: string) => new Date(iso);
  it('matches steps, fixed times, ranges and weekdays', () => {
    expect(cronMatches('*/10 * * * *', at('2026-11-15T01:20:00Z'))).toBe(true);
    expect(cronMatches('*/10 * * * *', at('2026-11-15T01:21:00Z'))).toBe(false);
    expect(cronMatches('0 6 * * *', at('2026-11-15T01:00:00Z'))).toBe(true);
    expect(cronMatches('0 6 * * *', at('2026-11-15T06:00:00Z'))).toBe(false);
    expect(cronMatches('0 7 * * 0-4', at('2026-11-15T02:00:00Z'))).toBe(true);   // Sunday 07:00
    expect(cronMatches('0 7 * * 0-4', at('2026-11-20T02:00:00Z'))).toBe(false);  // Friday
    expect(cronMatches('0 3 * * 6', at('2026-11-20T22:00:00Z'))).toBe(true);     // Saturday 03:00 local
    expect(cronMatches('bad', at('2026-11-15T01:00:00Z'))).toBe(false);
  });
});

describe('in-memory Redis stand-in', () => {
  it('counts and expires keys like INCR + EXPIRE', async () => {
    const r = new MemoryRedis();
    expect(await r.incr('a')).toBe(1);
    expect(await r.expire('a', 0)).toBe(1);
    await new Promise((res) => setTimeout(res, 5));
    expect(await r.incr('a')).toBe(1);
    expect(await r.incr('a')).toBe(2);
    expect(await r.ping()).toBe('PONG');
  });
});

describe('local-edition settings', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; resetConfigForTests(); });

  it('AV_MODE=eicar blocks only the EICAR test file', async () => {
    process.env.AV_MODE = 'eicar'; resetConfigForTests();
    const av = new AvService();
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!H+H*');
    expect((await av.scan(eicar)).status).toBe('INFECTED');
    expect((await av.scan(Buffer.from('%PDF-1.4 hello'))).status).toBe('CLEAN');
  });

  it('production refuses every local-edition shortcut', () => {
    const base = { NODE_ENV: 'production', COOKIE_SECURE: 'true', AV_MODE: 'clamd', QUEUE_INLINE: 'false' };
    for (const extra of [{ AV_MODE: 'eicar' }, { AV_MODE: 'off' }, { REDIS_URL: 'memory', QUEUE_INLINE: 'true' }, { LOCAL_SCHEDULER: 'true', QUEUE_INLINE: 'true' }]) {
      Object.assign(process.env, base, extra); resetConfigForTests();
      expect(() => config()).toThrow();
      process.env = { ...saved };
    }
  });
});
