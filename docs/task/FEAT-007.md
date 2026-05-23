# FEAT-007 — 文档行内操作菜单 + Pin 与默认页置顶列表

- **状态：** Done
- **计划：** [PLAN-008](../plan/PLAN-008.md)
- **创建时间：** 2026-05-23
- **负责人：** main

## 范围

研发阶段，接受破坏性更改，不做存量数据迁移。

1. **Pin（per-user）**——文档为 owner-scoped 且可分享，pin 必须按用户隔离，
   故新建独立表 `document_pins(user_id, item_id, created_at)`，与权限解耦。
   迁移由 Drizzle Kit 生成，不手写。
2. **侧边栏行内菜单**——文档树每行右侧由 hover "+" 改为 "⋯" 下拉菜单，菜单项：
   添加子文档、重命名、Pin / 取消 Pin、删除。复用既有
   `useCreateDocument` / `useUpdateDocument` / `useDeleteDocument`，新增
   `usePinDocument` / `useUnpinDocument`。
3. **默认页**——`documents/index.lazy.tsx` 由空白态改为展示已 Pin 的文档列表
   （从已加载的文档树过滤 `pinned`，按 `updatedAt` 倒序）；无 Pin 时回退到
   现有 `EmptyState`。

## 验收

- `bun run check` 通过（lint + 类型检查）。
- 后端 pin service 单测：pin / unpin 幂等、tree 查询正确标记 `pinned`、
  item 软删除或硬删除时 pin 行级联清理。
- pin 需对文档有 read 权限（owner / 分享可见）；无权限 fail-closed。
- 前端：行内菜单四项可用，重命名走对话框，删除走确认对话框，pin 切换即时
  反映在菜单文案与默认页列表。
- 手动：创建文档与子文档，重命名，pin 两篇，回到默认页看到置顶列表，取消
  其一后列表更新，删除一篇确认级联清理。
