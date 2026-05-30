import type {
  IssueReferenceView,
  MaintenanceTemplateView,
  ShipEquipmentView,
  ShipMaintenanceOrderView,
  ShipProjectView,
  ShipsListResult,
  ShipView,
} from "../../apps/web/src/shared/lib/api/ships";

const now = "2026-05-25T00:00:00.000Z";

export const fixtureShips: readonly ShipView[] = [
  {
    id: "ship-atlas",
    code: "ATL-001",
    name: "Atlas Voyager",
    status: "active",
    baseProjectId: "proj-atlas-refit",
    model: "Container 300",
    builder: "North Dock",
    buildYear: 2014,
    lengthOverall: 299,
    beam: 40,
    draft: 14.5,
    grossTonnage: 95500,
    imoNumber: "9876543",
    mmsi: "413258900",
    callSign: "BHQO5",
    flagState: "Panama",
    registryPort: "Shanghai",
    ownerName: "Atlas Marine",
    description: "Main-engine refit and class survey readiness vessel.",
    creatorId: "user-admin",
    version: 4,
    updatedAt: now,
  },
  {
    id: "ship-boreal",
    code: "BOR-NB-2026",
    name: "Boreal Newbuild",
    status: "active",
    baseProjectId: "proj-boreal-build",
    model: "Feeder 1800",
    builder: "South Yard",
    buildYear: 2026,
    lengthOverall: 184,
    beam: 28,
    draft: 9.2,
    grossTonnage: 28000,
    imoNumber: "9988104",
    mmsi: null,
    callSign: null,
    flagState: "Singapore",
    registryPort: null,
    ownerName: "Boreal Shipping",
    description: "Newbuild supervision vessel for sea-trial preparation.",
    creatorId: "user-admin",
    version: 1,
    updatedAt: now,
  },
  {
    id: "ship-cascade",
    code: "CAS-ST-01",
    name: "Cascade Trial",
    status: "active",
    baseProjectId: "proj-cascade-trial",
    model: "Chemical 38K",
    builder: "East Yard",
    buildYear: 2026,
    lengthOverall: 171,
    beam: 26,
    draft: 10.8,
    grossTonnage: 32000,
    imoNumber: "9978210",
    mmsi: "563000111",
    callSign: "9VCT1",
    flagState: "Singapore",
    registryPort: "Singapore",
    ownerName: "Cascade Maritime",
    description: "Sea-trial vessel with active commissioning issues.",
    creatorId: "user-admin",
    version: 2,
    updatedAt: now,
  },
  {
    id: "ship-delta",
    code: "DEL-042",
    name: "Delta Trader",
    status: "archived",
    baseProjectId: "proj-delta-pm",
    model: "Bulk 76K",
    builder: "Blue Yard",
    buildYear: 2011,
    lengthOverall: 225,
    beam: 32,
    draft: 12.6,
    grossTonnage: 51000,
    imoNumber: "9456712",
    mmsi: "477000222",
    callSign: "VRDT2",
    flagState: "Hong Kong",
    registryPort: "Hong Kong",
    ownerName: "Delta Bulk",
    description: "Archived reference vessel for inactive-state visual checks.",
    creatorId: "user-admin",
    version: 3,
    updatedAt: now,
  },
] as const;

