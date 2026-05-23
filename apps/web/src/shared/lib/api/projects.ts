// Projects data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend projects module (apps/api/src/modules/project). The
// SOLE external project identifier is the project shortId (`id` on the
// views); the internal ULID is never exposed here.
//
// Project issues (work orders) live in this module too, scoped under a
// project. Procurement lives in `procurement.ts`.
//
// All requests go through the shared `http` client so credentials and the
// CSRF header on mutating methods stay consistent.

import type { UseMutationResult } from "@tanstack/react-query";
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

export type ProjectStatus = "active" | "archived" | "closed";
export type ProjectMemberType = "internal" | "external";
export type ProjectRole = "pm" | "member";

export interface ProjectView {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly description: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ProjectMemberView {
  readonly id: string;
  readonly memberType: ProjectMemberType;
  readonly role: ProjectRole;
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly externalRef: string | null;
  readonly supplierInfo: string | null;
  readonly canViewProcurement: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type IssueStatus = "open" | "in_progress" | "done" | "cancelled";
export type IssuePriority = "low" | "medium" | "high" | "urgent";

export interface ProjectIssueRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: IssueStatus;
  readonly priority: IssuePriority;
  readonly creatorId: string;
  readonly assigneeId: string | null;
  readonly assigneeMemberId: string | null;
  readonly projectId: string;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

// ── Query keys ──

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => ["projects", "list"] as const,
  list: (status: string, page: number) => ["projects", "list", status, page] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  members: (id: string) => ["projects", id, "members"] as const,
  issues: (id: string, query: string) => ["projects", id, "issues", query] as const,
};

// ── Projects: queries ──

export interface ProjectsQuery {
  readonly status?: ProjectStatus | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ProjectsListResult {
  readonly data: readonly ProjectView[];
  readonly meta: ListMeta;
}

export function useProjects(query: ProjectsQuery = {}) {
  const status = query.status;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return useQuery<ProjectsListResult>({
    queryKey: projectKeys.list(status ?? "all", page),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await http<ApiListEnvelope<ProjectView>>(`/projects?${params.toString()}`);
      return { data: res.data, meta: res.meta };
    },
    staleTime: 5_000,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ""),
    queryFn: () => http<ApiEnvelope<ProjectView>>(`/projects/${encodeURIComponent(id!)}`).then(r => r.data),
    enabled: !!id,
    staleTime: 5_000,
  });
}

// ── Projects: mutations ──

export interface CreateProjectInput {
  readonly name: string;
  readonly code?: string | undefined;
  readonly status?: ProjectStatus | undefined;
  readonly description?: string | undefined;
  readonly startDate?: string | undefined;
  readonly endDate?: string | undefined;
}

export function useCreateProject(): UseMutationResult<ProjectView, Error, CreateProjectInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => http<ApiEnvelope<ProjectView>>("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
  });
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly code?: string | null | undefined;
  readonly status?: ProjectStatus | undefined;
  readonly description?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
}

export function useUpdateProject(): UseMutationResult<ProjectView, Error, { id: string } & UpdateProjectInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => http<ApiEnvelope<ProjectView>>(`/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

export function useDeleteProject(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// ── Members ──

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.members(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ProjectMemberView[]>>(`/projects/${encodeURIComponent(projectId!)}/members`).then(r => r.data),
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export interface AddProjectMemberInput {
  readonly memberType: ProjectMemberType;
  readonly role?: ProjectRole;
  readonly userId?: string;
  readonly displayName?: string;
  readonly externalRef?: string;
  readonly supplierInfo?: string;
  readonly canViewProcurement?: boolean;
}

export function useAddProjectMember(): UseMutationResult<ProjectMemberView, Error, { projectId: string } & AddProjectMemberInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProjectMemberView>>(`/projects/${encodeURIComponent(projectId)}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) });
    },
  });
}

export interface UpdateProjectMemberInput {
  readonly role?: ProjectRole;
  readonly canViewProcurement?: boolean;
  readonly displayName?: string;
  readonly externalRef?: string;
  readonly supplierInfo?: string;
  readonly userId?: string;
  readonly memberType?: ProjectMemberType;
}

export function useUpdateProjectMember(): UseMutationResult<ProjectMemberView, Error, { projectId: string; memberId: string } & UpdateProjectMemberInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, memberId, ...body }) => http<ApiEnvelope<ProjectMemberView>>(
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) });
    },
  });
}

export function useRemoveProjectMember(): UseMutationResult<null, Error, { projectId: string; memberId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, memberId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) });
    },
  });
}

// ── Project issues (work orders) ──

export interface ProjectIssuesQuery {
  readonly q?: string | undefined;
  readonly status?: IssueStatus | undefined;
  readonly priority?: IssuePriority | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ProjectIssuesResult {
  readonly data: readonly ProjectIssueRow[];
  readonly meta: ListMeta;
}

function issuesQueryString(query: ProjectIssuesQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.status)
    params.set("status", query.status);
  if (query.priority)
    params.set("priority", query.priority);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export function useProjectIssues(projectId: string | undefined, query: ProjectIssuesQuery = {}) {
  const qs = issuesQueryString(query);
  return useQuery<ProjectIssuesResult>({
    queryKey: projectKeys.issues(projectId ?? "", qs),
    queryFn: async () => {
      const res = await http<ApiListEnvelope<ProjectIssueRow>>(`/projects/${encodeURIComponent(projectId!)}/issues?${qs}`);
      return { data: res.data, meta: res.meta };
    },
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export interface CreateProjectIssueInput {
  readonly title: string;
  readonly description?: string;
  readonly status?: IssueStatus;
  readonly priority?: IssuePriority;
  readonly assigneeMemberId?: string;
  readonly dueDate?: string;
}

export function useCreateProjectIssue(): UseMutationResult<ProjectIssueRow, Error, { projectId: string } & CreateProjectIssueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProjectIssueRow>>(`/projects/${encodeURIComponent(projectId)}/issues`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.issues(projectId, "") });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "issues"] });
    },
  });
}
