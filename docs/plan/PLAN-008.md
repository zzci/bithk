# PLAN-008 — 文档行内操作菜单 + Pin 与默认页置顶列表

- **状态：** Done
- **任务：** [FEAT-007](../task/FEAT-007.md)
- **更新时间：** 2026-05-23

## 目标

为文档树每行提供完整操作入口（添加子文档 / 重命名 / Pin / 删除），并把空白
的文档默认页改为展示按用户隔离的置顶文档列表。

## 关键决策

- **Pin 按用户隔离**：文档 owner-scoped 且可分享，pin 不能是 `document_details`
  的共享列。新建独立表 `document_pins(user_id, item_id)`，与授权解耦。
- **无独立置顶列表接口**：`getDocumentTreeForUser` 已返回当前用户全部可见文档，
  仅需 LEFT JOIN 出每行 `pinned` 布尔；默认页在前端按 `pinned` 过滤即可。
- **pin 鉴权**：要求对目标文档有 `document:read`（owner 或被分享）。

## 步骤

1. **后端 schema**：`document/schema.ts` 新增 `documentPins` 表
   （`userId` → users.id cascade，`itemId` → items.id cascade，复合主键，
   `createdAt`）。→ verify：`bun run db:generate` 生成新迁移，snapshot 更新。
2. **后端 service**：`pinDocument` / `unpinDocument`（short_id 解析 + read 鉴权
   留给路由层）；`getDocumentTreeForUser` 查询加 pin LEFT JOIN，节点加 `pinned`。
   → verify：service 单测通过。
3. **后端路由**：`PUT /documents/:id/pin`、`DELETE /documents/:id/pin`，
   在 handler 内 `documentAccess.assert(..., "document:read", item.id)`。
   注册到 `document.permission.ts` 路由表（read 级）。→ verify：路由测试。
4. **前端 API client**：`DocumentTreeNode` 加 `pinned`；新增
   `usePinDocument` / `useUnpinDocument`，成功失效 tree 查询。
5. **前端侧边栏**：`TreeRow` 右侧 hover "+" 换 `DropdownMenu`（`MoreHorizontal`），
   菜单项四项；新增 rename 对话框组件。→ verify：组件单测。
6. **前端默认页**：`documents/index.lazy.tsx` 读取 tree、过滤 `pinned`、
   按 `updatedAt` 倒序渲染可点击列表；空则回退 `EmptyState`。
7. **i18n**：en/zh 新增 `tree.rename` `tree.pin` `tree.unpin` `tree.delete`
   `pinned.title` `pinned.empty` `rename.title` 等。
8. **质量门**：`bun run check` 通过。

## 验收

见 [FEAT-007](../task/FEAT-007.md)。
