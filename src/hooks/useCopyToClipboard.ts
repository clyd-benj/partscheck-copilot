import { useCallback, useState } from 'react';

export function useCopyToClipboard(resetDelayMs = 1500) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    (value: string) => {
      void navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), resetDelayMs);
      });
    },
    [resetDelayMs],
  );

  return { copied, copy };
}
