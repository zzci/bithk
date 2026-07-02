import type {
  ProcurementRow,
  ProcurementsResult,
  ProcurementStatus,
} from "../../apps/web/src/shared/lib/api/procurement";
import type {
  ProcurementCategoryView,
  ProjectIssueRow,
  ProjectMemberView,
  ProjectRoleView,
  ProjectsListResult,
  ProjectTag,
  ProjectView,
} from "../../apps/web/src/shared/lib/api/projects";

const now = "2026-05-25T00:00:00.000Z";

export const fixtureProjectTags: readonly ProjectTag[] = [
  { id: "tag-refit", name: "Refit" },
  { id: "tag-main-engine", name: "Main engine" },
  { id: "tag-nav", name: "Navigation" },
  { id: "tag-newbuild", name: "Newbuild" },
  { id: "tag-trial", name: "Sea trial" },
  { id: "tag-urgent", name: "Urgent" },
] as const;

export const fixtureProjects: readonly ProjectView[] = [
  {
    id: "proj-atlas-refit",
    code: "ATL-REFIT-2026",
    name: "Atlas main-engine refit",
    status: "active",
    description: "Main-engine overhaul, procurement, and class survey readiness.",
    tags: [fixtureProjectTags[0]!, fixtureProjectTags[1]!],
    capabilities: [
      "project.manage",
      "members.manage",
      "roles.manage",
      "categories.manage",
      "procurement.view",
      "procurement.manage",
      "issue.manage",
    ],
    creatorId: "user-admin",
    version: 3,
    updatedAt: now,
  },
  {
    id: "proj-atlas-nav",
    code: "ATL-NAV-2026",
    name: "Atlas bridge navigation upgrade",
    status: "active",
    description: "Radar and bridge display integration.",
    tags: [fixtureProjectTags[2]!],
    capabilities: ["procurement.view", "issue.manage"],
    creatorId: "user-admin",
    version: 1,
    updatedAt: "2026-05-24T18:42:00.000Z",
  },
  {
    id: "proj-boreal-build",
    code: "BOR-BUILD-2026",
    name: "Boreal newbuild supervision",
    status: "active",
    description: "Newbuild inspections, delivery items, and sea-trial preparation.",
    tags: [fixtureProjectTags[3]!, fixtureProjectTags[4]!],
    capabilities: ["project.manage", "members.manage", "procurement.view"],
    creatorId: "user-admin",
    version: 1,
    updatedAt: "2026-05-23T12:00:00.000Z",
  },
  {
    id: "proj-cascade-trial",
    code: "CAS-TRIAL-2026",
    name: "Cascade sea-trial punch list",
    status: "active",
    description: "Commissioning and trial issue closeout.",
    tags: [fixtureProjectTags[4]!, fixtureProjectTags[5]!],
    capabilities: ["project.manage", "procurement.view", "procurement.manage", "issue.manage"],
    creatorId: "user-admin",
    version: 2,
    updatedAt: "2026-05-22T09:00:00.000Z",
  },
  {
    id: "proj-delta-pm",
    code: "DEL-PM-Q1",
    name: "Delta quarterly planned maintenance",
    status: "archived",
    description: "Archived planned-maintenance project for visual archived-state checks.",
    tags: [{ id: "tag-pm", name: "PM" }],
    capabilities: ["procurement.view"],
    creatorId: "user-admin",
    version: 5,
    updatedAt: "2026-03-06T08:00:00.000Z",
  },
] as const;

