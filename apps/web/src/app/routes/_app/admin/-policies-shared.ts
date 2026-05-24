import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { http } from "@/shared/lib/http";

export interface RelationTuple {
  id: string;
  namespace: string;
  objectId: string;
  relation: string;
  subjectNamespace: string;
  subjectId: string;
  subjectRelation: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface TuplesResponse {
  success: boolean;
  data: RelationTuple[];
  meta: { total: number; page: number; limit: number };
}

export interface CheckResponse {
  success: boolean;
  data: { allowed: boolean; resolvedThrough: string[] };
}

export interface EntityOption {
  readonly id: string;
  readonly name: string;
}

export interface EntitiesResponse {
  success: boolean;
  data: Record<string, EntityOption[]>;
}

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

export function useEntities() {
  return useQuery({
    queryKey: ["policy-entities"],
    queryFn: () => http<EntitiesResponse>("/policy/entities"),
    staleTime: 60_000,
  });
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

export interface ResourceGroup {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface ResourceGroupsResponse {
  success: boolean;
  data: ResourceGroup[];
}

export interface ResourceGroupMember {
  tupleId: string;
  namespace: string;
  objectId: string;
  objectName: string | null;
}

export interface ResourceGroupMembersResponse {
  success: boolean;
  data: ResourceGroupMember[];
}
