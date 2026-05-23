# PLAN-004 — 工程项目管理模块

- **status**: completed
- **createdAt**: 2026-05-23
- **approvedAt**: 2026-05-23
- **completedAt**: 2026-05-23
- **relatedTask**: FEAT-004

## Context（背景与现状）

本模块复用的现有构件（来自模块文档与代码核实）：

| 构件 | 提供能力 | 来源 |
| --- | --- | --- |
| `item` 基类 | title/status/version/软删除 + 评论 + 附件 + `owner`/`editor`/`viewer`/`assignee`/`approver`/`watcher`/`parent_item` tuples | `modules/item` |
| 子类型范式 | 以 `item_id` 为主键的 `<name>_details` 表、薄 service、`/api/<name>` 路由、备份贡献、导航项 | `item.md` §Adding a sub-type |
| `drive` | 文件夹树 + 版本 + 预览；`owner_type ∈ {user, team_directory}`，**`project` 暂缓** | `drive.md` §Out of scope |
| `policy` | Zanzibar tuples，路由层 `check` / `listObjects` | `modules/policy` |
| `account` | OAuth 支撑的 `users`；会话存上游 token | `account.md` |
| `audit` / `backup` | 逐动作事件；逐模块备份贡献 | `audit.md` / `backup.md` |

调研暴露的约束：

1. **外部成员无法使用以 user 为键的 tuple。** `item` 的 `assignee` 关系是
   `item:X#assignee@user:Y`。外部（供应商 / webhook）成员没有 `users.id`，
   因此指派必须指向 `project_members.id`，而非 user tuple。这是下文的核心设计点。
2. **项目不是 `item`。** 因此工单 / 采购的可见性无法通过 `parent_item` 继承；
   改在路由层依据 `project_members` 裁决（与 `issue` 的 creator/assignee
   路由层裁决同形）。
3. **drive 改动与 FEAT-002 共线。** FEAT-002 统一分享模块现已 Done；drive
   `project` ownerType 改动需在合并后的分享模块上 rebase。

## Proposal（方案）

六个部分。研发阶段——破坏性、不迁移存量。

### 1. `project` 核心模块 —— `apps/api/src/modules/project/`

独立模块，自持表（参照 `drive`）。

**`schema.ts`**

```ts
export const PROJECT_STATUSES = ["active", "archived", "closed"] as const;
export const MEMBER_TYPES = ["internal", "external"] as const;
export const MEMBER_ROLES = ["pm", "member"] as const;

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),               // ulid
  shortId: text("short_id").notNull(),       // nanoid, URL/API 暴露
  code: text("code").notNull(),              // 人类可读项目编号，唯一
  name: text("name").notNull(),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  description: text("description"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("projects_short_id_idx").on(t.shortId),
  uniqueIndex("projects_code_idx").on(t.code),
  index("projects_status_idx").on(t.status, t.deletedAt),
]);

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  memberType: text("member_type", { enum: MEMBER_TYPES }).notNull(),
  role: text("role", { enum: MEMBER_ROLES }).notNull().default("member"),
  // internal：关联真实用户
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  // external：展示名 + 供应商信息 + 外部系统关联（webhook/事务 id）
  displayName: text("display_name"),
  externalRef: text("external_ref"),
  supplierInfo: text("supplier_info"),       // JSON：{ contact, ... } —— 外部供应商
  // 模块可见性授权（PM 隐式为 true）
  canViewProcurement: integer("can_view_procurement").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("project_members_project_idx").on(t.projectId),
  index("project_members_user_idx").on(t.userId),
  uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId), // 每项目每真实用户一行
]);
```

- **单一成员表**（按需求）：`memberType` 区分内部 / 外部；`userId` 仅内部填写；
  `externalRef` / `supplierInfo` 承载外部关联。**转正** = 设置 `userId` 并把
  `memberType` 改为 `internal`（无需移动行）。
- 创建项目**仅管理员**；创建者作为该项目的 `pm` 成员写入。
- `projectMembers.id` 是指派的规范目标（见 §2/§3）。

**`project.service.ts`**——项目 CRUD + 成员 CRUD + 辅助：
`isMember(projectId, userId)`、`getRole`、`canViewProcurement`、
`resolveAssignableMember(projectId, memberId)`。软删除走 `deletedAt`。

