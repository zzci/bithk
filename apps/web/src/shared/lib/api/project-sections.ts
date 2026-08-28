// Project section data layer: the surfaces a project exposes once it mounts
// the `ship-profile`, `equipment` or `worklist` sections (PLAN-108).
//
// Mirrors the backend ship module (apps/api/src/modules/ship), which now hangs
// every one of its routes off `/projects/:projectId/*` and answers 404 while
// the owning section is not mounted. There is no ship record any more: a ship
// is a PROJECT created with the `ship` preset, so name / status / cover / tags
// come from the project payload (see `projects.ts`) and only the maritime
// particulars live in the ship-profile view.
//
// The SOLE external identifier here is the project shortId. Query keys stay
// project-scoped (`["projects", projectId, …]`) so a section's cache is dropped
// together with its project.
//
// Global worklists (`/worklists`) and their tag vocabulary are the admin-owned
// knowledge base the `worklist` section copies from; they are keyed globally,
// not per project, and live at the bottom of this file.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData, ApiRow } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes are aliases of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.
// Frontend-only types (inputs, query params) stay hand-written below.

/** Vessel particulars — the `ship-profile` section's payload. */
export type ShipProfileView = ApiData<"getProjectsByProjectIdShipProfile">;

/**
 * Ship lifecycle status. Distinct from the project's own active/archived
 * `status`: this one describes the vessel, not the record.
 */
export type ShipStatus = ShipProfileView["shipStatus"];
export const SHIP_STATUSES: readonly ShipStatus[] = ["under_construction", "active", "underway", "in_maintenance", "laid_up", "retired"];

export type ProjectEquipmentView = ApiRow<"getProjectsByProjectIdEquipment">;
export type EquipmentStatus = ProjectEquipmentView["status"];
export const EQUIPMENT_STATUSES: readonly EquipmentStatus[] = ["active", "retired"];

/** A project's own bilingual equipment-category vocabulary. */
export type ProjectEquipmentCategory = ApiRow<"getProjectsByProjectIdEquipmentCategories">;

// Worklists carry tags (not a single category); the API resolves names. The
// tag vocabulary lives under `/tags?type=worklist`. Project and global
// worklists share one shape (GET /worklists rows are identical).
export type WorklistView = ApiRow<"getProjectsByProjectIdWorklists">;

// Selectable tag vocabulary row from GET /tags (usage-count ordered).
type TagRow = ApiRow<"getTags">;

// ── Query keys ──

export const projectSectionKeys = {
  shipProfile: (projectId: string) => ["projects", projectId, "ship-profile"] as const,
  equipment: (projectId: string) => ["projects", projectId, "equipment"] as const,
  equipmentCategories: (projectId: string) => ["projects", projectId, "equipment-categories"] as const,
  worklists: (projectId: string) => ["projects", projectId, "worklists"] as const,
  worklistTags: () => ["tags", "worklist"] as const,
  globalWorklists: () => ["worklists", "global"] as const,
};

// ── `ship-profile` section ──

export interface ShipProfileInput {
  /** Hull number: mutable and case-preserving, unlike the project code. */
  readonly hullNumber?: string;
  readonly shipStatus?: ShipStatus;
  readonly model?: string | null;
  readonly builder?: string | null;
  readonly buildYear?: number | null;
  readonly lengthOverall?: number | null;
  readonly beam?: number | null;
  readonly draft?: number | null;
  readonly airDraft?: number | null;
  readonly grossTonnage?: number | null;
  readonly imoNumber?: string | null;
  readonly mmsi?: string | null;
  readonly callSign?: string | null;
  readonly flagState?: string | null;
  readonly registryPort?: string | null;
  readonly ownerName?: string | null;
}

export function useShipProfile(projectId: string | undefined) {
  return useQuery({
    queryKey: projectSectionKeys.shipProfile(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<ShipProfileView>>(`/projects/${encodeURIComponent(projectId!)}/ship-profile`).then(r => r.data),
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export function useUpdateShipProfile(): UseMutationResult<ShipProfileView, Error, { projectId: string } & ShipProfileInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ShipProfileView>>(`/projects/${encodeURIComponent(projectId)}/ship-profile`, {
      method: "PUT",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.shipProfile(projectId) });
    },
  });
}

// ── `equipment` section ──

export interface EquipmentInput {
  readonly name?: string;
  readonly categoryId?: string | null;
  readonly manufacturerId?: string | null;
  readonly model?: string | null;
  readonly serialNumber?: string | null;
  readonly location?: string | null;
  readonly installedAt?: string | null;
  readonly status?: EquipmentStatus;
  readonly note?: string | null;
}

export function useProjectEquipment(projectId: string | undefined) {
  return useQuery({
    queryKey: projectSectionKeys.equipment(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ProjectEquipmentView[]>>(`/projects/${encodeURIComponent(projectId!)}/equipment`).then(r => r.data),
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export function useCreateProjectEquipment(): UseMutationResult<ProjectEquipmentView, Error, { projectId: string; name: string } & EquipmentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProjectEquipmentView>>(`/projects/${encodeURIComponent(projectId)}/equipment`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.equipment(projectId) });
    },
  });
}

export function useUpdateProjectEquipment(): UseMutationResult<ProjectEquipmentView, Error, { projectId: string; equipmentId: string } & EquipmentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, equipmentId, ...body }) => http<ApiEnvelope<ProjectEquipmentView>>(
      `/projects/${encodeURIComponent(projectId)}/equipment/${encodeURIComponent(equipmentId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.equipment(projectId) });
    },
  });
}

export function useDeleteProjectEquipment(): UseMutationResult<null, Error, { projectId: string; equipmentId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, equipmentId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/equipment/${encodeURIComponent(equipmentId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.equipment(projectId) });
    },
  });
}

// ── `equipment` section: per-project category vocabulary ──
//
// Each project owns its own bilingual category set, copied from the global
// template when the section is provisioned. Mirrors the per-project
// procurement-categories hooks in `projects.ts`.

export interface ProjectEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

function equipmentCategoriesPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/equipment-categories`;
}