export const fixtureShipEquipment: Record<string, readonly ShipEquipmentView[]> = {
  "ship-atlas": [
    {
      id: "eq-atlas-main-engine",
      name: "Main engine 6S60ME-C8.5",
      category: "Main engine",
      manufacturer: "MAN Energy Solutions",
      model: "6S60ME-C8.5",
      serialNumber: "ME-ATL-001",
      location: "Engine room",
      installedAt: "2014-03-01",
      status: "active",
      note: "Cylinder liner overhaul in progress.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "eq-atlas-radar",
      name: "X-band radar",
      category: "Navigation",
      manufacturer: "Furuno",
      model: "FAR-3320",
      serialNumber: "RAD-3320-ATL",
      location: "Bridge",
      installedAt: "2022-08-10",
      status: "active",
      note: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "eq-atlas-old-pump",
      name: "Retired transfer pump",
      category: "Auxiliary",
      manufacturer: "Generic Marine",
      model: "TP-20",
      serialNumber: "TP-OLD-20",
      location: "Stores",
      installedAt: "2014-04-12",
      status: "retired",
      note: "Kept for retired-state rendering.",
      createdAt: now,
      updatedAt: now,
    },
  ],
  "ship-boreal": [],
  "ship-cascade": [
    {
      id: "eq-cascade-bwms",
      name: "Ballast water treatment system",
      category: "Environmental",
      manufacturer: "Optimarin",
      model: "OBS 2000",
      serialNumber: "BWMS-CAS-01",
      location: "Pump room",
      installedAt: "2026-04-01",
      status: "active",
      note: "Commissioning pending.",
      createdAt: now,
      updatedAt: now,
    },
  ],
  "ship-delta": [],
};

export const fixtureShipProjects: Record<string, readonly ShipProjectView[]> = {
  "ship-atlas": [
    {
      id: "proj-atlas-refit",
      code: "ATL-REFIT-2026",
      name: "Atlas main-engine refit",
      status: "active",
      description: "Main-engine overhaul and class survey.",
      tags: [{ id: "tag-refit", name: "Refit" }, { id: "tag-main-engine", name: "Main engine" }],
      creatorId: "user-admin",
      version: 2,
      updatedAt: now,
      isBase: true,
    },
    {
      id: "proj-atlas-nav",
      code: "ATL-NAV-2026",
      name: "Atlas bridge navigation upgrade",
      status: "active",
      description: "Bridge display and radar renewal.",
      tags: [{ id: "tag-nav", name: "Navigation" }],
      creatorId: "user-admin",
      version: 1,
      updatedAt: now,
      isBase: false,
    },
  ],
  "ship-boreal": [
    {
      id: "proj-boreal-build",
      code: "BOR-BUILD-2026",
      name: "Boreal newbuild supervision",
      status: "active",
      description: "Newbuild delivery and sea-trial preparation.",
      tags: [{ id: "tag-newbuild", name: "Newbuild" }],
      creatorId: "user-admin",
      version: 1,
      updatedAt: now,
      isBase: true,
    },
  ],
  "ship-cascade": [
    {
      id: "proj-cascade-trial",
      code: "CAS-TRIAL-2026",
      name: "Cascade sea-trial punch list",
      status: "active",
      description: "Commissioning and trial issue closeout.",
      tags: [{ id: "tag-trial", name: "Sea trial" }],
      creatorId: "user-admin",
      version: 1,
      updatedAt: now,
      isBase: true,
    },
  ],
  "ship-delta": [],
};

