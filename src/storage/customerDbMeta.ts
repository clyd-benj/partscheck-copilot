import type { CustomerDbMeta } from '@/types/customer';

/**
 * Small import metadata (timestamp, source filename) lives in
 * chrome.storage.local rather than IndexedDB — it's a single tiny record
 * the popup reads on open, and chrome.storage is directly available there
 * without the origin complications IndexedDB has for content scripts.
 * Customer *count* is read live from IndexedDB instead of cached here, so
 * it can't drift after an add from the sidebar.
 */
const META_KEY = 'customerDbMeta';

export async function getCustomerDbMeta(): Promise<CustomerDbMeta | null> {
  const result = await chrome.storage.local.get(META_KEY);
  return (result[META_KEY] as CustomerDbMeta | undefined) ?? null;
}

export async function setCustomerDbMeta(meta: CustomerDbMeta): Promise<void> {
  await chrome.storage.local.set({ [META_KEY]: meta });
}
