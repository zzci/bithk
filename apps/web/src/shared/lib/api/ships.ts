// Ships (yachts) data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend ship module (apps/api/src/modules/ship). The SOLE
// external ship identifier is the ship shortId (`id` on the views); the
// internal ULID is never exposed here. `baseProjectId` is the base project's
// *short* id so the frontend can render that project's drive and resolve its
// capabilities directly.
//
// A ship is thin: its permissions and files all live on its base project. This
// client covers the ship core + project binding, equipment, and worklists.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ProjectView } from "./projects";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

interface ApiListEnvelope<T> {
  readonly success: boolean;
  readonly data: readonly T[];
  readonly meta: { readonly total: number; readonly page: number; readonly limit: number };
}

// ── Types ──

export type ShipStatus = "active" | "archived";
export const SHIP_STATUSES: readonly ShipStatus[] = ["active", "archived"];

export type EquipmentStatus = "active" | "retired";
export const EQUIPMENT_STATUSES: readonly EquipmentStatus[] = ["active", "retired"];

// Ship tag reference (name resolved by the API). Ship-local mirror of the
// project tag shape; the ship tag vocabulary lives under `/tags?type=ship`.
export interface ShipTag {
  readonly id: string;
  readonly name: string;
}

export interface ShipView {
  readonly id: string; // ship shortId
  readonly code: string;
  readonly name: string;
  readonly status: ShipStatus;
  readonly tags: readonly ShipTag[];
  readonly baseProjectId: string | null; // base project shortId (for files/drive + caps)
  readonly model: string | null;
  readonly builder: string | null;
  readonly buildYear: number | null;
  readonly lengthOverall: number | null;
  readonly beam: number | null;
  readonly draft: number | null;
  readonly grossTonnage: number | null;
  readonly imoNumber: string | null;
  readonly mmsi: string | null;
  readonly callSign: string | null;
  readonly flagState: string | null;
  readonly registryPort: string | null;
  readonly ownerName: string | null;
  readonly description: string | null;
  readonly coverImageUrl: string | null;
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

/** A project bound to a ship, flagged when it is the (unbindable) base project. */
export interface ShipProjectView extends ProjectView {
  readonly isBase: boolean;
}

export interface ShipEquipmentView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly serialNumber: string | null;
  readonly location: string | null;
  readonly installedAt: string | null;
  readonly status: EquipmentStatus;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorklistView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResolvedWorklist {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
}

export interface IssueReferenceView {
  readonly id: string;
  readonly refType: string;
  readonly refId: string;
  readonly label: string | null;
  readonly createdAt: string;
  readonly worklist?: ResolvedWorklist | null;
}

export interface ListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

// ── Query keys ──

export const shipKeys = {
  all: ["ships"] as const,
  lists: () => ["ships", "list"] as const,
  list: (status: string, tagId: string, page: number, q?: string) =>
    q ? ["ships", "list", status, tagId, page, q] as const : ["ships", "list", status, tagId, page] as const,
  tags: () => ["ships", "tags"] as const,
  count: (status: string) => ["ships", "count", status] as const,
  detail: (id: string) => ["ships", "detail", id] as const,
  projects: (id: string) => ["ships", id, "projects"] as const,
  equipment: (id: string) => ["ships", id, "equipment"] as const,
  worklists: (id: string) => ["ships", id, "worklists"] as const,
  globalWorklists: () => ["worklists", "global"] as const,
  issueReferences: (issueId: string) => ["issues", issueId, "references"] as const,
};

// ── Ships: queries ──

export interface ShipsQuery {
  readonly status?: ShipStatus | undefined;
  readonly tagId?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  /** Server-side name/code search; reaches the whole fleet, not just the page. */
  readonly q?: string | undefined;
}

export interface ShipsListResult {
  readonly data: readonly ShipView[];
  readonly meta: ListMeta;
}

export function useShips(query: ShipsQuery = {}) {
  const status = query.status;
  const tagId = query.tagId;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const q = query.q?.trim() || undefined;
  return useQuery<ShipsListResult>({
    queryKey: shipKeys.list(status ?? "all", tagId ?? "all", page, q),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      if (tagId)
        params.set("tagId", tagId);
      if (q)
        params.set("q", q);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await http<ApiListEnvelope<ShipView>>(`/ships?${params.toString()}`);
      return { data: res.data, meta: res.meta };
    },
    // Keep the prior page/status/search results on screen while the next query
    // loads so the list does not flash empty on filter or search changes.
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

/**
 * Fleet-wide ship count for a status (omit for the whole fleet), read from the
 * list endpoint's `meta.total` with a minimal payload. Keyed by status only, so
 * the KPI numbers stay stable across pagination and search of the main list.
 */
export function useShipCount(status?: ShipStatus) {
  return useQuery<number>({
    queryKey: shipKeys.count(status ?? "all"),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      params.set("page", "1");
      params.set("limit", "1");
      const res = await http<ApiListEnvelope<ShipView>>(`/ships?${params.toString()}`);
      return res.meta.total;
    },
    staleTime: 5_000,
  });
}

export function useShip(id: string | undefined) {
  return useQuery({
    queryKey: shipKeys.detail(id ?? ""),
    queryFn: () => http<ApiEnvelope<ShipView>>(`/ships/${encodeURIComponent(id!)}`).then(r => r.data),
    enabled: !!id,
    staleTime: 5_000,
  });
}

// Selectable ship-tag vocabulary (type=ship), usage-count ordered. Drives the
// ship list single-select tag filter and the create/edit tag editor.
export function useShipTags() {
  return useQuery<readonly ShipTag[]>({
    queryKey: shipKeys.tags(),
    queryFn: () => http<ApiEnvelope<readonly ShipTag[]>>("/tags?type=ship").then(r => r.data),
    staleTime: 30_000,
  });
}

// ── Ships: mutations ──

export interface CreateShipInput {
  readonly name: string;
  readonly code?: string;
  readonly status?: ShipStatus;
  readonly tags?: readonly string[];
}

export function useCreateShip(): UseMutationResult<ShipView, Error, CreateShipInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => http<ApiEnvelope<ShipView>>("/ships", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: shipKeys.lists() }),
  });
}

