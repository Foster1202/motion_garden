import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        cameraDiagnostics: fileURLToPath(new URL('./camera-diagnostics.html', import.meta.url)),
      },
      output: { manualChunks: { phaser: ['phaser'] } },
    },
    chunkSizeWarningLimit: 1600,
  },
});
