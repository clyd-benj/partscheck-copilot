import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CustomerRecord } from '@/types/customer';

/**
 * IndexedDB here is scoped to whichever origin opens it. This module must
 * only be imported from extension-origin contexts (the popup, the
 * background service worker) — never from the content script, which runs
 * in PartsCheck's page origin and would silently open a different,
 * page-scoped database. Content scripts read customers via a message to
 * the background worker instead (see src/services/messaging.ts).
 */
interface ToolkitDbSchema extends DBSchema {
  customers: {
    key: string;
    value: CustomerRecord;
  };
}

const DB_NAME = 'parts-interpreter-toolkit';
const DB_VERSION = 1;
const STORE_NAME = 'customers';

let dbPromise: Promise<IDBPDatabase<ToolkitDbSchema>> | undefined;

function getDb(): Promise<IDBPDatabase<ToolkitDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ToolkitDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'customerNumber' });
      },
    });
  }
  return dbPromise;
}

export async function replaceCustomerDatabase(records: CustomerRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.store.clear();
  await Promise.all(records.map((record) => tx.store.put(record)));
  await tx.done;
}

export async function getAllCustomers(): Promise<CustomerRecord[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function getCustomerCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_NAME);
}

export type AddCustomerResult = { ok: true } | { ok: false; error: 'duplicate-customer-number' };

/**
 * customerNumber is the store's key, so a plain put() would silently
 * overwrite an existing customer's name/address if the interpreter typed
 * in a number that already exists. Checking first turns that into a
 * reported conflict instead of a silent data-loss bug.
 */
export async function addCustomer(record: CustomerRecord): Promise<AddCustomerResult> {
  const db = await getDb();
  const existing = await db.get(STORE_NAME, record.customerNumber);
  if (existing) {
    return { ok: false, error: 'duplicate-customer-number' };
  }
  await db.put(STORE_NAME, record);
  return { ok: true };
}
