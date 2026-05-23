// Editable raw-markdown source view for the Milkdown editor.
//
// Milkdown has no document-level source plugin — its CodeMirror integration
// only powers code blocks. So the source view is a standalone CodeMirror 6
// instance (CodeMirror is already bundled transitively via Milkdown's
// code-block component). It mounts only while the editor is in source mode,
// seeded from the current markdown; edits stream back through `onChange`, and
// `milkdown-editor.tsx` pushes the final buffer into Milkdown on toggle-back.

import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface MarkdownSourceViewProps {
  // Initial markdown to load. Read once on mount — the parent re-mounts this
  // component on every entry into source mode, so a fresh instance always
  // reflects the latest WYSIWYG content.
  readonly initialValue: string;
  readonly onChange: (value: string) => void;
}

export function MarkdownSourceView({ initialValue, onChange }: MarkdownSourceViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Read the seed once via a ref: the parent re-mounts this component on every
  // entry into source mode, so the mount-time value is always current and the
  // effect can stay dependency-free without re-seeding mid-edit.
  const initialValueRef = useRef(initialValue);
  // Pin onChange so the editor factory (runs once) sees the latest callback
  // without re-creating the CodeMirror instance.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host)
      return;
    const view = new EditorView({
      parent: host,
      doc: initialValueRef.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    view.focus();
    return () => view.destroy();
  }, []);

  return <div ref={hostRef} className="md-source-view" />;
}

export default MarkdownSourceView;
