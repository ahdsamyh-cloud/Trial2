import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.int.config';

/** The integration suite with a ONE-connection database pool (see TEST_SINGLE_CONNECTION in test/setup-env.ts). */
export default mergeConfig(base, defineConfig({ test: { env: { TEST_SINGLE_CONNECTION: '1' } } }));
