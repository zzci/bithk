// Resolve a CodeMirror 6 language extension from a filename.
//
// Shared by the read-only code preview and the editable code editor so both
// pick the same Lezer grammar. Grammars load on demand via
// `@codemirror/language-data`, matched by the file's extension; an unmatched
// or failed grammar resolves to `null`, leaving the surface as plain text.

import type { Extension } from "@codemirror/state";

import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

export async function loadLanguageExtension(filename: string): Promise<Extension | null> {
  const desc = LanguageDescription.matchFilename(languages, filename);
  if (!desc)
    return null;
  try {
    return (await desc.load()).extension;
  }
  catch {
    // Unsupported / failed grammar: fall back to plain text.
    return null;
  }
}
