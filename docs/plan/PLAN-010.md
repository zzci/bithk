# PLAN-010 — 项目模块完善：可配置角色、外部联系人、采购类别、项目元信息、项目设置中心

- **状态：** Done
- **任务：** [FEAT-008](../task/FEAT-008.md)
- **创建时间：** 2026-05-23
- **更新时间：** 2026-05-23

## Context（现状核实）

FEAT-004 / PLAN-004 落地的 project 模块现状与缺口：

| 维度 | 现状 | 缺口 |
| --- | --- | --- |
| 元信息 | code/name/status/description/start/end | 无业主、合同号、合同额、预算、币种、地址、类型、负责人 |
| 角色 | `project_members.role ∈ {pm, member}` 硬编码裁决 | 不可定义角色；无能力（capability）模型 |
| 成员 | 单表，`memberType` 内/外，外部承载供应商（`supplier_info` JSON） | 外部参与方与可登录成员混在一表；供应商无结构化目录 |
| 采购供应商 | `procurement.supplier_member_id → project_members` | 无独立外部联系人/供应商目录 |
| 采购类别 | 无 | 采购无类别维度 |
| 设置 UI | `-project-form-dialog.tsx` 6 字段；成员独立 tab | 无统一项目设置中心 |

裁决/契约耦合点（实现时必须改全）：

- `project.service.getRole`（返回 pm/member）被以下消费：`project.routes`、
  `procurement.routes`（`canViewProcurement`）、`drive.permission.ts`（项目分支，
  `pm||member → 文件全权`）。
- 前端 `-use-project-role.ts` 从成员行派生 `isPm` / `canViewProcurement`；
  `$projectId.lazy.tsx` 据此渲染 tab、文件管理权。
- 采购 `supplier_member_id`、`assignee_member_id` 均 → `project_members.id`。
- 迁移已到 `0008`（REFACTOR-002 部分落地）；本计划迁移为 `0009`。

## 已确认决策（用户 2026-05-23）

- **D1 = R2：可定义的多角色。** 引入项目级 `project_roles` + 能力集，成员挂角色，
  路由按能力裁决（取代 pm/member 硬编码）。
- **D2 = 成员（操作角色）与供应商（元信息）分离。**
  - **成员 = 操作角色**：可被指派工单/采购的操作者。成员可绑定真实 `users.id`，
    也可以是**虚拟用户**（无登录账号的自有员工，仅 `displayName`）。`project_members`
    保留"可虚拟"的能力（`userId` 可空），并挂可配置角色。
  - **供应商 = 元信息**：与工单/采购的"被指派操作者"是**不同维度**——供应商是
    采购单上的对手方引用，不是操作者、不可被指派。供应商存入新的外部联系人表
    `project_contacts`（按 `type` 区分供应商/业主/分包/其他）。
- **D3：成员管理放进项目设置中心。** 移除独立 Members tab，统一到设置对话框。
- **D4（新增）：项目列表首页卡片化。** 列表页改卡片栅格，支持按**项目类型**筛选，
  并能查看/筛选**归档项目**。

## Proposal（方案）

研发态、破坏性、不迁移存量。一个 `0009` 迁移重建相关表。

### A. 数据模型

#### A1. `project_roles`（新，可配置角色）

```ts
export const PROJECT_CAPABILITIES = [
  "project.manage",     // 改元信息 / 归档 / 删除项目
  "members.manage",     // 增删改成员、指派角色
  "roles.manage",       // 增删改角色
  "contacts.manage",    // 维护外部联系人（供应商等）
  "categories.manage",  // 维护采购类别
  "procurement.view",
  "procurement.manage", // 采购增删改 / 状态流转
  "issue.manage",       // 工单增删改
] as const;

export const projectRoles = sqliteTable("project_roles", {
  id: text("id").primaryKey(),                 // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capabilities: text("capabilities").notNull().default("[]"), // JSON string[]，按 PROJECT_CAPABILITIES 校验
  isSystem: integer("is_system").notNull().default(0),        // 1=内置不可删（项目经理角色）
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("project_roles_project_idx").on(t.projectId)]);
```

- 建项目时种子两个角色：**Project Manager**（`isSystem=1`，全能力，创建者获得）、
  **Member**（`["issue.manage"]`）。
- `roles.manage` 才能增删改角色；`isSystem` 角色不可删，能力锁全集（防锁死，
  叠加 admin 旁路）。

#### A2. `project_members`（操作角色：真实用户或虚拟用户 + 挂角色）

```ts
export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),                 // nanoid，工单/采购的指派目标
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // 真实成员绑定 users.id；虚拟用户（无账号的自有员工）userId 为空、用 displayName。
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),           // 虚拟成员展示名（userId 为空时必填）
  roleId: text("role_id").notNull().references(() => projectRoles.id, { onDelete: "restrict" }),
  title: text("title"),                        // 职务/工种，展示用，可空
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("project_members_project_idx").on(t.projectId),
  // 一项目每真实用户一行；虚拟成员 userId 为 NULL，SQLite 视多个 NULL 为相异，互不冲突。
  uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId),
]);
```

