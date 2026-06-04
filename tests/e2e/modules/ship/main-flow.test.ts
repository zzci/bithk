// Ship module main flow over the live API. The repository's e2e harness is
// HTTP-level (dex + API), so UI-only rendering remains covered by the focused
// web tests while this suite proves the shipped contracts end to end.
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";
import { createTestProject } from "../../lib/project";

interface User {
  id: string;
  email: string;
}

interface ProjectRole {
  id: string;
  name: string;
  capabilities: readonly string[];
}

interface ProjectMember {
  id: string;
  userId: string | null;
  roleId: string;
}

interface ProjectView {
  id: string;
  name: string;
  creatorId: string;
  capabilities?: readonly string[];
}

interface ShipView {
  id: string;
  code: string;
  name: string;
  baseProjectId: string | null;
  creatorId: string;
}

interface EquipmentView {
  id: string;
  name: string;
  category: string | null;
}

interface WorklistView {
  id: string;
  name: string;
  checklist: string | null;
  precautions: string | null;
}

interface IssueView {
  id: string;
  title: string;
  projectId: string;
}

interface IssueReferenceView {
  id: string;
  refType: string;
  refId: string;
  worklist?: WorklistView | null;
}

interface DriveEntry {
  id: string;
  name: string;
  ownerType: string;
  ownerId: string;
}

async function findUser(admin: ApiClient, email: string): Promise<User> {
  const users = await admin.json<{ data: User[] }>("/api/account/users");
  const user = users.data.find(u => u.email === email);
  if (!user)
    throw new Error(`missing user ${email}`);
  return user;
}

async function findProjectRole(admin: ApiClient, projectId: string, name: string): Promise<ProjectRole> {
  const roles = await admin.json<{ data: ProjectRole[] }>(`/api/projects/${projectId}/roles`);
  const role = roles.data.find(r => r.name === name);
  if (!role)
    throw new Error(`missing role ${name} on project ${projectId}`);
  return role;
}

async function addUserToProject(admin: ApiClient, projectId: string, userId: string, roleId: string): Promise<ProjectMember> {
  const res = await admin.json<{ data: ProjectMember }>(`/api/projects/${projectId}/members`, {
    method: "POST",
    body: { userId, roleId },
  });
  return res.data;
}