**`project.routes.ts`**——`/api/projects`（list/create/get/patch/delete）与
`/api/projects/:id/members`（list/add/update/remove）。创建受 `adminRequired`
约束；其余按项目成员 / 角色裁决。

### 2. 工单（issue）—— **复用并扩展 `issue` 子类型**

工单即项目内的 issue。复用现有 `issue` 模块，而非新建子类型或删除它。扩展
`issue_details`：

```ts
// 在现有 issue_details 表上新增两个可空列
export const issueDetails = sqliteTable("issue_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  description: text("description"),
  priority: text("priority"),
  dueDate: text("due_date"),
  // 新增 —— 项目归属
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
}, t => [index("issue_project_idx").on(t.projectId)]);
```

- `projectId` **可空**：`NULL` = 个人 issue（原有行为，仅用 user tuple 指派）；
  有值 = 项目工单。blast radius 最小——不迁移存量，个人 issue 路由/测试零改动。
- **项目工单的指派目标为 `project_members.id`**（统一覆盖内部 + 外部）。当指派
  对象为内部成员时，service **同时**写 `item#assignee@user:<userId>` tuple 以
  保持现有 item 指派语义；外部成员仅写 `assignee_member_id` 列（不写 user tuple）。
- issue 路由新增项目维度的路径/筛选：按 `project_id` 列表、带 `projectId` 创建、
  项目场景下按成员裁决（个人 issue 保持 creator/assignee 裁决）。评论/附件不变
  （`mountItemCommentRoutes`）。
- `issue_details` 已有备份贡献——扩展即可，不新增。

### 3. `procurement` —— `item` 子类型 —— `apps/api/src/modules/procurement/`

```ts
export const PROCUREMENT_STATUSES =
  ["draft", "requested", "ordered", "received", "closed"] as const;

export const procurementDetails = sqliteTable("procurement_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierMemberId: text("supplier_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity"),
  amount: integer("amount"),                 // 最小货币单位
  currency: text("currency"),
}, t => [index("procurement_project_idx").on(t.projectId)]);
```

- `items.status` 承载采购生命周期（`draft → requested → ordered → received →
  closed`）；子类型在 zod 边界校验允许值（参照 `item.md`）。
- **基于评论的事件日志**：状态流转产出 `procurement.status_changed` 审计行
  （谁/何时），成员通过普通 `item_comments` 关联上下文。无独立历史表（参照
  `item.md`——审计已回答"谁在何时做了什么"）。
- **可见性授权**：采购 list/detail 路由要求项目成员**且**（`role=pm` 或
  `canViewProcurement=1`）。fail-closed。

### 4. drive —— 新增 `project` ownerType

- 扩展 `drive_entries.owner_type` 枚举增加 `project`；`owner_id` = 某个
  `projects.id`。
- 权限解析：`resolveEntryCapabilities` 增加第三类 owner 分支——对 `project`
  所属条目改查 `project_members`（`pm`/内部 `member` → 能力），而非
  `team_directory_members`。
- 项目的文件根在创建项目时建立/注册，且受**保护**：drive 的
  delete/trash/permanent 路由拒绝 `project` 所属根条目。
- 前端复用现有 `FileBrowser`，作用于 `ownerType=project&ownerId=<projectId>`。

### 5. 权限汇总（路由层裁决，无项目 tuple）

| 面 | 裁决 |
| --- | --- |
| 创建项目 | `adminRequired` |
| 项目读取 / 成员操作 | 项目成员；成员管理 = `pm` |
| issue 读写（项目维度） | 项目成员（assignee 可改 status）；个人 issue 保持原有裁决 |
| 采购读取 | 成员 且（`pm` 或 `canViewProcurement`） |
| 项目文件 | 经 drive 能力分支按成员裁决 |

### 6. 事件 —— 仅设计

记录入站（外部 → 项目：webhook 接入，以 `project_members.external_ref` 为键）
与出站（项目动作 → 外呼通知）的设计，并在 service 层预留接缝。**不实现**——
延后到未来的全局通知 / 事件分发模块。

### 移除项

无。`issue` 是复用扩展（§2），不删除。

### 备份

- `projectBackupContribution`——`projects`、`project_members`；deps `users`。
- `procurementBackupContribution`——`procurement_details`；deps `items`、
  `policies`、`projects`。
