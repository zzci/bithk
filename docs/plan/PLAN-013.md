# PLAN-013 — 联系人独立为全局通用模块

- **状态：** Done
- **任务：** [REFACTOR-003](../task/REFACTOR-003.md)
- **更新时间：** 2026-05-24
- **执行：** BKD L1 campaign（L1=q4ueexed，L3 引擎=codex）

## 目标

把联系人从 project 子模块收敛为独立的全局目录模块：单一全局 `contacts` 表跨所有
项目共享。访问控制按归属（创建者 owner 可管理），支持可见范围控制与保密字段脱敏；
分类用全局 tag 自定义；procurement 供应商改引用全局联系人。

## 现状梳理（调查结论）

- 表：`project/schema.ts:87` `project_contacts`，`project_id` NOT NULL + cascade，
  含固定 `type` 枚举（supplier/client/subcontractor/other）与 `status`。
- 服务/路由：`project.contacts.ts`、`project.routes.ts:330-361` `/projects/:id/contacts*`，
  受 per-project 能力 `contacts.manage`。
- 跨模块：`procurement/schema.ts:26` `supplier_id -> project_contacts.id` (set null)；
  `procurement.service.ts` 用 `resolveContact(db, projectId, supplierId, "supplier")`。
- 前端：`-project-settings-contacts.tsx`、`api/projects.ts` 联系人 hooks、
  `-project-procurement-tab.tsx:78` `useProjectContacts(projectId,"supplier")`、
  i18n `projects` 命名空间 `contacts.*`。
- 可复用基础设施：
  - policy 引擎 `defineResource` + 命名空间（`item`/`drive` 范式：owner/viewer 关系，
    bypass 钩子做能力解析，404 隐藏存在性）。
  - `shares` 多态表（resourceType 可扩展，direct/public_link，view/edit）。
  - 全局 `tags` 表（无 projectId，`project_tags` M2M 为先例）。

## 访问控制与可见性模型（核心）

新增 policy 命名空间 `contact`，关系：
- `owner`：创建者，完整管理 + 见全部字段；建表时写 `contact:<id>#owner@user:<creator>`。
- `viewer`：可见该联系人；隐式来自 `visibility=public`，或显式授权 tuple
  （`contact:<id>#viewer@user:<uid>` / `@group:<gid>#member`）。

`contacts` 列：
- `owner_id`：创建者（同时落 tuple，列用于廉价列表/过滤）。
- `visibility`：`private` | `public`。private 仅 owner + 显式 viewer 可见；public 全体登录用户可见。
- `confidential`：布尔。控制**保密字段脱敏**。

字段可见规则（compose 时按 actor 能力裁剪）：
- owner / admin / 显式 viewer：见全部字段。
- public 隐式 viewer 且 `confidential=true`：**仅保留 name + tags**，其余全部脱敏
  （contactPerson / phone / email / address / taxId / note / status 均隐藏）。
- public 隐式 viewer 且 `confidential=false`：见全部字段。

**定稿决策**：
- A：采用**完整 tuple 授权** —— 支持显式 per-user/group 的 `viewer` 授权（policy
  tuple），并提供授权/撤销端点；private 联系人可单独分享给指定用户/组。
- B：保密脱敏后**仅保留 name 与 tags**，其余字段一律隐藏。
- C：**删除 `rating` 字段**。

## 分类（tag）

- 删除固定 `type` 枚举。新增 `contact_tags(contact_id, tag_id)`，`tag_id` 引用全局 `tags`。
- 列表支持按 tag 过滤；创建/编辑可挂多个 tag（复用既有 tag 录入/自动建 tag 逻辑）。
- `status`（active/inactive）作为生命周期字段保留（非分类）。

## 步骤

### API

1. `modules/contact/schema.ts`：`contacts`（id/owner_id/name/contact_person/phone/
   email/address/tax_id/status/visibility/confidential/created_at/updated_at，**无 rating**）
   + `contact_tags`。`CONTACT_STATUSES` 迁此。
   -> 验证：类型通过。
2. `contact/contact.permission.ts`：`defineResource` 注册 `contact` 命名空间
   （owner/viewer），bypass 解析 owner/admin/public/显式 viewer；脱敏判定 helper。
   `namespace-config.ts` 增 `contact` 关系定义。
   -> 验证：权限单测通过。