- 保留 `userId` 可空 + `displayName` 以支持**虚拟用户**成员（可被指派）。
- 删除旧的供应商承载字段 `memberType` / `externalRef` / `supplierInfo` /
  `canViewProcurement`（供应商迁到 `project_contacts`；可见性改由角色能力承载）。
- 删除角色前需无成员引用（`onDelete: restrict`）。

#### A3. `project_contacts`（新，外部联系人，按 type）

```ts
export const CONTACT_TYPES = ["supplier", "client", "subcontractor", "other"] as const;
export const CONTACT_STATUSES = ["active", "inactive"] as const;
export const projectContacts = sqliteTable("project_contacts", {
  id: text("id").primaryKey(),                 // nanoid，对外标识 & 采购引用目标
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type", { enum: CONTACT_TYPES }).notNull(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxId: text("tax_id"),
  rating: integer("rating"),                   // 1–5，可空
  status: text("status", { enum: CONTACT_STATUSES }).notNull().default("active"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("project_contacts_project_type_idx").on(t.projectId, t.type)]);
```

#### A4. `procurement_categories`（新，扁平）

```ts
export const procurementCategories = sqliteTable("procurement_categories", {
  id: text("id").primaryKey(),                 // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("procurement_categories_project_idx").on(t.projectId)]);
```

#### A5. `projects` 元信息扩展（同表加列，全部可空）

```ts
clientName, contractNo, location: text(...)
contractAmount, budgetAmount: integer(...)   // 最小货币单位
currency: text(...)                          // 默认币种
managerMemberId: text("manager_member_id").references(() => projectMembers.id, { onDelete: "set null" })
```

- 项目分类改用**用户自定义标签**（见 A7），不再用固定类型枚举。

#### A7. 项目标签 `tags` + `project_tags`（用户自定义，按 tag 划分）

项目分类由用户自定义标签承载，全局共享、项目多对多：

```ts
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),                 // nanoid
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("tags_name_idx").on(t.name)]);

export const projectTags = sqliteTable("project_tags", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.projectId, t.tagId] })]);
```

- `GET /tags` 列出全局标签（筛选下拉用）；建/改项目时按名称 upsert 标签并维护
  `project_tags`（去重）。
- `ProjectView` 增 `tags: { id, name }[]`；`composeProject` 联表填充（列表批量、
  详情单查）。
- `listProjects` 新增 `tagId`（或 `tag` 名）筛选参数；`status` 已支持（含
  `archived`）。`GET /projects` 接受 `tag` / `status` query。

#### A6. `procurement_details`（破坏性改造）

- 删 `supplier_member_id`；新增 `supplier_id → project_contacts`（ON DELETE SET NULL）、
  `category_id → procurement_categories`（ON DELETE SET NULL）。
- `assignee_member_id` 不变（→ `project_members.id`）。

### B. 服务与路由

- **能力中枢**：`getMemberCapabilities(projectId, userId): Set<Capability> | null`
  （成员→角色 join）；`requireProjectAccess(c, shortId, capability?)` 取代
  `needPm` 布尔。admin 旁路保留。
- **project.service / routes**：createProject 事务内种子角色 + 写创建者 PM 成员；
  新增 roles / contacts / categories / members 的 CRUD；`composeProject` 含元信息；
  `GET /projects/:id` 响应附 `callerCapabilities`（供前端门控）。
- **procurement**：`supplierMemberId → supplierId`（校验 `type=supplier` 的联系人）、
  新增 `categoryId`（校验属本项目）；列表支持按类别筛选；可见 = `procurement.view`，
  写 = `procurement.manage`。
- **drive.permission.ts**：项目分支由 `getRole` 改为"成员即文件全权"
  （`getMemberCapabilities !== null`），保持现状行为，不引入文件能力位。
- **issue**：`assignee_member_id` 仍 → `project_members`；本计划**不改 issue 授权**
  （继续按成员裁决），避免与 REFACTOR-002 冲突；`issue.manage` 能力先定义、暂不接入。
- **备份**：新增 `project_roles` / `project_contacts` / `procurement_categories`
  贡献；procurement 贡献 deps 增加 contacts/categories；移除成员旧列引用。

### C. 前端：项目设置中心

- **Project Settings 对话框**（按能力门控），分区：
  1. **General**：元信息表单（业主/合同号/合同额/预算/币种/地址/类型/负责人）。
  2. **Members & Roles**：成员 CRUD（挂角色 + 职务）+ 角色 CRUD（名称 + 能力勾选）。
  3. **Contacts**：外部联系人 CRUD，按 `type` 分组/筛选。
  4. **Procurement Categories**：类别 CRUD。
