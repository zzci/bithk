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
import type { ApiEnvelope, ApiListEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type ProjectStatus = "active" | "archived";

export const PROJECT_CAPABILITIES = [
  "issue.view",
  "issue.comment",
  "issue.manage",
  "procurement.view",
  "procurement.comment",
  "procurement.manage",
  "files.view",
  "files.manage",
  "categories.manage",
  "members.manage",
  "roles.manage",
  "project.manage",
] as const;
export type ProjectCapability = typeof PROJECT_CAPABILITIES[number];

export interface ProjectTag {
  readonly id: string;
  readonly name: string;
  // Number of projects referencing this tag (computed by the API). Drives the
  // most-used-first ordering of the list filter.
  readonly usageCount: number;
}

export interface ProjectView {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly description: string | null;
  readonly tags: readonly ProjectTag[];
  readonly coverImageUrl: string | null;
  // The ship this project is the base project of, or null for a standalone
  // project. Mirrors the backend ProjectView; optional here so existing fixtures
  // that predate the field stay valid (the API always supplies it).
  readonly shipId?: string | null;
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
  readonly kind?: "owner" | "guest" | null;
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

export type IssueStatus = "todo" | "working" | "review" | "done" | "cancel";
export type IssuePriority = "low" | "medium" | "high" | "urgent";

// Tag reference carried on issue list rows and detail (name resolved by the API).
interface IssueTagRef {
  readonly id: string;
  readonly name: string;
}

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
  readonly tags: readonly IssueTagRef[];
  // Pin state from the shared item base. `pinnedAt` is the ISO stamp when pinned,
  // NULL otherwise; both surface the project overview Pin area.
  readonly pinned: boolean;
  readonly pinnedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

interface ListMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

// ── Query keys ──

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => ["projects", "list"] as const,
  list: (status: string, tag: string, q: string, page: number, limit: number) => ["projects", "list", status, tag, q, page, limit] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  members: (id: string) => ["projects", id, "members"] as const,
  roles: (id: string) => ["projects", id, "roles"] as const,
  categories: (id: string) => ["projects", id, "categories"] as const,
  issues: (id: string, query: string) => ["projects", id, "issues", query] as const,
  referenceableWorklists: (id: string) => ["projects", id, "referenceable-worklists"] as const,
};

export const issueKeys = {
  references: (issueId: string) => ["issues", issueId, "references"] as const,
};

export const tagKeys = {
  all: ["tags"] as const,
  issue: ["tags", "issue"] as const,
};

// ── Tags ──

export function useTags() {
  return useQuery<readonly ProjectTag[]>({
    queryKey: tagKeys.all,
    queryFn: () => http<ApiEnvelope<readonly ProjectTag[]>>("/tags").then(r => r.data),
    staleTime: 30_000,
  });
}

// Selectable issue-tag vocabulary (type=issue), usage-count ordered. Drives the
// issues list multi-select tag filter.
export function useIssueTags() {
  return useQuery<readonly ProjectTag[]>({
    queryKey: tagKeys.issue,
    queryFn: () => http<ApiEnvelope<readonly ProjectTag[]>>("/tags?type=issue").then(r => r.data),
    staleTime: 30_000,
  });
}

// ── Projects: queries ──

export interface ProjectsQuery {
  readonly status?: ProjectStatus | undefined;
  // Full-text search over project name/code (matched server-side, whole-list).
  readonly q?: string | undefined;
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
  const q = query.q;
  const tagId = query.tagId;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return useQuery<ProjectsListResult>({
    queryKey: projectKeys.list(status ?? "all", tagId ?? "all", q ?? "", page, limit),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      if (q)
        params.set("q", q);
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

export function useSetProjectCover(): UseMutationResult<ProjectView, Error, { id: string; file: File }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      return http<ApiEnvelope<ProjectView>>(`/projects/${encodeURIComponent(id)}/cover-image`, {
        method: "POST",
        body: fd,
      }).then(r => r.data);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(data.id) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

export function useRemoveProjectCover(): UseMutationResult<ProjectView, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<ProjectView>>(`/projects/${encodeURIComponent(id)}/cover-image`, {
      method: "DELETE",
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
  // Union (OR) filter: an issue matches when it carries ANY of these tag ids.
  readonly tagIds?: readonly string[] | undefined;
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
  // Repeatable tagId params; sorted so the cache key stays stable regardless of
  // selection order (the backend union semantics are order-independent).
  if (query.tagIds && query.tagIds.length > 0) {
    for (const tagId of [...query.tagIds].sort())
      params.append("tagIds", tagId);
  }
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
      // Normalize at the boundary: coerce `tags` to an array so a contract-
      // violating or stale-cache row can never reach the UI without one.
      return { data: res.data.map(r => ({ ...r, tags: r.tags ?? [] })), meta: res.meta };
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
  readonly references?: readonly IssueReferenceInput[];
}

interface IssueReferenceInput {
  readonly refType: "worklist" | "url" | "document";
  readonly refId: string;
  readonly label?: string | null;
}

// ── Referenceable worklists & issue references ──

// A worklist (ship knowledge-base entry) that a work order can reference. Mirrors
// the backend WorklistView. `checklist` is free-form text that MAY hold a JSON
// array of strings; callers render it defensively.
export interface ReferenceableWorklist {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Resolved worklist payload carried on a worklist reference. Null when the soft
// reference is dangling (target worklist deleted).
export interface ReferencedWorklist {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
}

// A generic reference attached to an issue. For `worklist` refs the `worklist`
// field carries the resolved payload (or null when dangling).
export interface IssueReferenceView {
  readonly id: string;
  readonly refType: "worklist" | "url" | "document";
  readonly refId: string;
  readonly label: string | null;
  readonly createdAt: string;
  readonly worklist?: ReferencedWorklist | null;
}

// The worklists a project may reference: its ship's worklists (empty when the
// project is not a ship base project) plus the global knowledge base.
export function useReferenceableWorklists(projectId: string | undefined) {
  return useQuery<{ ship: readonly ReferenceableWorklist[]; global: readonly ReferenceableWorklist[] }>({
    queryKey: projectKeys.referenceableWorklists(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<{ ship: readonly ReferenceableWorklist[]; global: readonly ReferenceableWorklist[] }>>(
      `/projects/${encodeURIComponent(projectId!)}/referenceable-worklists`,
    ).then(r => r.data),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

// References attached to an issue (by issue short id). Used by the detail panel
// to surface referenced worklists.
export function useIssueReferences(issueId: string | undefined) {
  return useQuery<readonly IssueReferenceView[]>({
    queryKey: issueKeys.references(issueId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly IssueReferenceView[]>>(
      `/issues/${encodeURIComponent(issueId!)}/references`,
    ).then(r => r.data),
    enabled: !!issueId,
    staleTime: 5_000,
  });
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
