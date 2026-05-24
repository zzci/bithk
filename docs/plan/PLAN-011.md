# PLAN-011 — 船舶（游艇）管理模块

- **status**: implementing
- **createdAt**: 2026-05-24
- **approvedAt**: 2026-05-24
- **relatedTask**: FEAT-009

## Context（背景与现状）

业务场景：游艇的制造与运营。一艘船是长期资产，制造/改装阶段挂接工程项目，
运营阶段按维护模版开维护工单、保留维护记录。**船很薄**：创建船时自动建一个
**基础项目**作为权限锚点 + 文件载体；人员/权限/工单/文件全部复用项目，
船只在其上叠加基本信息、设备清单与维护模版。

复用的现有构件（已核实代码）：

| 构件 | 提供能力 | 来源 |
| --- | --- | --- |
| `project` | 自定义角色 + 能力位 + `project_members`；route 层 `getMemberCapabilities` 裁决；成员过滤列表；`createProject` 事务内播种 PM | `modules/project` |
| `issue` | 项目工单（item 子类型 `type='issue'`，`issue_details.projectId` + 指派 `project_members.id`）+ 评论 + 附件 | `modules/issue` |
| `item` 基类 | title/status/version/软删除 + 评论 + 附件 | `modules/item` |
| `drive` | 文件夹树 + 版本 + 预览；`owner_type` 已含 `project`（**无需新增类别**） | `modules/drive` |
| `backup` | `registerBackupContribution` 逐模块贡献 | `modules/backup` |

确认的需求边界（用户 2026-05-24，含四轮修订）：

1. 语义为实体船舶资产（游艇制造 + 运营）。
2. **创建船时直接建一个基础项目**；船可再绑定其它项目（一船多项目，无多对多）。
3. 权限复用 project —— 船不设角色/成员，**权限锚定基础项目**的成员/能力位。
4. 维护模版：全局库仅作**知识库**（复制来源）；船用时**从全局复制一份为船级模版**，
   工单引用船级模版；含保养清单 + 注意事项。
5. **维护工单 = 项目 issue**；给 issue 增加「引用外部文档之类」的通用功能，
   工单引用一个维护模版，在工单页内显示注意事项与维护内容。issue 核心不动。
6. **船文件 = 基础项目的文件**：drive 不加 `ship` 类别，船只引用基础项目，
   前端直接渲染该项目的 drive。
7. v1 范围：建船（含自动建基础项目）+ 基本信息、设备清单、维护模版（全局 + 船级）、
   issue 引用功能 + 据此开维护工单、文件（指向基础项目 drive）。

## Proposal（方案）

研发阶段——破坏性、不迁移存量。新增 `ship` 模块；扩展 `projects` 加 `shipId`；
给 `issue` 增加通用 `issue_references` 附加表（issue 核心零改动）。**drive 不改动**。

### 1. `ship` 核心模块 —— `apps/api/src/modules/ship/`

**`schema.ts`**

```ts
export const SHIP_STATUSES = ["active", "archived"] as const;
export const SHIP_LIFECYCLE_STAGES = [
  "design", "building", "sea_trial", "in_service", "maintenance", "decommissioned",
] as const;

export const ships = sqliteTable("ships", {
  id: text("id").primaryKey(),                 // ulid
  shortId: text("short_id").notNull(),         // nanoid，URL/API 暴露
  code: text("code").notNull(),                // 船体编号 / hull number，唯一
  name: text("name").notNull(),
  status: text("status", { enum: SHIP_STATUSES }).notNull().default("active"),
  lifecycleStage: text("lifecycle_stage", { enum: SHIP_LIFECYCLE_STAGES })
    .notNull().default("design"),
  // 自动创建的基础项目：权限锚点 + 文件载体（船文件即此项目的 drive）
  baseProjectId: text("base_project_id").references(() => projects.id, { onDelete: "set null" }),
  // 游艇基本信息（核心列）
  model: text("model"),
  builder: text("builder"),
  buildYear: integer("build_year"),
  lengthOverall: real("length_overall"),
  beam: real("beam"),
  draft: real("draft"),
  grossTonnage: real("gross_tonnage"),
  imoNumber: text("imo_number"),
  mmsi: text("mmsi"),
  callSign: text("call_sign"),
  flagState: text("flag_state"),
  registryPort: text("registry_port"),
  ownerName: text("owner_name"),
  description: text("description"),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("ships_short_id_idx").on(t.shortId),
  uniqueIndex("ships_code_idx").on(t.code),
  index("ships_status_idx").on(t.status, t.deletedAt),
  index("ships_base_project_idx").on(t.baseProjectId),
]);
```

