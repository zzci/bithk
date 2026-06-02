// Minimal list toolbar for surfaces with no chip filters: a search box that
// fills the available width on the left and a create button on the right (e.g.
// the contacts list). For lists that also need filter controls, use ListToolbar
// instead. Composes the shared SearchInput.

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
    <div className="flex items-center gap-2">
      <SearchInput
        value={search.value}
        onChange={search.onChange}
        placeholder={search.placeholder}
        className="flex-1"
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
