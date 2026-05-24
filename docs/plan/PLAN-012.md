# PLAN-012 — 模块文档与代码对齐

- **status**: done
- **createdAt**: 2026-05-24
- **approvedAt**: 2026-05-24
- **relatedTask**: DOCS-001

## Context（背景与现状）

`apps/api/src/modules/` 现有 16 个模块，`docs/modules/` 只有 14 篇文档，且部分
文档在近期重构后未同步：

- FEAT-002 统一 share 模块 → document/drive 的分享路由迁出，旧文档仍写旧路径。
- REFACTOR-002 取消个人 issue → issue 文档整段过时。
- FEAT-007 文档置顶 → document.md 未记 pin 路由与表。
- FEAT-008 供应商目录 + 采购分类 → procurement.md 字段/权限模型过时。

代码侧路由真值已抽取（`router.<verb>("...")` 全量比对），并经 6 个并行
Explore 代理逐模块审核 + 人工复核确认。

## Proposal（方案）

仅修改 `docs/modules/*.md` 与 `docs/modules/README.md`，不动任何代码。

### 1. 新增文档

- `docs/modules/search.md` — 全局搜索；`GET /search`（`q`、`limit≤20`）跨
  document/issue/project/drive 查询，按模块顺序返回；无自有表；权限由各模块
  list 函数自行裁剪。
- `docs/modules/share.md` — 统一分享；`shares` 多态表；管理路由 `/shares/*`
  + 公开路由 `/shared/:token*`；adapter 注册（document/drive）；令牌闸门
  （密码/过期/下载预算）。

### 2. README 索引

`docs/modules/README.md` 在 reference 模块表补 `share`，在合适分组补 `search`。

### 3. 修正失真

| 文件 | 改动 |
| --- | --- |
| `issue.md` | 删除"个人 issue"语义与 `/api/issues` 路由表；改为项目工单专属（`projectId` NOT NULL，路由 `/projects/:projectId/issues/*`）。 |
| `procurement.md` | `supplier_member_id`→`supplier_id`(`project_contacts`)；补 `category_id`；权限改 `hasCapability(procurement.view/manage)`；列表补 `categoryId` 过滤；创建体补 `categoryId`、改 `supplierId`。 |
| `document.md` | 补 `PUT/DELETE /documents/:id/pin` 路由与 `document_pins` 表；分享改指向统一 share 模块。 |
| `drive.md` | 分享路由改指向统一 share 模块（`/shares/drive_entry/:id`、`/shared/:token`）。 |
| `cron.md` | 路由表补 `lastStatus` 过滤；说明 `task_type` 派生列。 |
| `item.md` | 评论删除改为"同步释放附件（async GC 契约）"。 |
| `account.md` | DEFAULT_ADMIN 提升条件改为"当前无 admin 时"。 |

## Scope（范围）

- 仅文档；`apps/api` 代码零改动。
- 不为进行中的 `ship` 模块（FEAT-009）补文档（代码未落地）。
- `document.permission.ts:73-76` 残留未实现路由声明属代码问题，本次仅在文档
  中体现迁移结果，不改代码。

## Verify（验证）

- 逐模块用代码路由真值再次核对修改后的文档。
- README 索引行数 = 16 个模块全覆盖（item 无路由但有文档）。

## Risks（风险）

低。纯文档改动，无代码/测试影响。
