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
import type { IssueStatus, ProjectView } from "./projects";
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

export type EquipmentStatus = "active" | "retired";
export const EQUIPMENT_STATUSES: readonly EquipmentStatus[] = ["active", "retired"];

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

export interface MaintenanceTemplateView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResolvedMaintenanceTemplate {
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
  readonly template?: ResolvedMaintenanceTemplate | null;
}

export interface ShipMaintenanceOrderView {
  readonly id: string;
  readonly title: string;
  readonly status: IssueStatus;
  readonly projectId: string;
  readonly templateRefId: string;
  readonly referenceId: string;
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
  equipment: (id: string) => ["ships", id, "equipment"] as const,
  maintenanceTemplates: (id: string) => ["ships", id, "maintenance-templates"] as const,
  globalMaintenanceTemplates: () => ["maintenance-templates", "global"] as const,
  maintenanceOrders: (id: string) => ["ships", id, "maintenance-orders"] as const,
  issueReferences: (issueId: string) => ["issues", issueId, "references"] as const,
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

// ── Maintenance templates + work orders ──

export interface MaintenanceTemplateInput {
  readonly name?: string;
  readonly category?: string | null;
  readonly checklist?: string | null;
  readonly precautions?: string | null;
}

export function useShipMaintenanceTemplates(shipId: string | undefined) {
  return useQuery({
    queryKey: shipKeys.maintenanceTemplates(shipId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly MaintenanceTemplateView[]>>(`/ships/${encodeURIComponent(shipId!)}/maintenance-templates`).then(r => r.data),
    enabled: !!shipId,
    staleTime: 5_000,
  });
}

export function useGlobalMaintenanceTemplates(enabled: boolean) {
  return useQuery({
    queryKey: shipKeys.globalMaintenanceTemplates(),
    queryFn: () => http<ApiEnvelope<readonly MaintenanceTemplateView[]>>("/maintenance-templates").then(r => r.data),
    enabled,
    staleTime: 5_000,
  });
}

export function useCreateShipMaintenanceTemplate(): UseMutationResult<MaintenanceTemplateView, Error, { shipId: string; fromGlobalId?: string } & MaintenanceTemplateInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, ...body }) => http<ApiEnvelope<MaintenanceTemplateView>>(`/ships/${encodeURIComponent(shipId)}/maintenance-templates`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.maintenanceTemplates(shipId) });
    },
  });
}

export function useUpdateShipMaintenanceTemplate(): UseMutationResult<MaintenanceTemplateView, Error, { shipId: string; templateId: string } & MaintenanceTemplateInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, templateId, ...body }) => http<ApiEnvelope<MaintenanceTemplateView>>(
      `/ships/${encodeURIComponent(shipId)}/maintenance-templates/${encodeURIComponent(templateId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.maintenanceTemplates(shipId) });
      void queryClient.invalidateQueries({ queryKey: shipKeys.maintenanceOrders(shipId) });
    },
  });
}

export function useDeleteShipMaintenanceTemplate(): UseMutationResult<null, Error, { shipId: string; templateId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipId, templateId }) => http<ApiEnvelope<null>>(
      `/ships/${encodeURIComponent(shipId)}/maintenance-templates/${encodeURIComponent(templateId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { shipId }) => {
      void queryClient.invalidateQueries({ queryKey: shipKeys.maintenanceTemplates(shipId) });
      void queryClient.invalidateQueries({ queryKey: shipKeys.maintenanceOrders(shipId) });
    },
  });
}

export function useShipMaintenanceOrders(shipId: string | undefined) {
  return useQuery({
    queryKey: shipKeys.maintenanceOrders(shipId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ShipMaintenanceOrderView[]>>(`/ships/${encodeURIComponent(shipId!)}/maintenance-orders`).then(r => r.data),
    enabled: !!shipId,
    staleTime: 5_000,
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
