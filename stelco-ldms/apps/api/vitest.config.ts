import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['src/**/*.test.ts'], setupFiles: ['./test/setup-env.ts'], testTimeout: 30000 },
});
