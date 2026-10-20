import { CustomerMatchSection } from './sections/CustomerMatchSection';
import { CustomerSection } from './sections/CustomerSection';
import { PartsChecklist } from './sections/PartsChecklist';
import { QuoteCaptureSection } from './sections/QuoteCaptureSection';
import { QuoteDetailsSection } from './sections/QuoteDetailsSection';
import { VehicleSection } from './sections/VehicleSection';
import type { QuoteCaptureStore } from '@/content/quoteCaptureWatcher';
import type { RfqData } from '@/types/rfq';

interface SidebarProps {
  data: RfqData;
  captureStore: QuoteCaptureStore;
}

export function Sidebar({ data, captureStore }: SidebarProps) {
  return (
    <div className="pit-root fixed inset-y-0 right-0 z-[2147483647] flex h-screen w-[360px] flex-col overflow-y-auto border-l border-border bg-surface text-sm text-neutral-900 shadow-panel dark:border-border-dark dark:bg-surface-dark dark:text-neutral-100">
      <header className="sticky top-0 flex items-center gap-2 border-b border-border bg-surface px-4 py-3 dark:border-border-dark dark:bg-surface-dark">
        <h1 className="text-sm font-semibold tracking-tight">Parts Interpreter Toolkit</h1>
      </header>
      <CustomerSection customer={data.customer} />
      <CustomerMatchSection company={data.customer.company} address={data.customer.address} />
      <QuoteDetailsSection reference={data.reference} requiredBy={data.requiredBy} />
      <VehicleSection vehicle={data.vehicle} />
      <PartsChecklist parts={data.requestedParts} />
      <QuoteCaptureSection store={captureStore} />
    </div>
  );
}
