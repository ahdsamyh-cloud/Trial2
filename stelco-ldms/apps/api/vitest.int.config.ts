import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