3. `contact/contact.service.ts`：`list(actor, { tag?, visibilityScope? })` 仅返回可见项
   并按能力脱敏；`get`/`create`（写 owner tuple）/`update`/`delete`（删 tuple、tag、
   share）；tag 挂载/解绑；`resolve(id)` 供 procurement 校验。`compose(row, { full })`。
   -> 验证：service 单测（归属/可见/脱敏/tag）通过。
4. `contact/contact.routes.ts` + `index.ts`：`GET /contacts`（tag/范围过滤）、
   `POST /contacts`（任意登录用户，成为 owner）、`GET/PATCH/DELETE /contacts/:id`
   （读 viewer、写 owner，经 policy 中间件自动门禁）；可见范围授权端点（若采纳显式授权）。
   `protected.ts` 注册 `contactRoutes()`。
   -> 验证：路由测试通过。
5. project：删 `project.contacts.ts`、`project.routes.ts` 联系人段；`PROJECT_CAPABILITIES`
   去 `contacts.manage`；`schema.ts` 删 `project_contacts` 与 `CONTACT_TYPES/STATUSES`；
   更新 `project.backup.ts`。
   -> 验证：项目模块测试通过。
6. procurement：`schema.ts` `supplier_id -> contacts.id`；`procurement.service.ts` 改用
   `contact.resolve(db, supplierId)`（去 projectId 与 type），更新 `procurement.backup.ts`
   与测试。
   -> 验证：procurement 单测+路由测试通过。
7. backup：联系人导出/导入迁到 contact 段（全局，含 tag 关联）。
   -> 验证：backup 往返测试通过。
8. `drizzle-kit generate` 生成迁移（删 `project_contacts`、建 `contacts`+`contact_tags`、
   改 `supplier_id` FK）。
   -> 验证：迁移可应用，`bun run check`(api) 通过。

### Web

9. `shared/lib/api/contacts.ts`：类型（`ContactView` 含可空敏感字段 + `tags` + `visibility`
   + `confidential` + `canManage`）、`useContacts({tag?})`/`useContact`/`useCreate`/
   `useUpdate`/`useDelete`（+ 授权 hook 若采纳）；从 `api/projects.ts` 删联系人导出与
   `contacts.manage`。
10. 全局页面 `routes/_app/contacts/`：列表 + tag 过滤 + 创建/编辑对话框（含 tag 录入、
    visibility/confidential 控件）+ 删除确认；脱敏项以「—/🔒」展示；管理按钮按 `canManage`
    显隐；侧栏 `sidebar/registry.ts` 入口、命令面板可选收录。复用并改造现有联系人对话框。
11. project 设置对话框移除联系人分页（`-project-settings-dialog.tsx`），删
    `-project-settings-contacts.tsx`。
12. procurement tab 供应商下拉改 `useContacts()`（全部联系人，可 tag 过滤）。
13. i18n：新增 `contacts` 命名空间（zh/en），从 `projects` 迁出 `contacts.*`，补可见范围/
    保密/tag 文案；更新 sidebar/命令面板。
    -> 验证：`bun run check`(web)、`check:i18n` 通过，`routeTree.gen.ts` 重生成。

### Docs

14. `docs/architecture.md`（模块表 + 权限模型补 contact）、`docs/api-routes.md`、
    `docs/changelog.md`；如模块文档目录存在则补 `docs/modules/contact.md`。

## 风险

- 破坏性 schema 变更：无数据，迁移即重建表，安全；迁移须 drizzle-kit 生成，禁手写。
- procurement `supplier_id` 外键改指向需同批迁移，避免悬挂引用；去掉 type 后供应商语义
  弱化为「任意联系人」，需确认 procurement 文案/筛选默认值。
- 新增 policy 命名空间需同步 `namespace-config.ts` 与引擎测试；可见范围 + 脱敏组合需
  覆盖：owner / admin / public-非保密 / public-保密 / private-未授权 / private-显式授权。
- `routeTree.gen.ts` 重生成；工作区有 FEAT-009/PLAN-011 文档改动，本次只做外科式编辑。
- i18n key 跨命名空间迁移，`check:i18n` 守护防遗漏。

## 决策（已定稿）

- A：完整 tuple 授权 —— private/public + 显式 per-user/group `viewer` 授权 + 授权/撤销端点。
- B：保密脱敏仅保留 name + tags，其余字段全部隐藏。
- C：删除 `rating`；保留 `status`。