- 移除独立 Members tab；详情 tab = Overview / Issues / Procurement / Files。
- `-use-project-role.ts` 改为消费 `callerCapabilities`（能力门控）。
- API client：roles / contacts / categories hooks；member view 增 roleId/title；
  project view 增元信息 + callerCapabilities；procurement 增 supplierId/categoryId。
- 采购表单：供应商下拉来自 `contacts(type=supplier)`，类别下拉来自类别表。
- 概览页：元信息卡片。
- EN/ZH i18n 分片扩充；`-project-logic.test.ts` 改为能力派生测试。

### C2. 前端：项目列表首页卡片化（D4）

- `projects/index.lazy.tsx` 由表格改为**卡片栅格**：每卡显示名称、code、状态徽章、
  标签徽章、业主/负责人等关键元信息摘要，点击进详情。
- 筛选区：**标签**下拉（来自 `GET /tags`）+ **状态**下拉（active/archived/closed/
  全部，可查归档）；筛选驱动 `useProjects({ tag, status, page })`。
- 项目设置 General 分区提供标签编辑（多选 + 即时创建新标签）。
- 保留分页与创建入口（admin）；空态/加载态适配卡片布局。

### D. 文档

`docs/reference/api-routes.md`、`docs/modules/project.md`、`docs/changelog.md`。

## Risks（风险）

- **角色裁决全量替换**：pm/member → 能力集，触及 project/procurement/drive 三处
  及前端门控。须穷尽所有 `getRole` 消费点，避免遗漏导致越权或锁死。
- **防锁死**：`isSystem` PM 角色不可删、能力锁全集，叠加 admin 旁路；删角色前置
  无成员引用校验（`restrict`）。
- **成员表重构**：去除供应商承载字段（memberType/externalRef/supplierInfo/
  canViewProcurement）属破坏性；但**保留 `userId` 可空 + `displayName`** 以支持
  虚拟用户成员，因此工单/采购的指派对象（真实或虚拟成员）能力不变。供应商作为
  元信息迁到 `project_contacts`，不参与指派。
- **采购供应商引用迁移**：`supplier_member_id → supplier_id` 三层联动；fail-closed
  可见性不得回退。
- **与 REFACTOR-002 共线**：两者都改详情页 tab 容器与项目相关 schema；本计划不动
  issue 代码，合并时协调 tab 列表与迁移序号。
- **设置对话框体量**：分区多，按 <400 行/文件拆分组件，复用现有 members tab 逻辑。

## Scope（改动规模）

- 后端：project schema（+roles/contacts/categories/元信息，成员重构）、
  project.service/routes（能力中枢 + 4 类 CRUD）、procurement（schema/service/
  routes 改供应商引用 + 类别）、drive.permission、备份贡献（约 3 文件）、
  `0009` 迁移、相关 service 测试。
- 前端：设置对话框（拆 5–6 组件）、roles/contacts/categories API client、
  采购表单接入、概览元信息、能力门控改造、i18n（en/zh）。
- 合计约 40–45 文件。规模大、跨模块、破坏性。

## Alternatives（备选，已否决）

- 角色保持 pm/member（R1）——用户已要求可配置多角色，否决。
- 供应商即外部成员（S1）——用户已要求独立外部联系人表，否决。
- 联系人/类别做成全局共享字典——项目自治更简单，按项目维护，全局化留作未来。
- 元信息用 EAV/自定义字段——YAGNI，固定列足够。

## Annotations（标注）

- 2026-05-23（决策确认，用户）：D1 可配置多角色、D2 外部联系人表按 type、
  D3 成员并入项目设置。据此重写本计划。
- 2026-05-23（D2 修正 + D4 新增，用户）：成员=操作角色（可为虚拟用户，保留
  `userId` 可空 + `displayName`，仍可被指派）；供应商=元信息（`project_contacts`，
  不可指派）。新增 D4：项目列表首页卡片化，按状态（含归档）筛选。
- 2026-05-23（D4 细化，用户）：项目分类改用**用户自定义标签**（全局 `tags` +
  `project_tags` 多对多，按 tag 划分），取代固定类型枚举（A5/A7）。无遗留待确认项，
  `proceed` 后置 Approved 并实施。
- 2026-05-23（完成）：已实施并通过 `bun run check`（lint + typecheck + 测试
  api 640 / web 99 + build + i18n + env-docs + api-docs）。迁移为 `0009_small_jack_flag`。
  顺带修复 `gen-api-docs.ts` 历史遗漏——补挂 `projectRoutes`/`procurementRoutes`，
  现在 api-routes.md 覆盖项目全部端点。抽出 `-project-form-logic.ts` 纯函数并补单测，
  使 web 分支覆盖率回到阈值之上（4.32% ≥ 4%）。`managerMemberId` 用应用层 SET NULL
  （removeMember 事务内清指针），未建 projects↔members 的 FK 环。
