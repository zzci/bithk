# FEAT-008 — 项目模块完善：项目设置中心 + 供应商目录 + 采购类别 + 元信息

- **状态：** Done
- **计划：** [PLAN-010](../plan/PLAN-010.md)
- **创建时间：** 2026-05-23
- **负责人：** main

## 背景

当前 project 模块（FEAT-004 落地）的"编辑项目"弹窗过于简单，仅有
name / code / status / description / 起止日期 6 个字段。供应商以"外部成员 +
freeform `supplier_info` JSON"承载，无结构化供应商目录；采购无类别维度；项目
缺少真实工程项目的业务元信息（业主、合同、预算、地址、负责人等）。

用户要求：以一次完整的真实工程项目分析为依据，把"项目设置"做成功能完善的
配置中心，覆盖元信息、成员与角色、采购供应商、采购类别等项目级配置。开发态、
无存量数据，接受破坏性更改。

## 范围

- API：扩展 `projects` 元信息列；新增 `project_suppliers`（供应商目录）与
  `procurement_categories`（采购类别）两张项目级表及其 routes/service；
  `procurement_details` 接入 `categoryId` 与（改造后的）供应商引用；成员新增
  `title`（职务，展示用）字段；新增/调整备份贡献；1 个 Drizzle 迁移。
- Web：把"编辑项目"升级为分区式"项目设置"对话框（General / Members & Roles /
  Contacts / Procurement Categories），新增供应商联系人、类别的 API client 与 UI；
  采购创建/编辑接入类别与供应商；项目列表首页改卡片栅格、按类型与状态（含归档）
  筛选；概览页展示元信息；EN/ZH i18n 分片。
- 文档：`docs/reference/api-routes.md`、`docs/modules/project.md`、changelog。

## 验证

- `bun run check`（apps/api + apps/web）通过。
- project / procurement / suppliers / categories 的 service 测试通过；
  采购授权 fail-closed 行为不回退。

## 关联 / 顺序

- 与 REFACTOR-002（issues 迁入 projects）互不重叠（本任务不动 issue 代码路径），
  可独立推进；两者都会改项目详情页 tab 区，需在合并点协调。
