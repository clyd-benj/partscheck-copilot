import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

/**
 * PartsCheck's production host — the RFQ sidebar is deliberately scoped to
 * this single origin and must never run (or request access) anywhere else.
 */
const PARTSCHECK_MATCH = 'https://*.partscheck.com.au/*';

/**
 * ASA CAPS (Mitsubishi's Aftersales Support Application, myasaweb.com) —
 * the VIN/part-number catalogue content script runs here. Two domains since
 * different dealer instances have been observed under both.
 */
const ASA_CAPS_MATCHES = ['*://*.myasaweb.com/*', '*://*.asacaps.com/*'];

export default defineManifest({
  manifest_version: 3,
  name: 'Parts Interpreter Toolkit',
  version: pkg.version,
  description:
    'Read-only sidebar for PartsCheck RFQs and a passive VIN-to-part-number catalogue for ASA CAPS — faster quoting in Pentana ERA and genuine part lookups, without automating either.',
  icons: {
    16: 'src/assets/icons/icon-16.png',
    32: 'src/assets/icons/icon-32.png',
    48: 'src/assets/icons/icon-48.png',
    128: 'src/assets/icons/icon-128.png',
  },
  action: {
    default_icon: {
      16: 'src/assets/icons/icon-16.png',
      32: 'src/assets/icons/icon-32.png',
      48: 'src/assets/icons/icon-48.png',
      128: 'src/assets/icons/icon-128.png',
    },
    default_title: 'Parts Interpreter Toolkit',
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: [PARTSCHECK_MATCH],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
    {
      matches: ASA_CAPS_MATCHES,
      js: ['src/content/asacaps.tsx'],
      run_at: 'document_idle',
      all_frames: true,
    },
  ],
  permissions: ['storage', 'notifications', 'clipboardRead', 'alarms', 'offscreen'],
  host_permissions: [PARTSCHECK_MATCH, ...ASA_CAPS_MATCHES],
});
