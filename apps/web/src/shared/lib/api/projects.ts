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

export type ProjectStatus = "active" | "archived";

export const PROJECT_CAPABILITIES = [
  "project.manage",
  "members.manage",
  "roles.manage",
  "contacts.manage",
  "categories.manage",
  "procurement.view",
  "procurement.manage",
  "issue.manage",
] as const;
export type ProjectCapability = typeof PROJECT_CAPABILITIES[number];

export type ContactType = "supplier" | "client" | "subcontractor" | "other";
export const CONTACT_TYPES: readonly ContactType[] = ["supplier", "client", "subcontractor", "other"];
export type ContactStatus = "active" | "inactive";

export interface ProjectTag {
  readonly id: string;
  readonly name: string;
}

export interface ProjectView {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly description: string | null;
  readonly tags: readonly ProjectTag[];
  // Present only on the detail endpoint: the caller's effective capabilities.
  readonly capabilities?: readonly ProjectCapability[];
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ProjectMemberView {
  readonly id: string;
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly roleId: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRoleView {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly ProjectCapability[];
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectContactView {
  readonly id: string;
  readonly type: ContactType;
  readonly name: string;
  readonly contactPerson: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly rating: number | null;
  readonly status: ContactStatus;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProcurementCategoryView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
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
  list: (status: string, tag: string, page: number) => ["projects", "list", status, tag, page] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  members: (id: string) => ["projects", id, "members"] as const,
  roles: (id: string) => ["projects", id, "roles"] as const,
  contacts: (id: string, type: string) => ["projects", id, "contacts", type] as const,
  categories: (id: string) => ["projects", id, "categories"] as const,
  issues: (id: string, query: string) => ["projects", id, "issues", query] as const,
};

export const tagKeys = { all: ["tags"] as const };

// ── Tags ──

export function useTags() {
  return useQuery<readonly ProjectTag[]>({
    queryKey: tagKeys.all,
    queryFn: () => http<ApiEnvelope<readonly ProjectTag[]>>("/tags").then(r => r.data),
    staleTime: 30_000,
  });
}

// ── Projects: queries ──

export interface ProjectsQuery {
  readonly status?: ProjectStatus | undefined;
  readonly tagId?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ProjectsListResult {
  readonly data: readonly ProjectView[];
  readonly meta: ListMeta;
}

export function useProjects(query: ProjectsQuery = {}) {
  const status = query.status;
  const tagId = query.tagId;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return useQuery<ProjectsListResult>({
    queryKey: projectKeys.list(status ?? "all", tagId ?? "all", page),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      if (tagId)
        params.set("tagId", tagId);
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
  readonly code?: string | null;
  readonly description?: string | null;
  readonly status?: ProjectStatus;
  readonly tags?: readonly string[];
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
  readonly code?: string | null;
  readonly description?: string | null;
  readonly status?: ProjectStatus;
  readonly tags?: readonly string[];
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
  readonly roleId: string;
  readonly userId?: string;
  readonly displayName?: string;
  readonly title?: string;
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
  readonly roleId?: string;
  readonly displayName?: string | null;
  readonly title?: string | null;
  readonly userId?: string;
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

// ── Roles ──

export function useProjectRoles(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.roles(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ProjectRoleView[]>>(`/projects/${encodeURIComponent(projectId!)}/roles`).then(r => r.data),
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export interface RoleInput {
  readonly name?: string;
  readonly capabilities?: readonly ProjectCapability[];
}

export function useCreateProjectRole(): UseMutationResult<ProjectRoleView, Error, { projectId: string; name: string; capabilities?: readonly ProjectCapability[] }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProjectRoleView>>(`/projects/${encodeURIComponent(projectId)}/roles`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.roles(projectId) });
    },
  });
}

export function useUpdateProjectRole(): UseMutationResult<ProjectRoleView, Error, { projectId: string; roleId: string } & RoleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, roleId, ...body }) => http<ApiEnvelope<ProjectRoleView>>(
      `/projects/${encodeURIComponent(projectId)}/roles/${encodeURIComponent(roleId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.roles(projectId) });
    },
  });
}

export function useDeleteProjectRole(): UseMutationResult<null, Error, { projectId: string; roleId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, roleId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/roles/${encodeURIComponent(roleId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.roles(projectId) });
    },
  });
}

// ── Contacts ──

export function useProjectContacts(projectId: string | undefined, type?: ContactType) {
  return useQuery({
    queryKey: projectKeys.contacts(projectId ?? "", type ?? "all"),
    queryFn: () => {
      const qs = type ? `?type=${encodeURIComponent(type)}` : "";
      return http<ApiEnvelope<readonly ProjectContactView[]>>(`/projects/${encodeURIComponent(projectId!)}/contacts${qs}`).then(r => r.data);
    },
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export interface ContactInput {
  readonly type?: ContactType;
  readonly name?: string;
  readonly contactPerson?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string | null;
  readonly taxId?: string | null;
  readonly rating?: number | null;
  readonly status?: ContactStatus;
  readonly note?: string | null;
}

export function useCreateProjectContact(): UseMutationResult<ProjectContactView, Error, { projectId: string; type: ContactType; name: string } & ContactInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProjectContactView>>(`/projects/${encodeURIComponent(projectId)}/contacts`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "contacts"] });
    },
  });
}

export function useUpdateProjectContact(): UseMutationResult<ProjectContactView, Error, { projectId: string; contactId: string } & ContactInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, contactId, ...body }) => http<ApiEnvelope<ProjectContactView>>(
      `/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contactId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "contacts"] });
    },
  });
}

export function useDeleteProjectContact(): UseMutationResult<null, Error, { projectId: string; contactId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, contactId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contactId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "contacts"] });
    },
  });
}

// ── Procurement categories ──

export function useProcurementCategories(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: projectKeys.categories(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ProcurementCategoryView[]>>(`/projects/${encodeURIComponent(projectId!)}/procurement-categories`).then(r => r.data),
    enabled: enabled && !!projectId,
    staleTime: 5_000,
  });
}

export interface CategoryInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

export function useCreateProcurementCategory(): UseMutationResult<ProcurementCategoryView, Error, { projectId: string; name: string } & CategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, ...body }) => http<ApiEnvelope<ProcurementCategoryView>>(`/projects/${encodeURIComponent(projectId)}/procurement-categories`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.categories(projectId) });
    },
  });
}

export function useUpdateProcurementCategory(): UseMutationResult<ProcurementCategoryView, Error, { projectId: string; categoryId: string } & CategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, categoryId, ...body }) => http<ApiEnvelope<ProcurementCategoryView>>(
      `/projects/${encodeURIComponent(projectId)}/procurement-categories/${encodeURIComponent(categoryId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.categories(projectId) });
    },
  });
}

export function useDeleteProcurementCategory(): UseMutationResult<null, Error, { projectId: string; categoryId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, categoryId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/procurement-categories/${encodeURIComponent(categoryId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.categories(projectId) });
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
