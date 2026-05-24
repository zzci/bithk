// Free-text tag editor: type a tag and press Enter or comma to add it; click
// the × on a badge to remove it. Emits a deduplicated `string[]`.

import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { addTag, removeTag } from "./-project-form-logic";

interface TagsInputProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
}

export function TagsInput({ value, onChange }: TagsInputProps) {
  const { t } = useTranslation("projects");
  const [draft, setDraft] = useState("");

  const add = (raw: string) => onChange(addTag(value, raw));
  const remove = (name: string) => onChange(removeTag(value, name));

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
      setDraft("");
    }
    else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  };

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map(tag => (
            <Badge key={tag} variant="secondary" className="gap-1 text-xs">
              {tag}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("tags.remove", { name: tag })}
                onClick={() => remove(tag)}
                className="ml-0.5 rounded-sm hover:text-destructive"
              >
                <X className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
            setDraft("");
          }
        }}
        placeholder={t("tags.placeholder")}
      />
    </div>
  );
}
