import { useState, type FormEvent } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { isValidVin } from '@/services/asacaps/vin';
import { requestCloseActiveSession, requestSetCaptureEnabled, requestSetVehicleManually } from '@/services/messaging';

interface ManualControlsSectionProps {
  captureEnabled: boolean;
  onCaptureEnabledChange: (enabled: boolean) => void;
  onVehicleChanged: () => void;
}

export function ManualControlsSection({
  captureEnabled,
  onCaptureEnabledChange,
  onVehicleChanged,
}: ManualControlsSectionProps) {
  const [showVinForm, setShowVinForm] = useState(false);
  const [vinInput, setVinInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);

  async function handlePauseToggle() {
    const next = !captureEnabled;
    onCaptureEnabledChange(next); // optimistic — avoids a flash while the message round-trips
    await requestSetCaptureEnabled(next);
  }

  async function handleSetVehicle(event: FormEvent) {
    event.preventDefault();
    const vin = vinInput.trim().toUpperCase();
    if (!isValidVin(vin)) {
      setError('Not a valid 17-character VIN.');
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await requestSetVehicleManually(vin);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setShowVinForm(false);
    setVinInput('');
    onVehicleChanged();
  }

  async function handleCloseSession() {
    setClosing(true);
    await requestCloseActiveSession();
    setClosing(false);
    onVehicleChanged();
  }

  return (
    <SectionCard title="Controls">
      <label className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm text-neutral-900 dark:text-neutral-100">
        <span>Pause capture</span>
        <input
          type="checkbox"
          checked={!captureEnabled}
          onChange={handlePauseToggle}
          className="h-4 w-4 shrink-0 rounded border-neutral-400 accent-accent"
        />
      </label>

      <div className="flex flex-col gap-2 px-4 py-2">
        {!showVinForm ? (
          <button
            type="button"
            onClick={() => setShowVinForm(true)}
            className="text-left text-sm text-accent hover:underline"
          >
            Set Vehicle Manually
          </button>
        ) : (
          <form onSubmit={handleSetVehicle} className="flex flex-col gap-2">
            <input
              type="text"
              value={vinInput}
              onChange={(event) => setVinInput(event.target.value)}
              maxLength={17}
              placeholder="17-character VIN"
              autoFocus
              className="rounded border border-border bg-transparent px-2 py-1 text-sm dark:border-border-dark"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-accent px-2 py-1 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                {submitting ? 'Setting…' : 'Set Active Vehicle'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowVinForm(false);
                  setError(null);
                  setVinInput('');
                }}
                className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
              >
                Cancel
              </button>
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </form>
        )}

        <button
          type="button"
          onClick={handleCloseSession}
          disabled={closing}
          className="text-left text-sm text-neutral-500 hover:underline disabled:opacity-50 dark:text-neutral-400"
        >
          {closing ? 'Closing…' : 'Close Current Vehicle'}
        </button>
      </div>
    </SectionCard>
  );
}