- 现有 `issueBackupContribution`——基本不变（两个新列搭在同一张
  `issue_details` 表上）；给其 deps 增加 `projects`。

### 前端（portal）

- 导航项 "Projects"（`project.nav.ts`）。
- 项目列表页（管理员可见创建入口）。
- 项目详情，页签：**Overview**、**Issues**、**Procurement**（仅在查看者有授权
  时渲染）、**Files**（drive `FileBrowser`）、**Members**。
- 按模块规范提供 `{en,zh}` i18n 分片。

## Risks（风险）

- **指派模型偏离**——指派目标为 `project_members.id`，而非 item 的
  `assignee@user` tuple。内部 assignee 二者都写，外部仅写列。读取 assignee
  tuple 的列表/通知代码须改为读列。最需关注项。
- **外部成员无 `users.id`**——无法登录；外部驱动变更的审计 actor 须有表达方式
  （service actor / 代操作的 PM）。开工前先定审计 actor 约定。
- **drive `project` 分支 vs FEAT-002**——FEAT-002 已 Done，在合并后的分享模块
  上 rebase 能力解析器 / 分享适配器。
- **扩展 `issue`（而非删除）**——新增可空 `projectId` / `assigneeMemberId` 保
  个人 issue 不变。双模裁决（个人 vs 项目）不得让项目 issue 泄漏给非成员，也
  不得破坏现有个人 issue 的列表/筛选路径或测试。
- **采购授权 fail-closed**——缺失/为 0 的授权须完全隐藏采购（列表 + 详情 +
  采购附件），而不仅是隐藏导航。
- **`projects` 不经 `item` 软删除**——自持 `deletedAt`；级联到
  成员/工单/采购/文件须定义清楚（detail 行的 `project_id` 走 FK
  `ON DELETE CASCADE`；drive 项目条目需显式清扫）。

## Scope（改动规模）

- 后端：新 `project` 模块（约 4 文件）、扩展 `issue`（schema + service +
  routes，约 3 文件）、`procurement` 子类型（约 5 文件）、drive ownerType
  改动（约 3 文件）、2 个新备份贡献 + 1 处 deps 调整、1 个 Drizzle 迁移。
- 前端：项目列表 + 详情（页签）+ 成员 UI、复用 drive 浏览器、issue 界面增加
  项目维度模式、导航项、i18n 分片。约 10–12 文件。
- 测试：project / procurement 服务测试；扩展 issue 的项目维度测试（个人 issue
  测试保留）；drive 项目 owner 能力测试；项目主流程 e2e。
- 合计约 35 文件。规模大、跨模块、破坏性。

## Alternatives（备选）

- **新建 `work_order` 子类型 + 删除 `issue`。** 此前的方案；按用户意见回退——
  `issue` 本就是工单类工作的 item 子类型，故复用并扩展项目归属，而非先重复
  再删除。
- **工单做成独立表（非 item 子类型）。** 否决——item 已自带
  assignee/approver/watcher/评论/附件，恰是工单所需。
- **项目文件用 `file_references` 扁平附件。** 否决——需求是完整的 drive 文件
  管理器（树 + 版本 + 预览），故 drive `project` ownerType 复用整套栈。
- **项目做成 `item` 子类型**（以继承 `parent_item` 可见性）。否决——项目是带
  成员的聚合/容器，不是内容对象；路由层成员裁决更简单，且与 `drive` 一致。

## Annotations（标注）

- 2026-05-23（修订，用户）：`work_order` 更名为 `issues`；**复用现有 `issue`
  模块**而非删除。工单即项目维度的 issue——扩展 `issue_details`，新增可空
  `projectId` + `assigneeMemberId`；个人 issue 保持不变。
- 2026-05-23（需求，用户）：工单 = item 子类型；**删除 `issue` 演示模块**
  （已被上一条修订取代）。项目文件 = drive `project` 目录（新 ownerType，不复用
  team 目录，避免与 team 冲突）。单一成员表带类型列；外部成员关联供应商 / 外部
  事务 id（如 webhook id），可像真实用户一样被指派任务，通过改关联转正。角色：
  仅 `pm` + `member`；模块级可见，不做字段级。采购可见性按成员授权控制。采购用
  默认状态集 + 基于评论的事件日志。仅管理员可创建项目。事件（入/出）本期仅
  设计，后续经全局通知模块路由。项目扁平。
