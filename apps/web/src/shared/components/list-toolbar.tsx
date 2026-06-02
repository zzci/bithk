// Shared list toolbar shell: filters on the left, search + create on the right,
// on one row that wraps on narrow widths. Standardizes the layout shared by the
// project / ship / work-order (issue) list toolbars. The left-side filter
// controls differ per list (status chips, tag filter, type select), so they are
// passed as a `filters` slot; the search box and create button are unified here.

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "@/shared/components/search-input";
import { Button } from "@/shared/components/ui/button";

interface ListToolbarSearch {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  /** Width override for the search box. Defaults to "w-full sm:w-64". */
  readonly className?: string;
}

interface ListToolbarCreate {
  /** Button text. Defaults to the generic "New" (common.create). */
  readonly label?: string;
  readonly onClick: () => void;
}

interface ListToolbarProps {
  /** Left-side filter controls (status chips, tag filter, type select, …). */
  readonly filters?: ReactNode;
  readonly search: ListToolbarSearch;
  /** Create button, rendered after the search box. Omit when the user lacks rights. */
  readonly create?: ListToolbarCreate;
}

export function ListToolbar({ filters, search, create }: ListToolbarProps) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{filters}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SearchInput
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          className={search.className ?? "w-full sm:w-64"}
        />
        {create && (
          <Button onClick={create.onClick}>
            <Plus aria-hidden="true" />
            {create.label ?? t("common.create")}
          </Button>
        )}
      </div>
    </div>
  );
}
