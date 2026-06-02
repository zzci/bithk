// Shared, pure tag-list helpers. Extracted so the project and contact forms (and
// any future tag editor) share one trimmed/case-insensitive-dedup implementation
// instead of each copying it.

/** Append a trimmed tag, ignoring blanks and case-insensitive duplicates. */
export function addTag(list: readonly string[], raw: string): readonly string[] {
  const name = raw.trim();
  if (!name)
    return list;
  if (list.some(tag => tag.toLowerCase() === name.toLowerCase()))
    return list;
  return [...list, name];
}

/** Remove a tag by exact name match. */
export function removeTag(list: readonly string[], name: string): readonly string[] {
  return list.filter(tag => tag !== name);
}
