# PLAN-009 — issues 整体迁入 projects 子模块

- **状态：** Done
- **任务：** [REFACTOR-002](../task/REFACTOR-002.md)
- **更新时间：** 2026-05-23

## 目标

将 issue 从"全局 + 项目"双模式收敛为纯项目子模块，对齐 procurement 范式，
功能完整保留，仅移除全局入口与个人 issue 概念。

## 步骤

### API

1. `schema.ts`：`issue_details.project_id` → `NOT NULL`；删个人 issue 注释。
   -> 验证：drizzle 生成迁移，类型通过。
2. `issue.service.ts`：删 `listIssues`/`listMyIssues`/`projectIssueItemIds`/
   `resolveAccess`/`getUserById`；`CreateIssueInput`/`UpdateIssueInput` 去掉个人
   `assigneeId`，`projectId` 必填；保留 `listByProject`/`resolveProjectIssueAccess`/
   `composeIssue`/`getIssueByShortId`/`softDeleteIssue`/`resolveIssueItem`；新增
   搜索用 `searchIssuesForUser`。
   -> 验证：单测通过。
3. `issue.routes.ts`：删全局 `GET/POST /issues` 与 `/issues/:id*`；详情/更新/删除/
   附件/评论迁到 `/projects/:projectId/issues/:id[...]`，鉴权用 `requireProjectMember`
   + `resolveProjectIssueAccess`；评论挂载 routePrefix 改项目作用域。
   -> 验证：路由级测试通过。
4. `search.service.ts` + `search.ts`(web)：issue 命中改项目作用域，`SearchHit` 增
   `projectId`。
   -> 验证：search 测试通过。
5. 生成迁移：`drizzle-kit generate`。

### Web

6. `api/projects.ts`：新增 `useProjectIssue`/`useUpdateProjectIssue`/
   `useDeleteProjectIssue` 与 detail query key。
7. 复用 issue 面板到 `projects/-project-issue-panel.tsx`：项目作用域端点、
   成员制分配（assigneeMemberId）、附件/评论 `resource=projects/:id/issues`。
8. `-project-issues-tab.tsx`：行点击开抽屉（Sheet）；最大化跳全屏。
9. 新建 `projects/$projectId_.issues.$issueId` 全屏路由（非嵌套）。
10. 删 `routes/_app/issues/`、`-issues.nav.ts`；改 `sidebar/registry.ts`、
    `command-palette*`、`common.json`。
    -> 验证：`bun run check`(web) 通过。

### Docs

11. `api-routes.md`、`changelog.md` 更新。

## 风险

- 破坏性 schema 变更：无数据，迁移即重建表，安全。
- `routeTree.gen.ts` 需重新生成。
- 工作区已有未提交文档改动；本次只做外科式编辑，不触碰无关行。