**船不设角色/成员表**——权限锚定 `baseProjectId`（见 §2）。

**`ship.service.ts`**
- `createShip`（事务内）：插入 ship（`baseProjectId` 先空）→ 调 `createProject`
  建基础项目（`shipId=新船`，创建者为 PM）→ 回填 `ships.baseProjectId`。
  `baseProjectId` ↔ `projects.shipId` 为可空循环 FK，按此序写。
- 船 CRUD、列表（分页/搜索/按 `status`/`lifecycleStage`；非 admin 按「基础项目成员」过滤）、软删除。
- 权限辅助：`userCanReadShip` = admin 或基础项目成员；`userCanManageShip` = admin 或基础项目持 `project.manage`。

**`ship.routes.ts`** —— `/api/ships`（list/create/get/patch/delete）。创建/删除
`adminRequired`；读写按基础项目成员/能力裁决。

**`index.ts`** —— 导出 `shipRoutes`，注册 `shipBackupContribution`。

### 2. 船↔项目绑定 + 权限模型

```ts
// projects 表新增可空列
shipId: text("ship_id").references(() => ships.id, { onDelete: "set null" }),
// + index("projects_ship_idx").on(t.shipId)
```

- 基础项目即 `id = ships.baseProjectId` 的那个（`shipId` 同时指回本船）。
- 额外绑定其它项目：`GET /ships/:id/projects`、`POST /ships/:id/projects`
  （设 `projects.shipId`）、`DELETE /ships/:id/projects/:projectShortId`（置 null）。
  基础项目不可解绑。
- **权限（锚定基础项目）**：

  | 面 | 裁决 |
  | --- | --- |
  | 创建 / 删除船 | `adminRequired` |
  | 读取船（信息/设备/模版/文件/列表） | admin 或基础项目成员 |
  | 改船信息 / 设备 / 船级模版 / 绑定 | admin 或基础项目持 `project.manage` |
  | 全局模版维护 | `adminRequired` |
  | 维护工单 | 落入基础项目（默认）或某绑定项目，沿用该项目 issue 裁决 |
  | 船文件 | 即基础项目文件，沿用 project drive 既有权限 |

### 3. 设备清单 —— `ship_equipment`

```ts
export const EQUIPMENT_STATUSES = ["active", "retired"] as const;
export const shipEquipment = sqliteTable("ship_equipment", {
  id: text("id").primaryKey(),                 // nanoid
  shipId: text("ship_id").notNull().references(() => ships.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: text("serial_number"),
  location: text("location"),
  installedAt: text("installed_at"),
  status: text("status", { enum: EQUIPMENT_STATUSES }).notNull().default("active"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("ship_equipment_ship_idx").on(t.shipId)]);
```

路由 `/api/ships/:id/equipment` CRUD（读=基础项目成员、写=`project.manage`）。

### 4. 维护模版 —— 全局知识库 + 船级副本 `maintenance_templates`

```ts
export const maintenanceTemplates = sqliteTable("maintenance_templates", {
  id: text("id").primaryKey(),                 // nanoid
  // NULL = 全局模版（跨船复用）；有值 = 该船专属模版
  shipId: text("ship_id").references(() => ships.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                // 如「发动机保养」
  category: text("category"),
  checklist: text("checklist"),                // 保养清单（JSON string[] 或 markdown）
  precautions: text("precautions"),            // 注意事项
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("maintenance_templates_ship_idx").on(t.shipId)]);
```

- **全局模版（`shipId=NULL`）只是知识库**：`adminRequired` 维护，仅作复制来源，
  不被工单直接引用。
- **船级模版（`shipId` 有值）才是船实际使用的模版**，由基础项目 `project.manage` 维护，
  可从空白新建，也可**从某全局模版复制一份**（一次性拷贝 name/checklist/precautions，
  复制后与全局独立）。
- 路由：`/api/maintenance-templates`（全局知识库 CRUD，admin）；
  `GET /api/ships/:id/maintenance-templates` **仅返回本船模版**；
  `POST /api/ships/:id/maintenance-templates`（新建，可选 `fromGlobalId` 表示复制来源）。

