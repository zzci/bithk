# DOCS-001 模块文档与代码对齐

- **status**: done
- **priority**: P2
- **owner**: docs maintenance
- **createdAt**: 2026-05-24

## Description

审核 `apps/api/src/modules/*` 全部 16 个模块的代码，与 `docs/modules/*.md`
逐一比对，补齐缺失文档并修正失真，使文档与代码一致。

发现汇总（6 个并行审核代理 + 人工复核）：

- **缺失文档**：`search`、`share` 两个代码模块无文档页，README 索引亦漏列。
- **HIGH 失真**：
  - `issue`：文档仍描述"个人 issue"+ `/api/issues` 全套路由，REFACTOR-002
    后已全部移除（`projectId` NOT NULL，仅 `/projects/:projectId/issues/*`）。
  - `procurement`：`supplier_id` 实为 `project_contacts` 外键（文档写成
    `supplier_member_id` → `project_members`）；权限改为能力位
    `procurement.view/manage`（文档写 `can_view_procurement` + `canViewProcurement()`）；
    漏 `categoryId` 过滤与创建字段。
  - `document`：FEAT-007 新增 `PUT/DELETE /documents/:id/pin` + `document_pins`
    表，文档完全未记。
- **MED/LOW 失真**：
  - `document`/`drive`：分享路由已迁到统一 share 模块（FEAT-002），文档仍写
    `/drive/shares/*`、`/documents/:id/public-links`。
  - `cron`：路由表漏 `lastStatus` 过滤参数；`task_type` 派生列未提。
  - `item`：评论删除文档说"不级联释放附件"，代码已改为同步释放。
  - `account`：DEFAULT_ADMIN 提升条件应为"无 admin 存在时"（非"users 表为空"）。
- **准确无需改动**：`audit` `backup` `project` `policy` `settings` `system` `file`。

## ActiveForm

Aligning module documentation with code

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

纯文档改动，不触碰 `apps/api` 代码。进行中的 `ship` 模块（FEAT-009/PLAN-011）
代码尚未落地，本任务不为其补文档。文档沿用英文以匹配 `docs/modules/` 既有约定
与上游 fork 同步需要。详见 [PLAN-012](../plan/PLAN-012.md)。
