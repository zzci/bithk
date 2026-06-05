// The ONE shared file-picker used across every upload surface in the app, so
// upload is centrally managed and the accept-type policy is a single prop
// instead of a per-input string scattered through the tree. It owns nothing but
// the hidden <input type="file"> mechanics — the native picker, the value reset
// after a change (so re-picking the same file still fires), and the File[] hand
// off. Each surface keeps its own data flow (attachment mutation, drive queue,
// cover/avatar handler); only the input is unified here.
//
// Two trigger styles, pick whichever keeps the caller's markup intact:
//   • `children` — rendered as the clickable trigger (caller passes its own
//     <Button>/icon); the wrapper relays the click to the hidden input.
//   • `inputRef` — forwarded to the internal <input> so callers that already
//     own an input ref keep their existing trigger + reset logic (e.g. the
//     shared attachment-upload hook, the drive toolbar, the file browser).

import type { ChangeEvent, ReactNode, Ref } from "react";
import { useCallback, useRef } from "react";

const ACCEPT_IMAGE = "image/*";

export interface FileUploadButtonProps {
  /**
   * Accept policy. `"any"` (default) sets NO `accept` attribute so the OS
   * picker accepts every file type; `"image"` restricts to `image/*`.
   */
  readonly accept?: "any" | "image";
  /**
   * Explicit DOM `accept` string for special cases (e.g. `".csv,text/csv"`).
   * Takes precedence over `accept`.
   */
  readonly acceptOverride?: string;
  readonly multiple?: boolean;
  /** Pick a directory instead of files (sets webkitdirectory/directory). */
  readonly directory?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: (files: File[]) => void;
  /**
   * Optional trigger. When provided it is rendered as the clickable control
   * that opens the picker, so callers keep their own button/icon styling.
   */
  readonly children?: ReactNode;
  /**
   * Forwarded to the internal `<input>`, letting callers that already own an
   * input ref drive the picker (`.click()`) and its reset themselves.
   */
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function FileUploadButton({
  accept = "any",
  acceptOverride,
  multiple = false,
  directory = false,
  disabled = false,
  onSelect,
  children,
  inputRef,
}: FileUploadButtonProps) {
  const internalRef = useRef<HTMLInputElement | null>(null);

  const setRef = useCallback((node: HTMLInputElement | null) => {
    internalRef.current = node;
    // Directory selection is not expressible as a React attribute; set the
    // non-standard webkitdirectory/directory props straight on the element.
    if (node && directory) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
    if (typeof inputRef === "function")
      inputRef(node);
    else if (inputRef)
      (inputRef as { current: HTMLInputElement | null }).current = node;
  }, [directory, inputRef]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.currentTarget.files;
    const files = picked ? Array.from(picked) : [];
    // Reset before firing so re-picking the same file still triggers change.
    event.currentTarget.value = "";
    if (files.length > 0)
      onSelect(files);
  };

  const openPicker = () => {
    if (!disabled)
      internalRef.current?.click();
  };

  // "any" intentionally omits the accept attribute (an OA accepts anything);
  // acceptOverride wins, then the image policy.
  const acceptAttr = acceptOverride ?? (accept === "image" ? ACCEPT_IMAGE : undefined);

  return (
    <>
      {children != null && (
        // The child is the real focusable control; this wrapper only relays its
        // click (including keyboard-activation clicks) to the hidden input.
        <span className="contents" onClick={openPicker}>
          {children}
        </span>
      )}
      <input
        ref={setRef}
        type="file"
        accept={acceptAttr}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}