export const fixtureShipTemplates: Record<string, readonly MaintenanceTemplateView[]> = {
  "ship-atlas": [
    {
      id: "tpl-atlas-lube",
      name: "Main-engine lube oil renewal",
      category: "Main engine",
      checklist: JSON.stringify(["Drain system", "Replace filters", "Sample oil"]),
      precautions: "Lock out transfer pumps before work.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "tpl-atlas-safety",
      name: "Lifeboat monthly drill",
      category: "Safety",
      checklist: JSON.stringify(["Inspect davits", "Run engine", "Record drill"]),
      precautions: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  "ship-boreal": [],
  "ship-cascade": [
    {
      id: "tpl-cascade-commissioning",
      name: "BWMS commissioning check",
      category: "Environmental",
      checklist: "Verify flow meter, salinity sensor, and alarm loop.",
      precautions: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  "ship-delta": [],
};

export const fixtureGlobalMaintenanceTemplates: readonly MaintenanceTemplateView[] = [
  {
    id: "tpl-global-radar",
    name: "Radar monthly check",
    category: "Navigation",
    checklist: JSON.stringify(["Inspect antenna", "Run self-test", "Verify heading input"]),
    precautions: null,
    createdAt: now,
    updatedAt: now,
  },
];

export const fixtureShipOrders: Record<string, readonly ShipMaintenanceOrderView[]> = {
  "ship-atlas": [
    {
      id: "issue-atlas-lube",
      title: "Renew main-engine lube oil",
      status: "working",
      projectId: "proj-atlas-refit",
      templateRefId: "tpl-atlas-lube",
      referenceId: "ref-atlas-lube",
    },
    {
      id: "issue-atlas-lifeboat",
      title: "Complete lifeboat monthly drill",
      status: "todo",
      projectId: "proj-atlas-refit",
      templateRefId: "tpl-atlas-safety",
      referenceId: "ref-atlas-lifeboat",
    },
  ],
  "ship-boreal": [],
  "ship-cascade": [
    {
      id: "issue-cascade-bwms",
      title: "Close BWMS commissioning issue",
      status: "todo",
      projectId: "proj-cascade-trial",
      templateRefId: "tpl-cascade-commissioning",
      referenceId: "ref-cascade-bwms",
    },
  ],
  "ship-delta": [],
};

export const fixtureIssueReferences: Record<string, readonly IssueReferenceView[]> = {
  "issue-atlas-lube": [
    {
      id: "ref-atlas-lube",
      refType: "maintenance_template",
      refId: "tpl-atlas-lube",
      label: "Template",
      createdAt: now,
      template: fixtureShipTemplates["ship-atlas"][0]!,
    },
  ],
  "issue-atlas-lifeboat": [
    {
      id: "ref-atlas-lifeboat",
      refType: "maintenance_template",
      refId: "tpl-atlas-safety",
      label: "Template",
      createdAt: now,
      template: fixtureShipTemplates["ship-atlas"][1]!,
    },
  ],
  "issue-cascade-bwms": [
    {
      id: "ref-cascade-bwms",
      refType: "maintenance_template",
      refId: "tpl-cascade-commissioning",
      label: "Template",
      createdAt: now,
      template: fixtureShipTemplates["ship-cascade"][0]!,
    },
  ],
};

export function listFixtureShips(params: URLSearchParams): ShipsListResult {
  const status = params.get("status");
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 20);
  const filtered = fixtureShips.filter(ship =>
    (!status || ship.status === status),
  );
  return {
    data: filtered.slice((page - 1) * limit, page * limit),
    meta: { total: filtered.length, page, limit },
  };
}

export function shipsFixtureResponse(path: string, params = new URLSearchParams()): unknown | undefined {
  if (path === "/ships") {
    const result = listFixtureShips(params);
    return { success: true, data: result.data, meta: result.meta };
  }
  if (path === "/maintenance-templates")
    return { success: true, data: fixtureGlobalMaintenanceTemplates };

  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "issues" && parts[1] && parts[2] === "references")
    return { success: true, data: fixtureIssueReferences[parts[1]] ?? [] };

  if (parts[0] !== "ships")
    return undefined;

  const shipId = parts[1];
  if (!shipId)
    return undefined;

  if (parts.length === 2) {
    const ship = fixtureShips.find(item => item.id === shipId);
    return ship ? { success: true, data: ship } : undefined;
  }
  if (parts[2] === "projects")
    return { success: true, data: fixtureShipProjects[shipId] ?? [] };
  if (parts[2] === "equipment")
    return { success: true, data: fixtureShipEquipment[shipId] ?? [] };
  if (parts[2] === "maintenance-templates")
    return { success: true, data: fixtureShipTemplates[shipId] ?? [] };
  if (parts[2] === "maintenance-orders")
    return { success: true, data: fixtureShipOrders[shipId] ?? [] };

  return undefined;
}
