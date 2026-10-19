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
      // Pages not referenced by any manifest field don't get
      // auto-discovered by CRXJS's manifest scan, so they're declared as
      // extra build inputs here: offscreen documents are created
      // dynamically via chrome.offscreen.createDocument, and the
      // catalogue page is only ever opened via chrome.tabs.create.
      input: {
        offscreen: 'src/offscreen/index.html',
        catalogue: 'src/catalogue/index.html',
      },
    },
  },
});
