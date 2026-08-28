// Projects data layer: types, query keys, and TanStack Query hooks.
//
// Mirrors the backend projects module (apps/api/src/modules/project). The
// SOLE external project identifier is the project shortId (`id` on the
// views); the internal ULID is never exposed here.
//
// A project is a core record (metadata, members, roles, sub-projects) plus a
// set of MOUNTED SECTIONS (PLAN-108). `ProjectView.sections` carries the keys
// currently mounted; every section surface answers 404 while its key is
// absent. Section payloads live in `project-sections.ts`.
//
// Project issues (work orders) live in this module too, scoped under a
// project. Procurement lives in `procurement.ts`.
//
// All requests go through the shared `http` client so credentials and the
// CSRF header on mutating methods stay consistent.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData, ApiResponse, ApiRow } from "./_generated";
import type { ApiEnvelope, ApiListEnvelope } from "./types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes are aliases of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.
// Frontend-only types (inputs, query params) stay hand-written below.

// Full project detail from GET /projects/{id} — includes the caller's
// effective capabilities.
type ProjectDetail = ApiData<"getProjectsById">;

export type ProjectCapability = ProjectDetail["capabilities"][number];

// Runtime capability list (drives the role-editor checkboxes); `satisfies`
// keeps every entry in lockstep with the generated union.
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
] as const satisfies readonly ProjectCapability[];

// ── Sections ──
//
// Mirrors the backend section registry (apps/api `project/section.registry.ts`).
// The API keeps `sections` a plain `string[]`, so these two literals are the
// frontend's only source of truth for which keys exist and which preset mounts
// which — keep them in lockstep with `PROJECT_PRESETS` on the backend.

export const PROJECT_SECTION_KEYS = [
  "issues",
  "procurement",
  "files",
  "ship-profile",
  "equipment",
  "worklist",
] as const;

export type ProjectSectionKey = typeof PROJECT_SECTION_KEYS[number];

/** Create-time presets: which sections a new project mounts, in tab order. */
export const PROJECT_PRESETS = {
  general: ["issues", "procurement", "files"],
  ship: ["issues", "procurement", "files", "ship-profile", "equipment", "worklist"],
} as const satisfies Record<string, readonly ProjectSectionKey[]>;

export type ProjectPreset = keyof typeof PROJECT_PRESETS;

export const DEFAULT_PROJECT_PRESET: ProjectPreset = "general";

/**
 * Raw per-section create payload, keyed by section key — the `sectionData` the
 * backend hands to each section's provision hook (e.g.
 * `{ "ship-profile": { hullNumber: "…" } }`). Each section validates its own
 * slice server-side, so this stays deliberately untyped per key.
 */
export type ProjectSectionData = Readonly<Record<string, unknown>>;

/** True when `key` is currently mounted on the project. */
export function hasSection(project: Pick<ProjectView, "sections"> | undefined, key: ProjectSectionKey): boolean {
  return project?.sections.includes(key) ?? false;
}

// Selectable tag vocabulary row from GET /tags (usage-count ordered; drives
// the most-used-first ordering of the list filter).
export type ProjectTag = ApiRow<"getTags">;

// One view type serves the list and detail callers: the list row plus the
// detail-only `capabilities` (composed from the two generated shapes).
export type ProjectView = ApiRow<"getProjects"> & {
  readonly capabilities?: ProjectDetail["capabilities"];
};
export type ProjectStatus = ProjectView["status"];

export type ProjectMemberView = ApiRow<"getProjectsByIdMembers">;

export type ProjectRoleView = ApiRow<"getProjectsByIdRoles">;

export type ProcurementCategoryView = ApiRow<"getProjectsByIdProcurementCategories">;

export type ProjectIssueRow = ApiRow<"getProjectsByProjectIdIssues">;
export type IssueStatus = ProjectIssueRow["status"];
export type IssuePriority = ProjectIssueRow["priority"];

type ListMeta = ApiResponse<"getProjects">["meta"];

