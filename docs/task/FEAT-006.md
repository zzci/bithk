# FEAT-006 — 边栏全局搜索与命令面板

- **状态：** Done
- **计划：** [PLAN-007](../plan/PLAN-007.md)
- **创建时间：** 2026-05-23

## 范围

边栏新增搜索入口，唤起命令面板弹窗：包含快速入口（导航跳转）与跨模块全局
内容搜索（文档、事项、项目、网盘文件）。搜索权限范围复用各模块已有的带
权限过滤列表函数，不另写权限逻辑。研发阶段——接受破坏性更改。

- 后端新增 `search` 模块：`GET /search`，聚合 `listMyDocuments` /
  `listIssues`|`listMyIssues` / `listProjects` / 新增 `searchDriveEntries`。
- `project.service` 增加 `q` 过滤（name/code）。
- `drive.service` 增加 `searchDriveEntries`，范围 = 个人盘 + 所属团队目录 +
  所属项目盘。
- 前端重写搜索面板为命令面板（`command-palette.tsx`），边栏加触发项与
  全局 `⌘/Ctrl+K`。

## 验收

- `bun run check`（lint + 类型检查）通过。
- 后端 `search.test.ts`：四类来源的权限范围正确（非成员看不到他人资源）。
- 前端 `command-palette.test.tsx`：空查询显示快速入口；查询显示分组结果；
  非管理员看不到管理类快速入口。
- 手动：⌘K 唤起面板，输入可过滤并跳转；折叠态边栏入口有 tooltip。

## 已知限制

- 网盘结果跳转至 `/drive` 根（drive 路由暂无深链搜索参数）。文档/事项/项目
  通过 short-id 路由深链。