export interface UpdateShipInput {
  readonly name?: string;
  readonly code?: string;
  readonly status?: ShipStatus;
  readonly tags?: readonly string[];
  readonly model?: string | null;
  readonly builder?: string | null;
  readonly buildYear?: number | null;
  readonly lengthOverall?: number | null;
  readonly beam?: number | null;
  readonly draft?: number | null;
  readonly grossTonnage?: number | null;
  readonly imoNumber?: string | null;
  readonly mmsi?: string | null;
  readonly callSign?: string | null;
  readonly flagState?: string | null;
  readonly registryPort?: string | null;
  readonly ownerName?: string | null;
  readonly description?: string | null;
}

export function useUpdateShip(): UseMutationResult<ShipView, Error, { id: string } & UpdateShipInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => http<ApiEnvelope<ShipView>>(`/ships/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: shipKeys.lists() });
    },
  });
}

export function useSetShipCover(): UseMutationResult<ShipView, Error, { id: string; file: File }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      return http<ApiEnvelope<ShipView>>(`/ships/${encodeURIComponent(id)}/cover-image`, {
        method: "POST",
        body: fd,
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: shipKeys.lists() });
    },
  });
}

export function useRemoveShipCover(): UseMutationResult<ShipView, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<ShipView>>(`/ships/${encodeURIComponent(id)}/cover-image`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: shipKeys.lists() });
    },
  });
}

export function useDeleteShip(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/ships/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: shipKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: shipKeys.lists() });
    },
  });
}

// ── Ship ↔ project binding ──

export function useShipProjects(shipId: string | undefined) {
  return useQuery({
    queryKey: shipKeys.projects(shipId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ShipProjectView[]>>(`/ships/${encodeURIComponent(shipId!)}/projects`).then(r => r.data),
    enabled: !!shipId,
    staleTime: 5_000,
  });
}

export function useBindShipProject(): UseMutationResult<readonly ShipProjectView[], Error, { shipId: string; projectShortId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, projectShortId }) => http<ApiEnvelope<readonly ShipProjectView[]>>(`/ships/${encodeURIComponent(shipId)}/projects`, {
      method: "POST",
      body: JSON.stringify({ projectShortId }),
    }).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.projects(shipId) });
    },
  });
}

export function useUnbindShipProject(): UseMutationResult<null, Error, { shipId: string; projectShortId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, projectShortId }) => http<ApiEnvelope<null>>(
      `/ships/${encodeURIComponent(shipId)}/projects/${encodeURIComponent(projectShortId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.projects(shipId) });
    },
  });
}

