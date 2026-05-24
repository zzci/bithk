# REFACTOR-003 — 联系人模块独立为全局通用模块

- **状态：** Done
- **计划：** [PLAN-013](../plan/PLAN-013.md)
- **创建时间：** 2026-05-24
- **负责人：** L1 q4ueexed (BKD campaign)

## 背景

联系人（供应商/客户/分包/其他）当前内嵌在 project 模块，按项目作用域存储：
`project_contacts.project_id` 为 NOT NULL，路由挂在 `/projects/:id/contacts*`，
受按项目角色能力 `contacts.manage` 管控。唯一跨模块消费方是 procurement——
`procurement_details.supplier_id` 引用 `project_contacts.id`，并校验供应商属于
同一项目。

需求：联系人本质应是全局通用目录，跨所有项目共享，避免在每个项目重复录入同一
供应商。将这部分从 project 中抽离为独立的全局模块。

确认的设计取向（用户答复）：
1. 访问控制按**归属**：谁创建谁可管理（owner 权限）；联系人需**可见范围控制**，
   并可对**具体联系信息做保密（脱敏隐藏）**。
2. **不**保留项目专属供应商，纯全局。
3. 分类**自定义**，用 **tag** 灵活处理（复用全局 `tags`），去掉固定 `type` 枚举。

开发态、本地数据，接受破坏性更改，无需考虑兼容/数据迁移。

## 范围

- 新增 `apps/api/src/modules/contact/` 全局模块（schema/service/routes/permission/index）。
- 删除 project 模块内联系人代码与 `project_contacts` 表；新增全局 `contacts` +
  `contact_tags`（复用全局 `tags`）。
- 接入 policy：新增 `contact` 命名空间（owner/viewer），owner+admin 可管理；
  可见范围（private/public + 可选显式授权）与保密字段脱敏。
- procurement：去掉 `type=supplier` 概念，`supplier_id` 改引用全局 `contacts.id`，
  校验改为「存在的全局联系人」；下拉列出全部联系人（可按 tag 过滤）。
- 移除 `PROJECT_CAPABILITIES` 中的 `contacts.manage`。
- 前端：新增全局 `/contacts` 页面与 `api/contacts.ts`（含 tag 过滤、可见范围/保密
  开关、脱敏展示、归属管理）；从 project 设置移除联系人分页；procurement 选择器改
  全局 hook；i18n 抽出 `contacts` 命名空间。
- 文档：api-routes、architecture、changelog。

## 验证

- `bun run check`（apps/api + apps/web）通过。
- contact 模块单测 + 路由测试（归属/可见范围/脱敏/tag）；procurement 校验测试更新通过。
- 受影响前端测试（project 设置、procurement tab）更新并通过。
