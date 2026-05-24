# FEAT-009 船舶（游艇）管理模块

- **status**: completed
- **priority**: P1
- **owner**: BKD L2 campaign
- **createdAt**: 2026-05-24

## Description

新增 `ship` 模块，覆盖游艇制造 + 运营全生命周期，并支持一船挂接多个工程项目。
与 `project` 模块平级、同构；权限复用 project 的自定义角色 + 能力位体系；
维护工单复用 `item`/`issue`；文件清单复用 `drive`（船文件即基础项目文件）。

v1 验收范围（用户 2026-05-24，含四轮修订）：

1. 创建船时自动建一个基础项目（权限锚点 + 文件载体）；船基本信息 CRUD + `lifecycleStage`。
2. 船↔项目：`projects.shipId`（一船多项目）；基础项目自动绑定且不可解绑，可额外配置绑定/解绑其它项目。
3. 权限锚定基础项目：船不设角色/成员，读=基础项目成员、写=`project.manage`；创建/删除 adminRequired。
4. 设备清单（`ship_equipment`）CRUD。
5. 维护模版（`maintenance_templates`）：全局知识库（admin）+ 船级副本（可从全局复制一份，复制后独立）；工单引用船级模版。
6. issue 通用引用功能（`issue_references`，软引用，issue 核心不改）；维护工单 = 项目 issue + 引用模版，工单页内显示注意事项 + 维护内容。
7. 船文件 = 基础项目文件：drive 零改动，前端 Files 页渲染基础项目 FileBrowser。
8. 前端 `/ships` 列表 + 详情页签（概览/设备/维护/项目/文件）+ i18n + search 接入。

验收标准：`bun run check` 绿；主流程 e2e 通过；权限 fail-closed（非基础项目成员不可读船及其文件）。

详见 [PLAN-011](../plan/PLAN-011.md)。

## ActiveForm

Building the ship (yacht) management module

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

跨模块改动：`ship`(新) / `projects`(加 shipId + 联动建基础项目) / `issue`(加通用
`issue_references`，核心不改) / 前端。**drive 零改动**（船文件复用基础项目 drive）。
分阶段交付见 PLAN-011 Scope。

进度（BKD campaign `l1-uel9ph5t-20260524182958`）：后端 T1–T4 + 前端 T5a/T5b 已合并 main
（`bun run check` 绿，api 1055/0）；最终任务 T6（主流程 e2e + 最终质量门 + 文档收尾）进行中。
完成并验收后置为 completed。
