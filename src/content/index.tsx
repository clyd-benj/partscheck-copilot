import { createRoot } from 'react-dom/client';
import sidebarStyles from '@/styles/sidebar.css?inline';
import { extractRfqData } from '@/services/extractors';
import { requestSaveQuoteCapture } from '@/services/messaging';
import { isRfqPage } from '@/services/rfqDetection';
import { Sidebar } from '@/sidebar/Sidebar';
import { createQuoteCaptureStore, startQuoteCaptureWatcher, type QuoteCaptureStore } from './quoteCaptureWatcher';

const HOST_ID = 'parts-interpreter-toolkit-host';

/**
 * The sidebar lives inside a closed Shadow DOM so that (a) PartsCheck's
 * page styles can never bleed in and mis-render our UI, and (b) our
 * Tailwind base reset can never bleed out and alter PartsCheck's own
 * styling. This is what makes the extension truly read-only/non-intrusive.
 */
function injectSidebar(captureStore: QuoteCaptureStore): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = sidebarStyles;
  shadowRoot.appendChild(style);

  const mountPoint = document.createElement('div');
  shadowRoot.appendChild(mountPoint);

  createRoot(mountPoint).render(<Sidebar data={extractRfqData()} captureStore={captureStore} />);
}

if (isRfqPage()) {
  const captureStore = createQuoteCaptureStore();
  injectSidebar(captureStore);
  startQuoteCaptureWatcher(captureStore, requestSaveQuoteCapture);
}
