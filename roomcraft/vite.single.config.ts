import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Builds one self-contained HTML file that runs by double-click (no server needed). */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { outDir: 'dist-single', chunkSizeWarningLimit: 5000, assetsInlineLimit: 100000000 },
});
