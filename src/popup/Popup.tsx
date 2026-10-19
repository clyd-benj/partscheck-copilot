import { useState } from 'react';
import { CustomerDatabaseTab } from './CustomerDatabaseTab';
import { AsaCapsTab } from './AsaCapsTab';

type Tab = 'customer-database' | 'asa-caps';

export function Popup() {
  const [tab, setTab] = useState<Tab>('customer-database');

  return (
    <div className="flex w-[380px] flex-col gap-4 bg-surface p-4 font-sans text-sm text-neutral-900 dark:bg-surface-dark dark:text-neutral-100">
      <header>
        <h1 className="text-base font-semibold tracking-tight">Parts Interpreter Toolkit</h1>
      </header>

      <div className="flex gap-1 rounded-xl bg-surface-subtle p-1 dark:bg-surface-dark-subtle">
        <TabButton active={tab === 'customer-database'} onClick={() => setTab('customer-database')}>
          Customer Database
        </TabButton>
        <TabButton active={tab === 'asa-caps'} onClick={() => setTab('asa-caps')}>
          ASA CAPS
        </TabButton>
      </div>

      {tab === 'customer-database' ? <CustomerDatabaseTab /> : <AsaCapsTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-surface text-neutral-900 shadow-sm dark:bg-surface-dark dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
      }`}
    >
      {children}
    </button>
  );
}