// ── Query keys ──

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => ["projects", "list"] as const,
  list: (status: string, tag: string, q: string, section: string, page: number, limit: number) => ["projects", "list", status, tag, q, section, page, limit] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
  members: (id: string) => ["projects", id, "members"] as const,
  roles: (id: string) => ["projects", id, "roles"] as const,
  categories: (id: string) => ["projects", id, "categories"] as const,
  // Root of every issues LIST key for a project — invalidate this to drop all
  // filtered/paginated variants at once.
  issuesRoot: (id: string) => ["projects", id, "issues"] as const,
  issues: (id: string, query: string) => ["projects", id, "issues", query] as const,
  issue: (projectId: string, issueId: string) => ["projects", projectId, "issue", issueId] as const,
  referenceableWorklists: (id: string) => ["projects", id, "referenceable-worklists"] as const,
  children: (id: string) => ["projects", id, "children"] as const,
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
  // Union (OR) filter: a project matches when it carries ANY of these tag ids.
  readonly tagIds?: readonly string[] | undefined;
  // Narrow to projects that MOUNT this section. Filtered in SQL before
  // pagination, so `meta.total` counts the narrowed set — never re-filter the
  // fetched page client-side, which would only ever see page 1's rows.
  readonly section?: ProjectSectionKey | undefined;
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
  const tagIds = query.tagIds;
  const section = query.section;
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  // Sorted, comma-joined tag ids keep the cache key stable regardless of
  // selection order (the backend union semantics are order-independent).
  const tagsKey = tagIds && tagIds.length > 0 ? [...tagIds].sort().join(",") : "all";
  return useQuery<ProjectsListResult>({
    queryKey: projectKeys.list(status ?? "all", tagsKey, q ?? "", section ?? "all", page, limit),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status)
        params.set("status", status);
      if (q)
        params.set("q", q);
      if (section)
        params.set("section", section);
      // Repeatable tagIds params, sorted so the request matches the cache key.
      if (tagIds && tagIds.length > 0) {
        for (const id of [...tagIds].sort())
          params.append("tagIds", id);
      }
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await http<ApiListEnvelope<ProjectView>>(`/projects?${params.toString()}`);
      return { data: res.data, meta: res.meta };
    },
    // Keep the prior page/filter results on screen while the next query loads
    // so the list does not flash empty on page, filter, or search changes.
    placeholderData: keepPreviousData,
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
  /** Which sections the new project mounts; defaults to `general` server-side. */
  readonly preset?: ProjectPreset;
  /** Short id of the parent project — creates the project as a sub-project. */
  readonly parentId?: string;
  readonly sectionData?: ProjectSectionData;
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

// ── Sections: mount / unmount ──
//
// Both routes answer with the project's whole section list in tab order.
// Mounting also PROVISIONS the section (it may copy a global template), so
// "mounted" and "its seeded rows exist" stay equivalent; unmounting is refused
// with 409 `SECTION_NOT_EMPTY` while the section still holds data.