### 5. issue 引用功能 —— 通用附加表（issue 核心不改）

给 issue 增加「引用外部文档之类」的通用能力，工单借此显示维护内容：

```ts
export const issueReferences = sqliteTable("issue_references", {
  id: text("id").primaryKey(),                 // nanoid
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  refType: text("ref_type").notNull(),         // 'maintenance_template' | 'url' | 'document' …
  refId: text("ref_id").notNull(),             // 模版 id / 文档 id / URL —— 纯文本，不加外键
  label: text("label"),
  createdAt: text("created_at").notNull(),
}, t => [index("issue_references_item_idx").on(t.itemId)]);
```

- **通用且不与 ship 耦合**：`refType`/`refId` 纯文本，issue 模块零依赖 ship；
  按 `refType` 在路由/前端分派解析。
- 路由：issue 详情下 `GET/POST/DELETE .../references`；issue 创建可选 `references[]` 一次带入。
- **维护工单流程**：在基础项目（或某绑定项目）内建一条 issue（复用现有 issue 创建/指派）
  + 加一条 `refType='maintenance_template'` 引用，`refId` 指向**船级**模版。工单页解析引用，
  **内嵌显示模版的保养清单 + 注意事项**。
- 「某船的维护工单」= 该船绑定项目内、带 `maintenance_template` 引用的 issue，join 即可列出。

### 6. 文件 —— 复用基础项目的 drive（drive 零改动）

- 不新增 `ship` ownerType。船文件即基础项目文件。
- 船详情 Files 页直接渲染基础项目的 `FileBrowser`（`ownerType=project&ownerId=baseProjectId`）。
- 权限/分享/版本全部沿用 project drive 既有逻辑。

### 7. 横切

- `shipBackupContribution`：`ships`、`ship_equipment`、`maintenance_templates`；deps `users`、`projects`。
  `issueReferences` 归入 `issueBackupContribution`（deps 加 `items`）。
  `projectBackupContribution` 的 deps 增加 `ships`（因 `projects.shipId`）。
- `protected.ts` 挂载 `shipRoutes()`。
- 全局 `search` 接入船（名称/编号）。
- i18n `{en,zh}` 文案分片。

### 前端 `/ships`

- 导航项 "Ships"。
- 列表页（admin 可见创建入口；按 `lifecycleStage` 徽章 + 过滤；非 admin 仅见基础项目所属的船）。
- 详情页页签：**Overview**（基本信息 + 生命周期）、**Equipment**、**Maintenance**
  （维护工单列表 + 「按模版开工单」入口；管理本船模版，可「从全局知识库复制」）、**Projects**
  （基础项目 + 绑定其它项目，挂接/解绑）、**Files**（基础项目 `FileBrowser`）。
- 维护工单详情渲染所引用模版的清单 + 注意事项；全局模版库管理在 admin 区，船级模版在 Maintenance 页内管理。

## Risks（风险）

- **循环 FK**：`ships.baseProjectId` ↔ `projects.shipId` 均可空，须事务内按「插船(空)
  → 建项目(带 shipId) → 回填 baseProjectId」顺序写。
- **删船的基础项目处置**：删船时其基础项目如何处理需定义（v1：解除关联保留项目，
  或随船软删——建议解除关联保留，避免误删项目数据）；`ship_equipment`/船级模版随船级联删。
- **`issue_references` 软引用无 FK**：`refId` 失效（模版删除）须优雅降级显示「引用已失效」。
- **维护工单 issue 创建复用**：须复用 issue 现有创建/指派路径，不绕过裁决。
- **`projects.shipId` 破坏性加列**：走 Drizzle 生成迁移（禁止手写）；备份 deps 调整保顺序。
- **权限锚定基础项目**：船的读/写完全取决于基础项目成员；非成员不得读船及（经 project drive）船文件。

## Scope（改动规模）

- 后端：新 `ship` 模块（schema/service/routes/equipment/templates/index + 测试，约 7–9 文件）；
  扩展 `projects` schema + 绑定路由 + `createShip` 联动建基础项目；`issue` 增 `issue_references`
  （schema + routes + 测试，约 3 文件）；备份 1 新增 + 2 deps 调整；1 个 Drizzle 迁移。
  **drive 无改动。**
- 前端：列表 + 详情（5 页签，Files 复用 project FileBrowser）+ 设备/维护/模版/绑定 UI、
  issue 引用渲染、导航项、i18n。约 12–14 文件。