export function useProjectEquipmentCategories(projectId: string | undefined) {
  return useQuery<readonly ProjectEquipmentCategory[]>({
    queryKey: projectSectionKeys.equipmentCategories(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ProjectEquipmentCategory[]>>(equipmentCategoriesPath(projectId!)).then(r => r.data),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useCreateProjectEquipmentCategory(projectId: string): UseMutationResult<ProjectEquipmentCategory, Error, ProjectEquipmentCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<ProjectEquipmentCategory>>(equipmentCategoriesPath(projectId), {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.equipmentCategories(projectId) });
    },
  });
}

export function useUpdateProjectEquipmentCategory(projectId: string): UseMutationResult<ProjectEquipmentCategory, Error, { id: string } & Partial<ProjectEquipmentCategoryInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<ProjectEquipmentCategory>>(`${equipmentCategoriesPath(projectId)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.equipmentCategories(projectId) });
    },
  });
}

export function useDeleteProjectEquipmentCategory(projectId: string): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`${equipmentCategoriesPath(projectId)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.equipmentCategories(projectId) });
    },
  });
}

// ── `worklist` section ──

export interface WorklistInput {
  readonly name?: string;
  /** Tag NAMES; the backend upserts the vocabulary by name. */
  readonly tags?: readonly string[];
  readonly checklist?: string | null;
  readonly precautions?: string | null;
}

// Normalize at the boundary: coerce `tags` to an array so a contract-violating
// or stale-cache row can never reach the worklist UI (which maps `tags`
// unconditionally) without one. Mirrors the issue-list normalization.
function normalizeWorklistTags(worklist: WorklistView): WorklistView {
  return { ...worklist, tags: worklist.tags ?? [] };
}

/**
 * List a project's own worklists, optionally narrowed to those carrying ANY of
 * the given tag ids (OR / union semantics). `tagIds` is optional so callers
 * that do not filter (`useProjectWorklists(projectId)`) stay simple.
 */
export function useProjectWorklists(projectId: string | undefined, tagIds: readonly string[] = []) {
  // Sort to keep the query key stable regardless of selection order.
  const tagKey = tagIds.length === 0 ? "all" : [...tagIds].sort().join(",");
  return useQuery({
    queryKey: [...projectSectionKeys.worklists(projectId ?? ""), tagKey] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      // Repeated `tagId=` params: backend reads via `c.req.queries("tagId")`.
      for (const id of tagIds)
        params.append("tagId", id);
      const qs = params.toString();
      const base = `/projects/${encodeURIComponent(projectId!)}/worklists`;
      return http<ApiEnvelope<readonly WorklistView[]>>(qs ? `${base}?${qs}` : base).then(r => r.data.map(normalizeWorklistTags));
    },
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export function useCreateProjectWorklist(): UseMutationResult<WorklistView, Error, { projectId: string; fromGlobalId?: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<WorklistView>>(`/projects/${encodeURIComponent(projectId)}/worklists`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklists(projectId) });
      // A new worklist may carry new tag names; refresh the filter vocabulary.
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklistTags() });
    },
  });
}

export function useUpdateProjectWorklist(): UseMutationResult<WorklistView, Error, { projectId: string; worklistId: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, worklistId, ...body }) => http<ApiEnvelope<WorklistView>>(
      `/projects/${encodeURIComponent(projectId)}/worklists/${encodeURIComponent(worklistId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklists(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklistTags() });
    },
  });
}

export function useDeleteProjectWorklist(): UseMutationResult<null, Error, { projectId: string; worklistId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, worklistId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/worklists/${encodeURIComponent(worklistId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklists(projectId) });
    },
  });
}

// Selectable worklist-tag vocabulary (type=worklist), usage-count ordered.
// Drives the worklist tab tag filter and the worklist tag editor.
export function useWorklistTags() {
  return useQuery<readonly TagRow[]>({
    queryKey: projectSectionKeys.worklistTags(),
    queryFn: () => http<ApiEnvelope<readonly TagRow[]>>("/tags?type=worklist").then(r => r.data),
    staleTime: 30_000,
  });
}

// ── Global worklists (admin knowledge base) ──
// CRUD over the global worklist templates (`/worklists`, no owning project)
// that a project's `worklist` section copies from. All routes are admin-gated
// on the API; each mutation refreshes the shared global-worklist list used by
// the worklist copy picker.

export function useGlobalWorklists(enabled: boolean) {
  return useQuery({
    queryKey: projectSectionKeys.globalWorklists(),
    queryFn: () => http<ApiEnvelope<readonly WorklistView[]>>("/worklists").then(r => r.data.map(normalizeWorklistTags)),
    enabled,
    staleTime: 5_000,
  });
}

export function useCreateGlobalWorklist(): UseMutationResult<WorklistView, Error, { name: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<WorklistView>>("/worklists", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.globalWorklists() });
      // A global template may carry new tag names; refresh the vocabulary.
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklistTags() });
    },
  });
}

export function useUpdateGlobalWorklist(): UseMutationResult<WorklistView, Error, { id: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<WorklistView>>(`/worklists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.globalWorklists() });
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.worklistTags() });
    },
  });
}

export function useDeleteGlobalWorklist(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/worklists/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectSectionKeys.globalWorklists() });
    },
  });
}
