// Read-only syntax-highlighted preview for code/text files in the drive
// file-preview dialog.
//
// CodeMirror 6 is already bundled (the markdown source view + Milkdown's
// code-block component both use it), so we reuse its Lezer grammars here
// instead of shipping shiki's TextMate grammars plus the oniguruma wasm.
// Grammars resolve from the filename via the shared `loadLanguageExtension`
// helper; an unmatched file renders as un-highlighted plain text.

import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { loadLanguageExtension } from "./cm-language";

import "./code-mirror.css";

interface CodePreviewProps {
  readonly code: string;
  // Original filename — picks the Lezer grammar by extension.
  readonly filename: string;
  readonly isDark: boolean;
}

export function CodePreview({ code, filename, isDark }: CodePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host)
      return;
    let view: EditorView | undefined;
    let cancelled = false;

    void (async () => {
      const extensions = [
        lineNumbers(),
        EditorView.lineWrapping,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
      ];
      const lang = await loadLanguageExtension(filename);
      if (lang)
        extensions.push(lang);
      if (cancelled)
        return;
      view = new EditorView({
        parent: host,
        state: EditorState.create({ doc: code, extensions }),
      });
    })();

    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [code, filename, isDark]);

  return <div ref={hostRef} className="cm-code-surface text-sm" />;
}

export default CodePreview;
