// Ships (yachts) data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend ship module (apps/api/src/modules/ship). The SOLE
// external ship identifier is the ship shortId (`id` on the views); the
// internal ULID is never exposed here. `baseProjectId` is the base project's
// *short* id so the frontend can render that project's drive and resolve its
// capabilities directly.
//
// A ship is thin: its permissions, files, and work orders all live on its base
// project. This client only covers the ship core + project binding (T5a);
// equipment and maintenance templates arrive with their own client modules in
// T5b.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ProjectView } from "./projects";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export type ShipLifecycleStage
  = | "design"
    | "building"
    | "sea_trial"
    | "in_service"
    | "maintenance"
    | "decommissioned";

export const SHIP_LIFECYCLE_STAGES: readonly ShipLifecycleStage[] = [
  "design",
  "building",
  "sea_trial",
  "in_service",
  "maintenance",
  "decommissioned",
];

export interface ShipView {
  readonly id: string; // ship shortId
  readonly code: string;
  readonly name: string;
  readonly status: ShipStatus;
  readonly lifecycleStage: ShipLifecycleStage;
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
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

/** A project bound to a ship, flagged when it is the (unbindable) base project. */
export interface ShipProjectView extends ProjectView {
  readonly isBase: boolean;
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
  list: (status: string, stage: string, page: number) => ["ships", "list", status, stage, page] as const,
  detail: (id: string) => ["ships", "detail", id] as const,
  projects: (id: string) => ["ships", id, "projects"] as const,
};

// ── Ships: queries ──

export interface ShipsQuery {
  readonly status?: ShipStatus | undefined;
  readonly lifecycleStage?: ShipLifecycleStage | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ShipsListResult {
  readonly data: readonly ShipView[];
  readonly meta: ListMeta;
}

export function useShips(query: ShipsQuery = {}) {
  const status = query.status;
  const stage = query.lifecycleStage;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return useQuery<ShipsListResult>({
    queryKey: shipKeys.list(status ?? "all", stage ?? "all", page),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      if (stage)
        params.set("lifecycleStage", stage);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await http<ApiListEnvelope<ShipView>>(`/ships?${params.toString()}`);
      return { data: res.data, meta: res.meta };
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

// ── Ships: mutations ──

export interface CreateShipInput {
  readonly name: string;
  readonly code?: string;
  readonly status?: ShipStatus;
  readonly lifecycleStage?: ShipLifecycleStage;
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
  readonly lifecycleStage?: ShipLifecycleStage;
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
