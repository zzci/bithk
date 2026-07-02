// Policy (ReBAC) admin data layer: relation tuples, permission checks, and
// resource groups. Mirrors the backend policy module
// (apps/api/src/modules/policy). All requests go through the shared `http`
// client; the admin policies page consumes these hooks.

import type { UseMutationResult } from "@tanstack/react-query";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

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

interface EntityOption {
  readonly id: string;
  readonly name: string;
}

export interface EntitiesResponse {
  success: boolean;
  data: Record<string, EntityOption[]>;
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

// ── Query keys ──

export const policyKeys = {
  entities: ["policy", "entities"] as const,
  tuplesRoot: ["policy", "tuples"] as const,
  tuples: (namespace: string, page: number) => ["policy", "tuples", namespace, page] as const,
  resourceGroups: ["policy", "resource-groups"] as const,
  resourceGroupMembers: (groupId: string) => ["policy", "resource-groups", groupId, "members"] as const,
};

// ── Entities ──

export function useEntities() {
  return useQuery({
    queryKey: policyKeys.entities,
    queryFn: () => http<EntitiesResponse>("/policy/entities"),
    staleTime: 60_000,
  });
}

// ── Tuples ──

export interface TuplesQuery {
  // "" means no namespace filter.
  readonly namespace?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export function usePolicyTuples(query: TuplesQuery = {}) {
  const namespace = query.namespace ?? "";
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return useQuery({
    queryKey: policyKeys.tuples(namespace, page),
    queryFn: () => {
      const params = new URLSearchParams();
      if (namespace)
        params.set("namespace", namespace);
      params.set("page", String(page));
      params.set("limit", String(limit));
      return http<TuplesResponse>(`/policy/tuples?${params.toString()}`);
    },
    // Keep the prior page/filter rows on screen while the next query loads so
    // the table does not flash empty on page or namespace changes.
    placeholderData: keepPreviousData,
  });
}

export interface CreateTupleInput {
  readonly namespace: string;
  readonly objectId: string;
  readonly relation: string;
  readonly subjectNamespace: string;
  readonly subjectId: string;
  readonly subjectRelation: string | null;
}

export function useCreateTuple(): UseMutationResult<unknown, Error, CreateTupleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http("/policy/tuples", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.tuplesRoot });
    },
  });
}

export function useUpdateTuple(): UseMutationResult<unknown, Error, { id: string; relation: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http(`/policy/tuples/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.tuplesRoot });
    },
  });
}

export function useDeleteTuple(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http(`/policy/tuples/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.tuplesRoot });
    },
  });
}

// ── Permission check ──

export interface CheckPermissionInput {
  readonly namespace: string;
  readonly objectId: string;
  readonly relation: string;
  readonly subjectNamespace: string;
  readonly subjectId: string;
}

export function useCheckPermission(): UseMutationResult<CheckResponse, Error, CheckPermissionInput> {
  return useMutation({
    mutationFn: body => http<CheckResponse>("/policy/check", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  });
}

// ── Resource groups ──

export function useResourceGroups() {
  return useQuery({
    queryKey: policyKeys.resourceGroups,
    queryFn: () => http<ResourceGroupsResponse>("/policy/resource-groups"),
  });
}

export interface ResourceGroupInput {
  readonly name: string;
  readonly description: string | null;
}

export function useCreateResourceGroup(): UseMutationResult<unknown, Error, ResourceGroupInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http("/policy/resource-groups", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.resourceGroups });
    },
  });
}

export function useUpdateResourceGroup(): UseMutationResult<unknown, Error, { id: string } & ResourceGroupInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http(`/policy/resource-groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.resourceGroups });
    },
  });
}

export function useDeleteResourceGroup(): UseMutationResult<unknown, Error, ResourceGroup> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: group => http(`/policy/resource-groups/${group.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.resourceGroups });
    },
  });
}

export function useResourceGroupMembers(groupId: string) {
  return useQuery({
    queryKey: policyKeys.resourceGroupMembers(groupId),
    queryFn: () => http<ResourceGroupMembersResponse>(`/policy/resource-groups/${groupId}/members`),
  });
}

export function useRemoveResourceGroupMember(groupId: string): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: tupleId => http(`/policy/resource-groups/${groupId}/members/${tupleId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.resourceGroupMembers(groupId) });
    },
  });
}
