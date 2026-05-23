// Shared helper: issues / procurements are project-scoped, so the issue e2e
// suites need a project to hang work orders off. Project creation is
// admin-only and the creator becomes the project's pm member, so an admin
// client can both create the project and operate inside it.
import type { ApiClient } from "./api";

interface ProjectView { id: string; code: string; name: string }

/** Create a fresh project and return its external short id (`data.id`). */
export async function createTestProject(admin: ApiClient, name?: string): Promise<string> {
  const res = await admin.json<{ data: ProjectView }>("/api/projects", {
    method: "POST",
    body: { name: name ?? `e2e-project-${Date.now()}` },
  });
  return res.data.id;
}
