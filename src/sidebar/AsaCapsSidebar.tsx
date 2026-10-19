import { useCallback, useEffect, useState } from 'react';
import { ActiveVehicleSection } from './sections/ActiveVehicleSection';
import { ManualControlsSection } from './sections/ManualControlsSection';
import { RecentPartsSection } from './sections/RecentPartsSection';
import { requestActiveVehicleState, requestSettings, type ActiveVehicleState } from '@/services/messaging';

const EMPTY_STATE: ActiveVehicleState = { session: null, vehicle: null, recentFitments: [] };

export function AsaCapsSidebar() {
  const [state, setState] = useState<ActiveVehicleState>(EMPTY_STATE);
  const [captureEnabled, setCaptureEnabled] = useState(true);

  const refresh = useCallback(() => {
    requestActiveVehicleState().then(setState);
  }, []);

  useEffect(() => {
    refresh();
    requestSettings().then((settings) => setCaptureEnabled(settings.captureEnabled));

    function onMessage(message: unknown) {
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'STATE_UPDATED') {
        refresh();
      }
    }

    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [refresh]);

  return (
    <div className="pit-root fixed inset-y-0 right-0 z-[2147483647] flex h-screen w-[360px] flex-col overflow-y-auto border-l border-border bg-surface text-sm text-neutral-900 shadow-panel dark:border-border-dark dark:bg-surface-dark dark:text-neutral-100">
      <header className="sticky top-0 flex items-center gap-2 border-b border-border bg-surface px-4 py-3 dark:border-border-dark dark:bg-surface-dark">
        <h1 className="text-sm font-semibold tracking-tight">Parts Interpreter Toolkit</h1>
      </header>
      <ActiveVehicleSection session={state.session} vehicle={state.vehicle} />
      <RecentPartsSection fitments={state.recentFitments} />
      <ManualControlsSection
        captureEnabled={captureEnabled}
        onCaptureEnabledChange={setCaptureEnabled}
        onVehicleChanged={refresh}
      />
    </div>
  );
}