export function useMountProjectSection(): UseMutationResult<readonly string[], Error, { projectId: string; key: ProjectSectionKey; sectionData?: Record<string, unknown> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, key, sectionData }) => http<ApiEnvelope<readonly string[]>>(
      `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(key)}`,
      { method: "PUT", body: JSON.stringify(sectionData ? { sectionData } : {}) },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      // The detail payload carries `sections`, and the list rows do too.
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

export function useUnmountProjectSection(): UseMutationResult<readonly string[], Error, { projectId: string; key: ProjectSectionKey }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, key }) => http<ApiEnvelope<readonly string[]>>(
      `/projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// ── Sub-projects (children) ──
//
// The hierarchy is exactly ONE level deep: a project that has a parent cannot
// itself become a parent (the API answers 422). Unlinking never deletes the
// child — it keeps its own members, roles and sections.

export function useProjectChildren(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.children(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ProjectView[]>>(`/projects/${encodeURIComponent(projectId!)}/children`).then(r => r.data),
    enabled: !!projectId,
    staleTime: 5_000,
  });
}

export function useCreateProjectChild(): UseMutationResult<ProjectView, Error, { parentId: string } & CreateProjectInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, ...body }) => http<ApiEnvelope<ProjectView>>(`/projects/${encodeURIComponent(parentId)}/children`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: (_data, { parentId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.children(parentId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

/** Link an existing project as a child of `parentId`. */
export function useLinkProjectChild(): UseMutationResult<ProjectView, Error, { parentId: string; childId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, childId }) => http<ApiEnvelope<ProjectView>>(
      `/projects/${encodeURIComponent(parentId)}/children/${encodeURIComponent(childId)}`,
      { method: "PUT" },
    ).then(r => r.data),
    onSuccess: (_data, { parentId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.children(parentId) });
    },
  });
}

export function useUnlinkProjectChild(): UseMutationResult<null, Error, { parentId: string; childId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, childId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(parentId)}/children/${encodeURIComponent(childId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { parentId }) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.children(parentId) });
    },
  });
}

// ── Members ──

// A user (real or virtual) that can be added as a project member. Returned by
// GET /account/assignable-users — the unified candidate source for the member
// picker (distinct from /account/visible-users, which is real-users only).
export type AssignableUser = ApiRow<"getAccountAssignableUsers">;

/** Assignable users (real + virtual) for the member-add picker. */
export function useAssignableUsers() {
  return useQuery<readonly AssignableUser[]>({
    queryKey: ["account", "assignable-users"],
    queryFn: () => http<ApiListEnvelope<AssignableUser>>("/account/assignable-users").then(r => r.data),
    staleTime: 30_000,
  });
}

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
  // The unified users row (real or virtual) to add as a member.
  readonly userId: string;
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
  readonly title?: string | null;
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
    // Keep the prior page/filter rows on screen while the next query loads so
    // the issues list does not flash empty on page or filter changes.
    placeholderData: keepPreviousData,
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

// A worklist (knowledge-base entry) that a work order can reference.
// `checklist` is free-form text that MAY hold a JSON array of strings; callers
// render it defensively. Project-owned and global entries share one shape.
export type ReferenceableWorklist = ApiData<"getProjectsByProjectIdReferenceableWorklists">["ship"][number];

// A generic reference attached to an issue. For `worklist` refs the `worklist`
// field carries the resolved payload (or null when dangling).
export type IssueReferenceView = ApiRow<"getIssuesByIssueShortIdReferences">;

// Resolved worklist payload carried on a worklist reference. Null when the soft
// reference is dangling (target worklist deleted).
export type ReferencedWorklist = NonNullable<IssueReferenceView["worklist"]>;

// The worklists a project may reference: its OWN worklists (the payload keeps
// the historical `ship` group name) plus the global knowledge base. 404s while
// the `worklist` section is not mounted, so only call it when it is.
export function useReferenceableWorklists(projectId: string | undefined) {
  return useQuery<{ ship: readonly ReferenceableWorklist[]; global: readonly ReferenceableWorklist[] }>({
    queryKey: projectKeys.referenceableWorklists(projectId ?? ""),
    queryFn: () => http<ApiEnvelope<{ ship: readonly ReferenceableWorklist[]; global: readonly ReferenceableWorklist[] }>>(
      `/projects/${encodeURIComponent(projectId!)}/referenceable-worklists`,
    ).then((r) => {
      // Normalize at the boundary: coerce `tags` to an array so the picker
      // (which reads `worklist.tags` unconditionally) can never crash on a
      // contract-violating or stale-cache row.
      const withTags = (w: ReferenceableWorklist): ReferenceableWorklist => ({ ...w, tags: w.tags ?? [] });
      return { ship: r.data.ship.map(withTags), global: r.data.global.map(withTags) };
    }),
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
      void queryClient.invalidateQueries({ queryKey: projectKeys.issuesRoot(projectId) });
    },
  });
}

// ── Single issue (work order) ──

export function useProjectIssue(projectId: string | undefined, issueId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.issue(projectId ?? "", issueId ?? ""),
    queryFn: () => http<ApiEnvelope<ProjectIssueRow>>(
      `/projects/${encodeURIComponent(projectId!)}/issues/${encodeURIComponent(issueId!)}`,
    ).then(r => r.data),
    enabled: !!projectId && !!issueId,
    staleTime: 5_000,
  });
}

export interface UpdateProjectIssueInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: IssueStatus;
  readonly priority?: IssuePriority;
  readonly assigneeMemberId?: string | null;
  readonly dueDate?: string | null;
  readonly tags?: readonly string[];
}

export function useUpdateProjectIssue(): UseMutationResult<ProjectIssueRow, Error, { projectId: string; issueId: string } & UpdateProjectIssueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, issueId, ...body }) => http<ApiEnvelope<ProjectIssueRow>>(
      `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (data, { projectId, issueId }) => {
      queryClient.setQueryData(projectKeys.issue(projectId, issueId), data);
      void queryClient.invalidateQueries({ queryKey: projectKeys.issuesRoot(projectId) });
    },
  });
}

export function useDeleteProjectIssue(): UseMutationResult<null, Error, { projectId: string; issueId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, issueId }) => http<ApiEnvelope<null>>(
      `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}`,
      { method: "DELETE" },
    ).then(r => r.data),
    onSuccess: (_data, { projectId, issueId }) => {
      queryClient.removeQueries({ queryKey: projectKeys.issue(projectId, issueId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.issuesRoot(projectId) });
    },
  });
}

/**
 * Upload one attachment to an issue. A plain request function (not a hook):
 * the create-issue dialog uploads staged files sequentially AFTER the issue
 * exists, inside the create mutation's own success path.
 */
export async function uploadIssueAttachment(projectId: string, issueId: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  await http(
    `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/attachments`,
    { method: "POST", body: fd },
  );
}