describe("/api/ships main flow", () => {
  it("creates a ship and proves permissions, equipment, templates, work orders, and project files", async () => {
    const admin = await getClient("admin@example.com", "admin");
    await getClient("user@example.com", "admin");
    const adminMe = await admin.json<{ data: User }>("/api/account/me");
    const regularUser = await findUser(admin, "user@example.com");
    const user = await getClient("user@example.com", "admin");
    const token = Date.now().toString(36);

    const shipRes = await admin.json<{ data: ShipView }>("/api/ships", {
      method: "POST",
      body: {
        name: `e2e-ship-${token}`,
        code: `E2E-SHIP-${token}`,
      },
    });
    const ship = shipRes.data;
    expect(ship.creatorId).toBe(adminMe.data.id);
    expect(ship.baseProjectId).toBeTruthy();
    const baseProjectId = ship.baseProjectId!;

    const shipList = await admin.json<{ data: ShipView[] }>("/api/ships");
    expect(shipList.data.find(s => s.id === ship.id)).toBeDefined();

    const baseProject = await admin.json<{ data: ProjectView }>(`/api/projects/${baseProjectId}`);
    expect(baseProject.data.name).toBe(ship.name);
    expect(baseProject.data.creatorId).toBe(adminMe.data.id);
    const roles = await admin.json<{ data: ProjectRole[] }>(`/api/projects/${baseProjectId}/roles`);
    const pmRole = roles.data.find(r => r.name === "Project Owner");
    const memberRole = roles.data.find(r => r.name === "Reader");
    expect(pmRole?.capabilities).toContain("project.manage");
    if (!pmRole || !memberRole)
      throw new Error("base project roles were not seeded");
    const members = await admin.json<{ data: ProjectMember[] }>(`/api/projects/${baseProjectId}/members`);
    const creatorMember = members.data.find(m => m.userId === adminMe.data.id);
    expect(creatorMember?.roleId).toBe(pmRole.id);

    const unrelatedProjectId = await createTestProject(admin, `e2e-unrelated-${token}`);
    const unrelatedMemberRole = await findProjectRole(admin, unrelatedProjectId, "Reader");
    await addUserToProject(admin, unrelatedProjectId, regularUser.id, unrelatedMemberRole.id);
    const denied = await user.raw(`/api/ships/${ship.id}`);
    expect(denied.status).toBe(404);

    const baseMember = await addUserToProject(admin, baseProjectId, regularUser.id, memberRole.id);
    const readable = await user.json<{ data: ShipView }>(`/api/ships/${ship.id}`);
    expect(readable.data.id).toBe(ship.id);
    const readList = await user.json<{ data: ShipView[] }>("/api/ships");
    expect(readList.data.find(s => s.id === ship.id)).toBeDefined();
    const memberWriteDenied = await user.raw(`/api/ships/${ship.id}`, {
      method: "PATCH",
      body: { name: "member-no-manage" },
    });
    expect(memberWriteDenied.status).toBe(403);

    await admin.json(`/api/projects/${baseProjectId}/members/${baseMember.id}`, {
      method: "PATCH",
      body: { roleId: pmRole.id },
    });
    const userPatch = await user.json<{ data: ShipView }>(`/api/ships/${ship.id}`, {
      method: "PATCH",
      body: { name: `e2e-ship-renamed-${token}` },
    });
    expect(userPatch.data.name).toBe(`e2e-ship-renamed-${token}`);

    const equipment = await user.json<{ data: EquipmentView }>(`/api/ships/${ship.id}/equipment`, {
      method: "POST",
      body: { name: "Generator", category: "Power" },
    });
    expect(equipment.data.name).toBe("Generator");
    const equipmentList = await user.json<{ data: EquipmentView[] }>(`/api/ships/${ship.id}/equipment`);
    expect(equipmentList.data.find(e => e.id === equipment.data.id)).toBeDefined();

    // Worklist knowledge base: admin seeds a global worklist, the promoted-Owner
    // member copies it onto the ship, then references the copy from a work order.
    const globalWorklist = await admin.json<{ data: WorklistView }>("/api/worklists", {
      method: "POST",
      body: {
        name: `Global engine service ${token}`,
        checklist: JSON.stringify(["Inspect belts", "Check oil"]),
        precautions: "Lock out power before service.",
      },
    });
    const beforeCopy = await user.json<{ data: WorklistView[] }>(`/api/ships/${ship.id}/worklists`);
    expect(beforeCopy.data.find(w => w.id === globalWorklist.data.id)).toBeUndefined();
    const copied = await user.json<{ data: WorklistView }>(`/api/ships/${ship.id}/worklists`, {
      method: "POST",
      body: { fromGlobalId: globalWorklist.data.id },
    });
    expect(copied.data.id).not.toBe(globalWorklist.data.id);
    expect(copied.data.name).toBe(globalWorklist.data.name);
    expect(copied.data.checklist).toBe(globalWorklist.data.checklist);
    const shipWorklists = await user.json<{ data: WorklistView[] }>(`/api/ships/${ship.id}/worklists`);
    expect(shipWorklists.data.map(w => w.id)).toContain(copied.data.id);
    expect(shipWorklists.data.map(w => w.id)).not.toContain(globalWorklist.data.id);

    const issue = await user.json<{ data: IssueView }>(`/api/projects/${baseProjectId}/issues`, {
      method: "POST",
      body: {
        title: `Engine maintenance ${token}`,
        references: [{ refType: "worklist", refId: copied.data.id }],
      },
    });
    expect(issue.data.projectId).toBe(baseProjectId);
    const references = await user.json<{ data: IssueReferenceView[] }>(`/api/issues/${issue.data.id}/references`);
    const worklistRef = references.data.find(r => r.refType === "worklist");
    expect(worklistRef?.refId).toBe(copied.data.id);
    expect(worklistRef?.worklist?.checklist).toContain("Inspect belts");
    expect(worklistRef?.worklist?.precautions).toBe("Lock out power before service.");

    // Deleting the referenced ship worklist degrades the soft reference to null.
    await user.json(`/api/ships/${ship.id}/worklists/${copied.data.id}`, { method: "DELETE" });
    const danglingRefs = await user.json<{ data: IssueReferenceView[] }>(`/api/issues/${issue.data.id}/references`);
    expect(danglingRefs.data.find(r => r.refType === "worklist")?.worklist).toBeNull();

    const filesList = await user.json<{ data: DriveEntry[] }>(`/api/drive/entries?ownerType=project&ownerId=${baseProjectId}`);
    expect(Array.isArray(filesList.data)).toBe(true);
    const folder = await user.json<{ data: DriveEntry }>("/api/drive/folders", {
      method: "POST",
      body: { name: `Ship files ${token}`, ownerType: "project", ownerId: baseProjectId },
    });
    expect(folder.data.ownerType).toBe("project");
    const filesAfterCreate = await user.json<{ data: DriveEntry[] }>(`/api/drive/entries?ownerType=project&ownerId=${baseProjectId}`);
    expect(filesAfterCreate.data.find(e => e.id === folder.data.id)).toBeDefined();

    const anon = new ApiClient();
    const anonRes = await anon.raw(`/api/ships/${ship.id}`);
    expect(anonRes.status).toBe(401);
  }, 60_000);
});
