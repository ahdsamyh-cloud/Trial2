import { createApp } from './bootstrap';
import { config } from './config';
import { logger } from './common/logger';

async function main() {
  const app = await createApp();
  await app.listen(config().PORT, process.env.BIND_HOST ?? '0.0.0.0');
  logger.info({ port: config().PORT }, 'LDMS API listening');
}
main().catch((e) => {
  logger.fatal({ err: String(e) }, 'API failed to start');
  process.exit(1);
});
