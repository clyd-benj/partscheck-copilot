import { useEffect, useState } from 'react';
import { AsaCapsDatabase } from '@/storage/asacapsDb';
import type { DebugInfo, Settings } from '@/types/asacaps';

export function AsaCapsTab() {
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    AsaCapsDatabase.getSettings().then(setSettings);
    chrome.storage.local.get('lastDebugEvent').then((result) => {
      setDebugInfo((result.lastDebugEvent as DebugInfo | undefined) ?? null);
    });
  }, []);

  async function toggleDebugMode() {
    if (!settings) return;
    const updated = { ...settings, debugMode: !settings.debugMode };
    setSettings(updated);
    await AsaCapsDatabase.putSettings(updated);
  }

  async function toggleLogUnknown() {
    if (!settings) return;
    const updated = { ...settings, logUnknownEvents: !settings.logUnknownEvents };
    setSettings(updated);
    await AsaCapsDatabase.putSettings(updated);
  }

  async function copyDebugInfo() {
    if (!debugInfo) return;
    await navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openCatalogue() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/catalogue/index.html') });
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={openCatalogue}
        className="w-full rounded-xl bg-accent px-3 py-2 font-medium text-white transition hover:bg-accent-hover"
      >
        Open Catalogue
      </button>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Search, export, and auto-backup the VIN → part number catalogue built up while working in ASA CAPS. The
        active vehicle, recent parts, and manual controls live in the sidebar on ASA CAPS pages.
      </p>

      <div className="flex flex-col gap-2 border-t border-border pt-4 dark:border-border-dark">
        <label className="flex items-center justify-between gap-2 text-sm text-neutral-900 dark:text-neutral-100">
          <span>Debug mode</span>
          <input
            type="checkbox"
            checked={settings?.debugMode ?? false}
            onChange={toggleDebugMode}
            className="h-4 w-4 rounded border-neutral-400 accent-accent"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-neutral-900 dark:text-neutral-100">
          <span>Log unknown clipboard events</span>
          <input
            type="checkbox"
            checked={settings?.logUnknownEvents ?? false}
            onChange={toggleLogUnknown}
            className="h-4 w-4 rounded border-neutral-400 accent-accent"
          />
        </label>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Off by default — unknown clipboard content may contain customer names, addresses, or phone numbers. When
          on, only a short preview and classification are logged, never used to build catalogue records.
        </p>
      </div>

      {settings?.debugMode && (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3 dark:border-border-dark">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Last clipboard event
          </h2>
          {!debugInfo ? (
            <p className="text-sm italic text-neutral-400 dark:text-neutral-600">No events captured yet.</p>
          ) : (
            <dl className="flex flex-col gap-1 text-xs">
              <div>
                <dt className="inline font-medium text-neutral-700 dark:text-neutral-300">Classification: </dt>
                <dd className="inline text-neutral-500 dark:text-neutral-400">{debugInfo.classification}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-neutral-700 dark:text-neutral-300">Detected VIN: </dt>
                <dd className="inline text-neutral-500 dark:text-neutral-400">{debugInfo.detectedVIN ?? '—'}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-neutral-700 dark:text-neutral-300">Detected part(s): </dt>
                <dd className="inline text-neutral-500 dark:text-neutral-400">
                  {debugInfo.detectedParts.length > 0
                    ? debugInfo.detectedParts
                        .map((p) => p.partNumber + (p.description ? ` (${p.description})` : ''))
                        .join(', ')
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-neutral-700 dark:text-neutral-300">Action: </dt>
                <dd className="inline text-neutral-500 dark:text-neutral-400">{debugInfo.action}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-neutral-700 dark:text-neutral-300">Raw text: </dt>
                <dd className="inline text-neutral-500 dark:text-neutral-400">
                  {debugInfo.rawText.slice(0, 200)}
                </dd>
              </div>
            </dl>
          )}
          <button
            type="button"
            onClick={copyDebugInfo}
            disabled={!debugInfo}
            className="rounded border border-border px-2 py-1 text-xs font-medium text-neutral-900 transition hover:bg-surface-subtle disabled:opacity-50 dark:border-border-dark dark:text-neutral-100 dark:hover:bg-surface-dark-subtle"
          >
            {copied ? 'Copied' : 'Copy Debug Information'}
          </button>
        </div>
      )}
    </div>
  );
}