// ── Ship equipment ──

export interface EquipmentInput {
  readonly name?: string;
  readonly category?: string | null;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly serialNumber?: string | null;
  readonly location?: string | null;
  readonly installedAt?: string | null;
  readonly status?: EquipmentStatus;
  readonly note?: string | null;
}

export function useShipEquipment(shipId: string | undefined) {
  return useQuery({
    queryKey: shipKeys.equipment(shipId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ShipEquipmentView[]>>(`/ships/${encodeURIComponent(shipId!)}/equipment`).then(r => r.data),
    enabled: !!shipId,
    staleTime: 5_000,
  });
}

export function useCreateShipEquipment(): UseMutationResult<ShipEquipmentView, Error, { shipId: string; name: string } & EquipmentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, ...body }) => http<ApiEnvelope<ShipEquipmentView>>(`/ships/${encodeURIComponent(shipId)}/equipment`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.equipment(shipId) });
    },
  });
}

export function useUpdateShipEquipment(): UseMutationResult<ShipEquipmentView, Error, { shipId: string; equipmentId: string } & EquipmentInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, equipmentId, ...body }) => http<ApiEnvelope<ShipEquipmentView>>(
      `/ships/${encodeURIComponent(shipId)}/equipment/${encodeURIComponent(equipmentId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.equipment(shipId) });
    },
  });
}

export function useDeleteShipEquipment(): UseMutationResult<null, Error, { shipId: string; equipmentId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, equipmentId }) => http<ApiEnvelope<null>>(
      `/ships/${encodeURIComponent(shipId)}/equipment/${encodeURIComponent(equipmentId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.equipment(shipId) });
    },
  });
}

// ── Worklists ──

export interface WorklistInput {
  readonly name?: string;
  readonly category?: string | null;
  readonly checklist?: string | null;
  readonly precautions?: string | null;
}

export function useShipWorklists(shipId: string | undefined) {
  return useQuery({
    queryKey: shipKeys.worklists(shipId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly WorklistView[]>>(`/ships/${encodeURIComponent(shipId!)}/worklists`).then(r => r.data),
    enabled: !!shipId,
    staleTime: 5_000,
  });
}

export function useGlobalWorklists(enabled: boolean) {
  return useQuery({
    queryKey: shipKeys.globalWorklists(),
    queryFn: () => http<ApiEnvelope<readonly WorklistView[]>>("/worklists").then(r => r.data),
    enabled,
    staleTime: 5_000,
  });
}

export function useCreateShipWorklist(): UseMutationResult<WorklistView, Error, { shipId: string; fromGlobalId?: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, ...body }) => http<ApiEnvelope<WorklistView>>(`/ships/${encodeURIComponent(shipId)}/worklists`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.worklists(shipId) });
    },
  });
}

export function useUpdateShipWorklist(): UseMutationResult<WorklistView, Error, { shipId: string; worklistId: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, worklistId, ...body }) => http<ApiEnvelope<WorklistView>>(
      `/ships/${encodeURIComponent(shipId)}/worklists/${encodeURIComponent(worklistId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.worklists(shipId) });
    },
  });
}

export function useDeleteShipWorklist(): UseMutationResult<null, Error, { shipId: string; worklistId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, worklistId }) => http<ApiEnvelope<null>>(
      `/ships/${encodeURIComponent(shipId)}/worklists/${encodeURIComponent(worklistId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.worklists(shipId) });
    },
  });
}

// ── Global worklists (admin knowledge base) ──
// CRUD over the global worklist templates (shipId NULL) that ships copy from.
// All routes are admin-gated on the API; each mutation refreshes the shared
// global-worklist list used by the ship worklist copy picker.

export function useCreateGlobalWorklist(): UseMutationResult<WorklistView, Error, { name: string } & WorklistInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<WorklistView>>("/worklists", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.globalWorklists() });
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
      void queryClient.invalidateQueries({ queryKey: shipKeys.globalWorklists() });
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
      void queryClient.invalidateQueries({ queryKey: shipKeys.globalWorklists() });
    },
  });
}

export function useIssueReferences(issueId: string | undefined) {
  return useQuery({
    queryKey: shipKeys.issueReferences(issueId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly IssueReferenceView[]>>(`/issues/${encodeURIComponent(issueId!)}/references`).then(r => r.data),
    enabled: !!issueId,
    staleTime: 5_000,
  });
}
