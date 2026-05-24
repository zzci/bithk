// Editable CodeMirror 6 surface for code/text files in the drive file-preview
// dialog. Mirrors the read-only `code-preview` (same grammar-by-filename and
// theme) but enables editing and streams changes back through `onChange`.
//
// The document is seeded once on mount: the dialog re-mounts this component on
// each entry into edit mode and unmounts it on cancel/save, so the mount-time
// value is always current and parent re-renders (driven by the streamed edits)
// never reset the cursor — the same pattern as `markdown-source-view`.

import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { loadLanguageExtension } from "./cm-language";

import "./code-mirror.css";

interface CodeEditorProps {
  readonly value: string;
  // Original filename — picks the Lezer grammar by extension.
  readonly filename: string;
  readonly isDark: boolean;
  readonly onChange: (value: string) => void;
}

export function CodeEditor({ value, filename, isDark, onChange }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Seed once (see file header); pin onChange so the factory sees the latest
  // callback without re-creating the editor.
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host)
      return;
    let view: EditorView | undefined;
    let cancelled = false;

    void (async () => {
      const extensions = [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            onChangeRef.current(update.state.doc.toString());
        }),
        // basicSetup ships defaultHighlightStyle (light) as a fallback; layer
        // oneDark on top for dark mode to match the read-only preview.
        ...(isDark ? [oneDark] : [syntaxHighlighting(defaultHighlightStyle)]),
      ];
      const lang = await loadLanguageExtension(filename);
      if (lang)
        extensions.push(lang);
      if (cancelled)
        return;
      view = new EditorView({
        parent: host,
        doc: initialValueRef.current,
        extensions,
      });
      view.focus();
    })();

    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [filename, isDark]);

  return <div ref={hostRef} className="cm-code-surface text-sm" />;
}

export default CodeEditor;
