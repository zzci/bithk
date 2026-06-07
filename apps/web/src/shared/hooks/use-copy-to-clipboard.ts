import { useCallback, useState } from "react";

/**
 * Clipboard helper with a transient "copied" flag for button feedback.
 * Writes via `navigator.clipboard.writeText`, flips `copied` to true on
 * success, then resets it to false after `resetMs`.
 */
export function useCopyToClipboard(resetMs = 2000): {
  readonly copied: boolean;
  readonly copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(setCopied, resetMs, false);
    });
  }, [resetMs]);
  return { copied, copy };
}
