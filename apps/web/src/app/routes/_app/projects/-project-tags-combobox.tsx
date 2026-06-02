// Thin adapter retained so existing project call sites keep their import path.
// The implementation now lives in the shared `TagsCombobox`, which defaults to
// the "projects" i18n namespace — so this re-export is behaviorally identical to
// the former local copy.
export { TagsCombobox as ProjectTagsCombobox } from "@/shared/components/tags-combobox";
