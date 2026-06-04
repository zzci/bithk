// Search + create bar for list surfaces. The search box is BOUNDED
// (w-full sm:w-64) rather than fill-width, so this bar can sit as the RIGHT
// cluster of a `justify-between` row paired with a ListFilter on the left.
// Used standalone for lists without chip filters (e.g. contacts), or as the
// right side of a filter+search row. Composes the shared SearchInput.

import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "@/shared/components/search-input";
import { Button } from "@/shared/components/ui/button";

interface SearchCreateBarSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
}

interface SearchCreateBarCreate {
  /** Button text. Defaults to the generic "New" (common.create). */
  readonly label?: string;
  readonly onClick: () => void;
}

interface SearchCreateBarProps {
  readonly search: SearchCreateBarSearch;
  /** Create button on the right. Omit when the user lacks rights. */
  readonly create?: SearchCreateBarCreate;
}

export function SearchCreateBar({ search, create }: SearchCreateBarProps) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={search.value}
        onChange={search.onChange}
        placeholder={search.placeholder}
        className="w-full sm:w-64"
      />
      {create && (
        <Button onClick={create.onClick}>
          <Plus aria-hidden="true" />
          {create.label ?? t("common.create")}
        </Button>
      )}
    </div>
  );
}
