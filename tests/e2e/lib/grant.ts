import type { ApiClient } from "./api";
import { getClient } from "./oidc";

// Every gateable module key (mirrors `MODULES` in the API's shared/modules.ts).
const ALL_MODULES = ["documents", "drive", "projects", "ships", "contacts", "hr"] as const;

// Unique suffix per group so repeated calls across suites never collide on the
// unique group-name constraint; the grant persists in the shared run DB, so the
// user simply ends up in several all-module groups (union = every module).
let seq = 0;

interface UserRow { readonly id: string; readonly email: string }

/**
 * Grant a non-admin e2e user every module (FEAT-032 gates module prefixes by
 * group membership; a user in no group sees nothing — the intended Guest
 * floor). As admin: ensure the user exists, create a group carrying all
 * modules, and add the user. Resource-level permissions are unaffected, so
 * negative/permission assertions still hold.
 */
export async function grantAllModules(email: string): Promise<void> {
  const admin: ApiClient = await getClient("admin@example.com");
  await getClient(email); // ensure the user row exists (provisioned on first login)

  const users = await admin.json<{ data: UserRow[] }>("/api/account/users");
  const userId = users.data.find(u => u.email === email)?.id;
  if (!userId)
    throw new Error(`grantAllModules: user ${email} not found in the directory`);

  const created = await admin.raw("/api/account/groups", {
    method: "POST",
    body: { name: `e2e-mods-${Date.now().toString(36)}-${seq++}`, modules: [...ALL_MODULES] },
  });
  if (created.status !== 201)
    throw new Error(`grantAllModules: create group failed (${created.status}): ${await created.text()}`);
  const groupId = (await created.json() as { data: { id: string } }).data.id;

  const added = await admin.raw(`/api/account/groups/${groupId}/members`, {
    method: "POST",
    body: { userId },
  });
  if (added.status !== 201 && added.status !== 200)
    throw new Error(`grantAllModules: add member failed (${added.status}): ${await added.text()}`);
}