- 测试：ship 服务/路由（含联动建项目）、设备、模版（全局 + 船级）、issue 引用、
  维护工单流程、主流程 e2e。
- 合计约 32 文件。规模大、跨模块、破坏性，但 drive 零改动后收敛。

### 建议分阶段（每阶段 `bun run check` 绿）

1. **P1 ship 核心 + 联动建基础项目 + 绑定 + 权限**：ships + `baseProjectId` + `projects.shipId`
   + `createShip` 联动 + 绑定路由 + 权限辅助 + 备份 + 测试。
2. **P1 设备清单**：`ship_equipment` + CRUD + 测试。
3. **P1 维护模版**：`maintenance_templates`（全局 + 船级）+ CRUD + 列表合并 + 测试。
4. **P1 issue 引用 + 维护工单**：`issue_references` + 路由 + 工单引用模版 + 测试。
5. **P2 前端 `/ships`**：全页签（Files 指向基础项目 drive）+ 模版管理 + 引用渲染 + i18n + search 接入。
6. **P2 e2e + 质量门**。

## Alternatives（备选）

- **drive 新增 `ship` ownerType（船有独立文件空间）**。否决（用户裁定）——船文件即基础项目文件，
  drive 零改动，前端指向基础项目即可。
- **不自动建项目、船绑定多个已存在项目作为权限来源**。否决（用户裁定）——改为创建船时自动建
  基础项目作为锚点，仍可额外绑定其它项目。
- **维护工单做成新 item 子类型 / `maintenance_orders` 扩展表**。否决（用户裁定）——
  用项目 issue + 通用 `issue_references` 引用模版。
- **船自带 `ship_roles`/`ship_members`**。否决（用户裁定）——权限锚定基础项目。
- **工单直接引用全局模版**。否决（用户裁定）——全局仅是知识库，船**复制**一份为船级模版，
  工单引用船级副本；避免全局模版变更影响历史工单。
- **`issue_references` 外键强引用模版**。否决——做成通用「引用外部文档之类」，用软引用避免 issue→ship 耦合。
- **船↔项目用中间表（多对多）**。否决——一船多项目，`projects.shipId` 单列最小改动。
- **船文件用 `file_references` 扁平附件**。否决——需求是完整文件清单，复用 drive 整套栈。

## Annotations（标注）

- 2026-05-24（需求，用户）：场景为游艇制造 + 运营；一船多项目（无多对多）；权限复用 project；
  v1 = 基本信息 + 设备清单 + 维护工单 + 维护计划「一键转工单」+ drive 文件清单。研发阶段，接受破坏性更改。
- 2026-05-24（修订一，用户）：维护模版才是模版（保养清单 + 注意事项）；维护工单 = 项目 issue；
  每船关联一个基础运营项目。
- 2026-05-24（修订二，用户）：①模版全局 + 船级并存；②权限走绑定项目；③给 issue 加通用引用功能，
  工单引用模版以显示注意事项 + 维护内容，issue 核心不改（取代 `maintenance_orders` 表）；
  ④不自动建项目，船绑定多个项目（**已被修订三 ④ 取代**）。
- 2026-05-24（修订三，用户）：①**船文件 = 基础项目文件，drive 不加 `ship` 类别，只加引用**
  （取代修订二的 drive `ship` ownerType）；②**创建船时直接建一个基础项目**作为权限锚点 + 文件载体
  （恢复自动建项目，取代修订二 ④）。权限统一锚定基础项目；船仍可额外绑定其它项目。
- 2026-05-24（修订四，用户）：**全局模版仅是知识库**，船**从全局复制一份**为船级模版（复制后独立），
  工单引用船级模版，不引用全局（取代修订二 ① 的「列模版返回全局 + 本船」合并语义）。
- 2026-05-24（执行，BKD campaign `l1-uel9ph5t-20260524182958`）：后端 T1–T4 + 前端 T5a/T5b 已实现并合并 main
  （`bun run check` 绿，api 1055/0）；产物与本设计一致（迁移 0001 建 ships/ship_equipment/maintenance_templates +
  projects.ship_id 双向 FK，迁移 0002 建 issue_references）。最终任务 T6（主流程 e2e + 最终质量门 +
  changelog/architecture/decision + 状态收尾）进行中。本文件曾被并发 worktree agent 误覆盖为精简版，
  现由 L1 从权威上下文还原完整设计并提交。