export const fixtureProjectRoles: Record<string, readonly ProjectRoleView[]> = {
  "proj-atlas-refit": [
    {
      id: "role-atlas-pm",
      name: "Project Manager",
      capabilities: [
        "project.manage",
        "members.manage",
        "roles.manage",
        "categories.manage",
        "procurement.view",
        "procurement.manage",
        "issue.manage",
      ],
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-atlas-field",
      name: "Field Lead",
      capabilities: ["procurement.view", "issue.manage"],
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
};

export const fixtureProjectMembers: Record<string, readonly ProjectMemberView[]> = {
  "proj-atlas-refit": [
    {
      id: "member-atlas-owner",
      userId: "user-admin",
      displayName: null,
      roleId: "role-atlas-pm",
      title: "Chief engineer",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "member-atlas-field",
      userId: null,
      displayName: "Morgan Lee",
      roleId: "role-atlas-field",
      title: "Mechanical lead",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "member-atlas-electrical",
      userId: null,
      displayName: "Riley Chen",
      roleId: "role-atlas-field",
      title: "Electrical inspector",
      createdAt: now,
      updatedAt: now,
    },
  ],
  "proj-atlas-nav": [],
  "proj-boreal-build": [],
  "proj-cascade-trial": [],
  "proj-delta-pm": [],
};

export const fixtureProcurementCategories: Record<string, readonly ProcurementCategoryView[]> = {
  "proj-atlas-refit": [
    {
      id: "cat-main-engine",
      name: "Main engine spares",
      code: "ME",
      description: "Main-propulsion engine spares and overhaul kits.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cat-tools",
      name: "Special tools",
      code: "TOOL",
      description: "Hydraulic and alignment tools.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cat-consumables",
      name: "Consumables",
      code: "CON",
      description: "Cleaning agents, seals, and consumable items.",
      createdAt: now,
      updatedAt: now,
    },
  ],
  "proj-atlas-nav": [],
  "proj-boreal-build": [],
  "proj-cascade-trial": [
    {
      id: "cat-commissioning",
      name: "Commissioning",
      code: "COMM",
      description: "Commissioning spares and service items.",
      createdAt: now,
      updatedAt: now,
    },
  ],
  "proj-delta-pm": [],
};

export const fixtureIssues: Record<string, readonly ProjectIssueRow[]> = {
  "proj-atlas-refit": [
    {
      id: "issue-atlas-lube",
      title: "Renew main-engine lube oil",
      description: "Drain, clean, renew oil, and record sample results.",
      status: "working",
      priority: "high",
      creatorId: "user-admin",
      assigneeId: null,
      assigneeMemberId: "member-atlas-field",
      projectId: "proj-atlas-refit",
      dueDate: "2026-05-28",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: now,
      version: 2,
    },
    {
      id: "issue-atlas-approval",
      title: "Approve shaft alignment report",
      description: "Pending superintendent approval before closeout.",
      status: "todo",
      priority: "urgent",
      creatorId: "user-admin",
      assigneeId: null,
      assigneeMemberId: "member-atlas-owner",
      projectId: "proj-atlas-refit",
      dueDate: "2026-05-26",
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: now,
      version: 1,
    },
    {
      id: "issue-atlas-fire",
      title: "Verify engine-room fire loop",
      description: "Functional test completed.",
      status: "done",
      priority: "medium",
      creatorId: "user-admin",
      assigneeId: null,
      assigneeMemberId: "member-atlas-electrical",
      projectId: "proj-atlas-refit",
      dueDate: "2026-05-20",
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: now,
      version: 1,
    },
    {
      id: "issue-atlas-cancel",
      title: "Cancelled spare-pump inspection",
      description: "Cancelled after scope review.",
      status: "cancel",
      priority: "low",
      creatorId: "user-admin",
      assigneeId: null,
      assigneeMemberId: null,
      projectId: "proj-atlas-refit",
      dueDate: null,
      createdAt: "2026-05-17T10:00:00.000Z",
      updatedAt: now,
      version: 1,
    },
  ],
  "proj-atlas-nav": [],
  "proj-boreal-build": [],
  "proj-cascade-trial": [
    {
      id: "issue-cascade-bwms",
      title: "Close BWMS commissioning issue",
      description: "Verify alarms and flow-meter readings.",
      status: "todo",
      priority: "high",
      creatorId: "user-admin",
      assigneeId: null,
      assigneeMemberId: null,
      projectId: "proj-cascade-trial",
      dueDate: "2026-05-30",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ],
  "proj-delta-pm": [],
};

export const fixtureProcurements: Record<string, readonly ProcurementRow[]> = {
  "proj-atlas-refit": [
    {
      id: "proc-atlas-draft",
      projectId: "proj-atlas-refit",
      title: "Draft liner request",
      itemName: "Cylinder liner gasket kit",
      status: "draft",
      supplierId: "contact-man-es",
      categoryId: "cat-main-engine",
      assigneeMemberId: "member-atlas-field",
      quantity: 6,
      amount: 7200,
      currency: "USD",
      creatorId: "user-admin",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: "proc-atlas-requested",
      projectId: "proj-atlas-refit",
      title: "Pending approval",
      itemName: "Hydraulic tensioner rental",
      status: "requested",
      supplierId: "contact-yard-team",
      categoryId: "cat-tools",
      assigneeMemberId: "member-atlas-owner",
      quantity: 1,
      amount: 18000,
      currency: "USD",
      creatorId: "user-admin",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: "proc-atlas-ordered",
      projectId: "proj-atlas-refit",
      title: "Ordered spares",
      itemName: "Main bearing shell set",
      status: "ordered",
      supplierId: "contact-man-es",
      categoryId: "cat-main-engine",
      assigneeMemberId: "member-atlas-field",
      quantity: 1,
      amount: 215000,
      currency: "USD",
      creatorId: "user-admin",
      createdAt: now,
      updatedAt: now,
      version: 2,
    },
    {
      id: "proc-atlas-received",
      projectId: "proj-atlas-refit",
      title: "Received consumables",
      itemName: "High-temperature flange gaskets",
      status: "received",
      supplierId: "contact-general-supply",
      categoryId: "cat-consumables",
      assigneeMemberId: null,
      quantity: 80,
      amount: 25600,
      currency: "USD",
      creatorId: "user-admin",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: "proc-atlas-closed",
      projectId: "proj-atlas-refit",
      title: "Closed oil order",
      itemName: "Main-engine lube oil",
      status: "closed",
      supplierId: "contact-general-supply",
      categoryId: "cat-consumables",
      assigneeMemberId: null,
      quantity: 18,
      amount: 122400,
      currency: "USD",
      creatorId: "user-admin",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ],
  "proj-atlas-nav": [],
  "proj-boreal-build": [],
  "proj-cascade-trial": [
    {
      id: "proc-cascade-flow",
      projectId: "proj-cascade-trial",
      title: "Commissioning sensor",
      itemName: "BWMS flow sensor",
      status: "requested",
      supplierId: "contact-optimarin",
      categoryId: "cat-commissioning",
      assigneeMemberId: null,
      quantity: 1,
      amount: 4200,
      currency: "USD",
      creatorId: "user-admin",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ],
  "proj-delta-pm": [],
};

export function listFixtureProjects(params: URLSearchParams): ProjectsListResult {
  const status = params.get("status");
  const tagId = params.get("tagId");
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 20);
  const filtered = fixtureProjects.filter(project =>
    (!status || project.status === status) && (!tagId || project.tags.some(tag => tag.id === tagId)),
  );
  return {
    data: filtered.slice((page - 1) * limit, page * limit),
    meta: { total: filtered.length, page, limit },
  };
}

export function listFixtureIssues(projectId: string, params: URLSearchParams) {
  const q = params.get("q")?.toLowerCase();
  const status = params.get("status");
  const priority = params.get("priority");
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 20);
  const filtered = (fixtureIssues[projectId] ?? []).filter(issue =>
    (!q || issue.title.toLowerCase().includes(q))
    && (!status || issue.status === status)
    && (!priority || issue.priority === priority),
  );
  return {
    data: filtered.slice((page - 1) * limit, page * limit),
    meta: { total: filtered.length, page, limit },
  };
}

export function listFixtureProcurements(projectId: string, params: URLSearchParams): ProcurementsResult {
  const status = params.get("status") as ProcurementStatus | null;
  const categoryId = params.get("categoryId");
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 20);
  const filtered = (fixtureProcurements[projectId] ?? []).filter(row =>
    (!status || row.status === status) && (!categoryId || row.categoryId === categoryId),
  );
  return {
    data: filtered.slice((page - 1) * limit, page * limit),
    meta: { total: filtered.length, page, limit },
  };
}

export function projectsFixtureResponse(path: string, params = new URLSearchParams()): unknown | undefined {
  if (path === "/tags")
    return { success: true, data: fixtureProjectTags };
  if (path === "/projects") {
    const result = listFixtureProjects(params);
    return { success: true, data: result.data, meta: result.meta };
  }

  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "projects")
    return undefined;

  const projectId = parts[1];
  if (!projectId)
    return undefined;

  if (parts.length === 2) {
    const project = fixtureProjects.find(item => item.id === projectId);
    return project ? { success: true, data: project } : undefined;
  }
  if (parts[2] === "members")
    return { success: true, data: fixtureProjectMembers[projectId] ?? [] };
  if (parts[2] === "roles")
    return { success: true, data: fixtureProjectRoles[projectId] ?? [] };
  if (parts[2] === "procurement-categories")
    return { success: true, data: fixtureProcurementCategories[projectId] ?? [] };
  if (parts[2] === "issues") {
    if (parts[3]) {
      const issue = (fixtureIssues[projectId] ?? []).find(item => item.id === parts[3]);
      return issue ? { success: true, data: issue } : undefined;
    }
    const result = listFixtureIssues(projectId, params);
    return { success: true, data: result.data, meta: result.meta };
  }
  if (parts[2] === "procurements") {
    if (parts[3]) {
      const procurement = (fixtureProcurements[projectId] ?? []).find(item => item.id === parts[3]);
      return procurement ? { success: true, data: procurement } : undefined;
    }
    const result = listFixtureProcurements(projectId, params);
    return { success: true, data: result.data, meta: result.meta };
  }

  return undefined;
}
