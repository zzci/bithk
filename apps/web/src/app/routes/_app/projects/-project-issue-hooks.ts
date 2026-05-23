// Single work-order (project issue) hooks used by the issue detail panel.
//
// The shared projects data layer (`@/shared/lib/api/projects`) exposes list and
// create hooks for issues; the per-issue read/update/delete hooks live here,
// co-located with their only consumer. They reuse the frozen `projectKeys` so
// cache invalidation stays consistent with the rest of the module.

import type { UseMutationResult } from "@tanstack/react-query";
import type {
  IssuePriority,
  IssueStatus,
  ProjectIssueRow,
} from "@/shared/lib/api/projects";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/shared/lib/api/projects";
import { http } from "@/shared/lib/http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

function issueKey(projectId: string, issueId: string) {
  return ["projects", projectId, "issue", issueId] as const;
}

export function useProjectIssue(projectId: string | undefined, issueId: string | undefined) {
  return useQuery({
    queryKey: issueKey(projectId ?? "", issueId ?? ""),
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
}

export function useUpdateProjectIssue(): UseMutationResult<ProjectIssueRow, Error, { projectId: string; issueId: string } & UpdateProjectIssueInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, issueId, ...body }) => http<ApiEnvelope<ProjectIssueRow>>(
      `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ).then(r => r.data),
    onSuccess: (data, { projectId, issueId }) => {
      queryClient.setQueryData(issueKey(projectId, issueId), data);
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "issues"] });
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
      queryClient.removeQueries({ queryKey: issueKey(projectId, issueId) });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "issues"] });
      void queryClient.invalidateQueries({ queryKey: projectKeys.issues(projectId, "") });
    },
  });
}
