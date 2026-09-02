// Ship main flow over the live API — a project created with the `ship` preset
// (PLAN-108: ships are projects with the `ship-profile` / `equipment` /
// `worklist` sections mounted). The e2e harness is HTTP-level (dex + API), so
// UI-only rendering stays with the focused web tests while this suite proves
// the section contracts and their permission matrix end to end:
// non-member 404 (fail-closed), Reader reads but cannot write (403), Project
// Owner writes, anonymous 401.
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
  sections?: readonly string[];
}

interface ShipProfileView {
  hullNumber: string;
  shipStatus: string;
  model: string | null;
}

interface EquipmentView {
  id: string;
  name: string;
  categoryId: string | null;
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

describe("ship preset main flow (/api/projects + ship sections)", () => {
  it("creates a ship project and proves permissions, profile, equipment, worklists, work orders, and project files", async () => {
    const admin = await getClient("admin@example.com", "admin");
    await getClient("user@example.com", "admin");
    const adminMe = await admin.json<{ data: User }>("/api/account/me");
    const regularUser = await findUser(admin, "user@example.com");
    const user = await getClient("user@example.com", "admin");
    const token = Date.now().toString(36);

    // A ship is a project created with the `ship` preset; the profile slice
    // rides along under `sectionData["ship-profile"]`.
    const shipRes = await admin.json<{ data: ProjectView }>("/api/projects", {
      method: "POST",
      body: {
        name: `e2e-ship-${token}`,
        code: `e2e-ship-${token}`,
        preset: "ship",
        sectionData: { "ship-profile": { hullNumber: `HULL-${token}` } },
      },
    });
    const ship = shipRes.data;
    expect(ship.creatorId).toBe(adminMe.data.id);
    const shipId = ship.id;

    // The fleet view is the section-filtered project list.
    const fleet = await admin.json<{ data: ProjectView[] }>("/api/projects?section=ship-profile");
    expect(fleet.data.find(p => p.id === shipId)).toBeDefined();
    const general = await admin.json<{ data: ProjectView[] }>("/api/projects?section=ship-profile&q=e2e-unrelated");
    expect(general.data.find(p => p.id === shipId)).toBeUndefined();

    const profile = await admin.json<{ data: ShipProfileView }>(`/api/projects/${shipId}/ship-profile`);
    expect(profile.data.hullNumber).toBe(`HULL-${token}`);

    const roles = await admin.json<{ data: ProjectRole[] }>(`/api/projects/${shipId}/roles`);
    const ownerRole = roles.data.find(r => r.name === "Project Owner");
    const readerRole = roles.data.find(r => r.name === "Reader");
    expect(ownerRole?.capabilities).toContain("project.manage");
    if (!ownerRole || !readerRole)
      throw new Error("project roles were not seeded");
    const members = await admin.json<{ data: ProjectMember[] }>(`/api/projects/${shipId}/members`);
    const creatorMember = members.data.find(m => m.userId === adminMe.data.id);
    expect(creatorMember?.roleId).toBe(ownerRole.id);

    // A general project has no ship surface at all (unmounted section => 404).
    const unrelatedProjectId = await createTestProject(admin, `e2e-unrelated-${token}`);
    const noSection = await admin.raw(`/api/projects/${unrelatedProjectId}/ship-profile`);
    expect(noSection.status).toBe(404);

    // Non-member (member of an unrelated project only) => fail-closed 404.
    const unrelatedReaderRole = await findProjectRole(admin, unrelatedProjectId, "Reader");
    await addUserToProject(admin, unrelatedProjectId, regularUser.id, unrelatedReaderRole.id);
    const denied = await user.raw(`/api/projects/${shipId}/ship-profile`);
    expect(denied.status).toBe(404);

    // Reader reads the profile and the fleet, but cannot write (403).
    const shipMember = await addUserToProject(admin, shipId, regularUser.id, readerRole.id);
    const readable = await user.json<{ data: ShipProfileView }>(`/api/projects/${shipId}/ship-profile`);
    expect(readable.data.hullNumber).toBe(`HULL-${token}`);
    const readFleet = await user.json<{ data: ProjectView[] }>("/api/projects?section=ship-profile");
    expect(readFleet.data.find(p => p.id === shipId)).toBeDefined();
    const memberWriteDenied = await user.raw(`/api/projects/${shipId}/ship-profile`, {
      method: "PUT",
      body: { model: "member-no-manage" },
    });
    expect(memberWriteDenied.status).toBe(403);

    // Promoted to Project Owner => writes land.
    await admin.json(`/api/projects/${shipId}/members/${shipMember.id}`, {
      method: "PATCH",
      body: { roleId: ownerRole.id },
    });
    const userPut = await user.json<{ data: ShipProfileView }>(`/api/projects/${shipId}/ship-profile`, {
      method: "PUT",
      body: { model: `Model-${token}` },
    });
    expect(userPut.data.model).toBe(`Model-${token}`);

    const equipment = await user.json<{ data: EquipmentView }>(`/api/projects/${shipId}/equipment`, {
      method: "POST",
      body: { name: "Generator" },
    });
    expect(equipment.data.name).toBe("Generator");
    const equipmentList = await user.json<{ data: EquipmentView[] }>(`/api/projects/${shipId}/equipment`);
    expect(equipmentList.data.find(e => e.id === equipment.data.id)).toBeDefined();

    // Worklist knowledge base: admin seeds a global worklist, the promoted
    // Owner copies it onto the ship, then references the copy from a work order.
    const globalWorklist = await admin.json<{ data: WorklistView }>("/api/worklists", {
      method: "POST",
      body: {
        name: `Global engine service ${token}`,
        checklist: JSON.stringify(["Inspect belts", "Check oil"]),
        precautions: "Lock out power before service.",
      },
    });
    const beforeCopy = await user.json<{ data: WorklistView[] }>(`/api/projects/${shipId}/worklists`);
    expect(beforeCopy.data.find(w => w.id === globalWorklist.data.id)).toBeUndefined();
    const referenceable = await user.json<{ data: { ship: WorklistView[]; global: WorklistView[] } }>(`/api/projects/${shipId}/referenceable-worklists`);
    expect(referenceable.data.global.find(w => w.id === globalWorklist.data.id)).toBeDefined();
    const copied = await user.json<{ data: WorklistView }>(`/api/projects/${shipId}/worklists`, {
      method: "POST",
      body: { fromGlobalId: globalWorklist.data.id },
    });
    expect(copied.data.id).not.toBe(globalWorklist.data.id);
    expect(copied.data.name).toBe(globalWorklist.data.name);
    expect(copied.data.checklist).toBe(globalWorklist.data.checklist);
    const shipWorklists = await user.json<{ data: WorklistView[] }>(`/api/projects/${shipId}/worklists`);
    expect(shipWorklists.data.map(w => w.id)).toContain(copied.data.id);
    expect(shipWorklists.data.map(w => w.id)).not.toContain(globalWorklist.data.id);

    const issue = await user.json<{ data: IssueView }>(`/api/projects/${shipId}/issues`, {
      method: "POST",
      body: {
        title: `Engine maintenance ${token}`,
        references: [{ refType: "worklist", refId: copied.data.id }],
      },
    });
    expect(issue.data.projectId).toBe(shipId);
    const references = await user.json<{ data: IssueReferenceView[] }>(`/api/issues/${issue.data.id}/references`);
    const worklistRef = references.data.find(r => r.refType === "worklist");
    expect(worklistRef?.refId).toBe(copied.data.id);
    expect(worklistRef?.worklist?.checklist).toContain("Inspect belts");
    expect(worklistRef?.worklist?.precautions).toBe("Lock out power before service.");

    // Deleting the referenced ship worklist degrades the soft reference to null.
    await user.json(`/api/projects/${shipId}/worklists/${copied.data.id}`, { method: "DELETE" });
    const danglingRefs = await user.json<{ data: IssueReferenceView[] }>(`/api/issues/${issue.data.id}/references`);
    expect(danglingRefs.data.find(r => r.refType === "worklist")?.worklist).toBeNull();

    // Project files: the `files` section is the drive with ownerType=project.
    const filesList = await user.json<{ data: DriveEntry[] }>(`/api/drive/entries?ownerType=project&ownerId=${shipId}`);
    expect(Array.isArray(filesList.data)).toBe(true);
    const folder = await user.json<{ data: DriveEntry }>("/api/drive/folders", {
      method: "POST",
      body: { name: `Ship files ${token}`, ownerType: "project", ownerId: shipId },
    });
    expect(folder.data.ownerType).toBe("project");
    const filesAfterCreate = await user.json<{ data: DriveEntry[] }>(`/api/drive/entries?ownerType=project&ownerId=${shipId}`);
    expect(filesAfterCreate.data.find(e => e.id === folder.data.id)).toBeDefined();

    const anon = new ApiClient();
    const anonRes = await anon.raw(`/api/projects/${shipId}/ship-profile`);
    expect(anonRes.status).toBe(401);
  }, 60_000);
});
