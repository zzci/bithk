// Tags live as a single row below the title. With no tags, renders a
// solo "+ 添加标签" trigger; with one or more, renders chips and a
// trailing "+" chip as the add affordance. Add is always a chip-shaped
// inline input — committing on Enter / comma, cancelling on Esc / blur.

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export function TagsRow({
  tags,
  onChange,
}: {
  readonly tags: readonly string[];
  readonly onChange: (tags: readonly string[]) => void;
}) {
  const { t } = useTranslation("documents");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing)
      inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const raw = value.trim().toLowerCase().replace(/[^\w-]/g, "");
    setValue("");
    if (!raw) {
      setEditing(false);
      return;
    }
    if (!tags.includes(raw))
      onChange([...tags, raw]);
    setEditing(false);
  };

  const inlineInput = (
    <Input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => {
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          commit();
        }
        else if (e.key === "Escape") {
          e.preventDefault();
          setValue("");
          setEditing(false);
        }
      }}
      placeholder={t("tagsPlaceholder")}
      className="h-6 w-28 rounded-full border-dashed bg-transparent px-2.5 text-[11px] font-medium placeholder:text-muted-foreground/60 focus-visible:bg-accent/40 focus-visible:ring-0"
    />
  );

  if (tags.length === 0) {
    if (editing)
      return <ul className="flex flex-wrap items-center gap-1.5"><li>{inlineInput}</li></ul>;
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setEditing(true)}
        className="gap-1 rounded-full border border-dashed border-border px-2.5 text-[11px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="size-3" strokeWidth={2.25} />
        {t("tagsPlaceholder")}
      </Button>
    );
  }

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {tags.map(tag => (
        <li key={tag}>
          <span className="inline-flex h-6 items-center gap-0.5 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-medium text-muted-foreground">
            <span className="text-foreground/35">#</span>
            <span>{tag}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onChange(tags.filter(t2 => t2 !== tag))}
              className="ml-0.5 size-3 rounded-full text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground"
              aria-label="Remove tag"
            >
              <X className="size-2" />
            </Button>
          </span>
        </li>
      ))}
      <li>
        {editing
          ? inlineInput
          : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setEditing(true)}
                className="rounded-full border border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                aria-label={t("tagsPlaceholder")}
              >
                <Plus className="size-3" strokeWidth={2.25} />
              </Button>
            )}
      </li>
    </ul>
  );
}
