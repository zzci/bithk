// UI-side constants and helpers shared by the admin policies tabs. The API
// types, query keys, and hooks live in the shared data layer
// (`@/shared/lib/api/policy`); re-exported here for the sibling tab files.

import type { EntitiesResponse } from "@/shared/lib/api/policy";
import { useMemo } from "react";

export type {
  CheckResponse,
  EntitiesResponse,
  RelationTuple,
  ResourceGroup,
  ResourceGroupMembersResponse,
  ResourceGroupsResponse,
  TuplesResponse,
} from "@/shared/lib/api/policy";

export { useEntities } from "@/shared/lib/api/policy";

export const NAMESPACES = ["group", "resource_group"] as const;
export const RELATIONS: Record<string, string[]> = {
  group: ["member"],
  resource_group: ["viewer", "editor", "manager", "admin"],
};
export const SUBJECT_NAMESPACES = ["user", "group"] as const;

export function handleSelect(setter: (v: string) => void) {
  return (value: string | null) => {
    if (value !== null)
      setter(value);
  };
}

export function useEntityNameMap(entities: EntitiesResponse | undefined) {
  return useMemo(() => {
    const map = new Map<string, string>();
    if (!entities?.data)
      return map;
    for (const [, items] of Object.entries(entities.data)) {
      for (const item of items) {
        map.set(item.id, item.name);
      }
    }
    return map;
  }, [entities]);
}
