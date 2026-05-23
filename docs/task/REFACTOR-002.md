# REFACTOR-002 — issues 模块整体迁入 projects 子模块

- **状态：** Done
- **计划：** [PLAN-009](../plan/PLAN-009.md)
- **创建时间：** 2026-05-23
- **负责人：** main

## 背景

issue 原为双模式：全局/个人 issue（`project_id IS NULL`）+ 项目 issue（`project_id` 有值）。
现要求移除全局入口，issue 仅作为 project 的子模块存在，功能完整保留（详情、
编辑、删除、评论、附件、分配）。开发态、无数据，接受破坏性更改。

## 范围

- API：所有 issue 路由迁到 `/projects/:projectId/issues[...]`，删除全局 `/issues*`；
  `issue_details.project_id` 改 `NOT NULL`；删除个人 issue 代码路径
  （`listIssues`/`listMyIssues`/`resolveAccess`/`getUserById` + 个人分配分支）。
- 搜索：issue 命中改为"用户所属项目内的 issue"，深链指向项目作用域路由。
- 前端：复用并改造 issue 详情面板到 projects 区域；Issues tab 行点击开抽屉、
  可最大化到全屏深链路由 `/projects/$projectId/issues/$issueId`；删除全局
  `routes/_app/issues/`、`-issues.nav.ts`、侧栏入口、`common.json` 的 myIssues。
- 文档：api-routes、changelog。

## 验证

- `bun run check`（apps/api + apps/web）通过。
- issue/search/命令面板/侧栏相关测试更新并通过。
