import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // CRXJS needs a stable HMR port that the extension's injected client can reach.
    hmr: {
      port: 5173,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Offscreen documents are created dynamically via
      // chrome.offscreen.createDocument, not referenced by any manifest
      // field, so CRXJS's manifest scan won't auto-discover this page —
      // it's declared as an extra build input here instead.
      input: {
        offscreen: 'src/offscreen/index.html',
      },
    },
  },
});
