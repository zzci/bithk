# 前端 UI 一致性审计报告

- 审计范围：`apps/web/src`（187 个 tsx，已排除 `*.test.tsx` 与 `components/ui/` 原语内部）
- 审计方式：6 个维度并行证据采集（颜色/按钮/布局外壳/状态态/排版图标/原语模式）
- 日期：2026-05-31
- 阶段说明：研发阶段，不考虑兼容性，允许破坏性更改
- 设计基线：OKLCH 语义 token（`src/index.css`）+ CVA `Button`（默认 h-8）+ `@base-ui/react` 原语 + lucide-react + sonner + TanStack Query

## 总体结论

底层「组件原语层」非常健康：UI 库硬锁定零违规（无任何 Radix/MUI/Antd 等被禁库）、Button 尺寸/变体无绕过、删除确认（ConfirmDeleteDialog/AlertDialog）、Toast（sonner）、表单反馈（mutation onSuccess/onError）三者全站统一。

问题集中在「页面装配层」——缺一套共享的页面脚手架与状态态约定，导致**各功能模块各写各的**。最值得优先收敛的有 5 处系统性不一致（见下）。

## 优先级总览（按收敛价值）

| # | 问题 | 维度 | 严重度 |
|---|------|------|--------|
| P1 | 状态语义色（成功/警告/危险）散落用 green/emerald/amber/red 原始色，绕过 success/warning/destructive token，并手写 dark 变体 | 颜色 | 高 |
| P2 | 列表「加载/空」态有 4+ 种手写排版，几乎不复用已存在的 `CenteredHint`；列表页普遍缺 error 主态（出错显示成"空"） | 状态 | 高 |
| P3 | 列表容器风格分裂：issue/procurement 已 borderless CSS-grid，contacts/users 仍 bordered `<Table>`（且 rounded-lg vs rounded-md） | 布局 | 高 |
| P4 | 工具栏筛选控件三套（圆角 chip / 原生 Select / DropdownMenu）+ 搜索框四种宽度 + chip 高度不齐 | 布局 | 高 |
| P5 | 4 处详情抽屉/预览手写 `createPortal`+`fixed inset-0` 遮罩绕过 Sheet/Dialog 原语，带出三套遮罩浓度（black/10、/30、/50） | 原语 | 中 |

---

## 1. 颜色一致性

**高**（状态语义色未走 token，双主题隐患）
- `app/routes/denied.tsx:88` `text-green-500`（成功）→ `text-success`；同文件 74 行已正确用 `text-destructive`，自相矛盾
- `app/routes/_app/-drive-upload-panel.tsx:70` `text-emerald-500`（上传完成）→ `text-success`
- `shared/components/settings-dialog.tsx:388` `text-green-600`（复制成功）→ `text-success`
- `shared/components/settings-dialog.tsx:279-280` `border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400` → `warning` token
- `app/routes/shared.$token.tsx:43,45` `text-amber-500`（链接过期）→ `text-warning`
- `app/routes/_app/admin/-cron-dynamic-fields.tsx:104` 与 `admin/cron.lazy.tsx:249-250`：同种警告块，两处写法不一（amber-900 vs amber-700）→ 统一 `warning`
- `app/routes/_app/admin/-policies-check.tsx:150` `green-500/red-500`（allowed/denied）→ `success`/`destructive`

**中**（装饰/分类色硬编码 + 手写 dark）
- `app/routes/_app/-file-browser-types.ts:81-85` 文件类型图标色 5 处 light/dark 双写 → 集中常量，尽量映射语义色
- `app/routes/_app/-drive-file-list-inner.tsx:122,132,512,591,626,736` 大量 `sky-*`（文件夹图标/选中态）→ 选中/高亮应走 `accent`/`primary`，抽常量
- `app/routes/_app/-drive-file-list-item-actions.tsx:135,297,380` 收藏星标 `text-amber-500` 与 warning 混用 → 统一或新增专用 token

**低**（品牌/SVG/动态渐变，多为合理例外）
- `shared/components/logo.tsx:13` `bg-indigo-600 text-white`（品牌色，建议 `text-primary-foreground`）
- `projects/-project-issues-tab.tsx:92-101` `AVATAR_COLORS` 10 色头像盘（确定性区分色，合理例外）
- `projects/-project-issues-tab.tsx:131` `stroke="#fff"`（建议 currentColor）
- cover-image 动态 hue 渐变、milkdown css `#fff` fallback（合理例外）

## 2. 按钮 / 交互元素

整体规范：299 处 variant 分布合理，无 className 硬编码高度绕过 size，无图标按钮手动 padding。

**高**
- `shared/components/resource/attachment-section.tsx:123-128` 整块可点击 `<div onClick>` 仅有 cursor-pointer，缺 `role`/`tabIndex`/`onKeyDown`/`aria-label`（键盘+读屏不可达）→ 参照 `admin/users/groups.lazy.tsx:271-288` 补全

**中**（应复用却各自手写、样式漂移）
- 上传附件内联按钮三处重复且字号漂移：`-project-issue-panel.tsx:472-480`(text-xs)、`-project-procurement-panel.tsx:469-477`(text-xs)、`comment-section.tsx:537-545`(**text-[11px]**) → 抽 `AttachmentUploadButton` 或用 `Button variant="ghost" size="xs"`
- 编辑描述内联按钮重复：`-project-issue-panel.tsx:482-491`、`-project-procurement-panel.tsx:479-488` → 同上统一
- `ships/-ship-maintenance-tab.tsx:188-205` 手写 segmented control（h-8 + active 态）→ 评估复用现有切换组件/Tabs

**低/合规确认**：大量原生 `<button>` 为列表行/导航行/面包屑/树节点（用 Button 会破坏布局，且文件内复用 class 常量），属合理；背景遮罩 `<div onClick>` 为辅助点击区。

## 3. 页面外壳 / 布局 / 间距

基线：`_app.tsx:120` 的 `<main>` 已统一 `px-4 py-3 md:px-6 md:py-4` 外边距且不设 max-width，页面内不应再写页面级 padding/max-width。

**高**
- H1 列表容器分裂：`-project-issues-tab.tsx:87`(grid borderless)、`-project-procurement-tab.tsx:71`(grid+header) vs `contacts/index.lazy.tsx:231`(`rounded-lg border` Table)、`admin/users/index.lazy.tsx:222`(`rounded-md border` Table) → 统一一种；contacts/users 的 rounded-lg vs rounded-md 至少取齐
- H2 工具栏筛选三套：chip（projects/ships/contacts）/ 原生 Select（admin/users）/ DropdownMenu（procurement）；且 chip 高度不齐（projects 显式 h-8，ships/contacts 无）
- H3 搜索框四种宽度：`sm:w-64`（projects/ships）/ `lg:max-w-xs`（contacts）/ 固定 `w-64`（admin/users）/ `max-w-xs flex-1`（issue/procurement）

**中**
- M1 纵向节奏 `space-y-*` 各异：6（多数列表）/4（admin/users、cron、audit、procurement tab）/5（project 详情、issue tab）——同一 project 详情内 issue tab(5) 与 procurement tab(4) 就不一致
- M2 标题字重：列表页全 `font-bold`，唯 `projects/$projectId.lazy.tsx:114` 是 `font-semibold`；ship 详情 `font-bold` → 两详情页彼此也不一致
- M3 详情页外壳两套：project（ghost 返回按钮 + 裸 header + 自定义 TabsList）vs ship（面包屑 + hero Card + StatTile + 裸 TabsList），tab 正文上边距 pt-1 vs pt-4
- M4 文件 tab 容器：project files 裸容器 `h-[calc(100svh-18rem)]` vs ship files 包 Card `calc(100svh-22rem)`

**低**
- L1 New 按钮图标写法：`<Plus aria-hidden>` vs 手写 `<Plus className="mr-1 size-4">`（ships/procurement）
- L2 分页器：列表页 `justify-between` vs admin/users `justify-center`+页码文案
- L3 `documents/index.lazy.tsx:32` 独立窄栏外壳（`max-w-[680px]` + text-sm 标题）——疑似刻意，建议写入决策记录豁免

## 4. 加载 / 空 / 错误态

**高**
- H1 列表「加载/空」4+ 种手写：裸 `<p>`（projects/ships/contacts index）、`py-10 text-center`（issues）、`px-3 py-8`（procurement）、`py-4`（comment）、TableCell 居中（policies/equipment）、`py-8`（settings 系列）；仅 3 处用了共享 `CenteredHint`，overview 还自造本地 `ListState` → 统一走 `CenteredHint`，删 `ListState`
- H2 详情加载态：`$projectId.lazy.tsx:81`、`$shipId.lazy.tsx:62` 裸文字（连 text-sm 都没有）vs FullPageLoader vs 居中 Loader2 → 路由主区域统一

**中**
- M1 空态信息密度不一：极少富空态（drive `FolderOpen`、equipment `Package`+CTA），多数仅一行灰字 → 定一套 EmptyState 规范
- M2 列表页缺 error 主态：`projects/index.lazy.tsx:106` banner + 152 三元无 error 分支，出错落入"空" → 列表三元补 `isError ? <CenteredHint tone="destructive">`
- M3 `admin/-settings-shared.tsx:67` 本地自造 `ErrorBanner` 与共享 `ui/error-banner` 同名并存 → 删本地，统一引用共享

**低**
- L1 loading 文案 key 分散在十几个 namespace（common.loading/list.loading/detail.loading/...）→ 收敛 `common.loading`/`common.empty`/`common.error.loadFailed`
- L2 spinner 尺寸/颜色不一（size-4/5/6，有的无 text-muted-foreground）→ 抽 `Spinner`

## 5. 排版 / 图标

**高**
- 详情编辑 Pencil 三种尺寸：`-project-issue-panel.tsx:488`(size-3)、`-project-procurement-panel.tsx:485`(size-3)、`:777`(**size-2.5 全仓唯一**) vs documents/file-preview/equipment 同语义 size-4 → 统一 size-4（或紧凑 3.5），删 2.5 孤例
- 编辑语义两种图标：`contacts/index.lazy.tsx:318,530` 用 `Edit3`，其余 ~12 处用 `Pencil` → contacts 改 Pencil
- H1 字重 bold vs semibold（同 §3 M2）

**中**
- 约 50 处 `text-[10px]/[11px]/[12px]/[13px]` 任意值绕过 text-xs（comment-section 8、cron-dynamic-fields 6、projects/index 4、ships 4、drive 等）；`attachment-section.tsx:142` 的 `text-[12px]`=text-xs 纯冗余 → 收敛 text-xs，或新增语义档 `text-2xs` 全局替换
- 「更多」菜单图标：`-drive-file-list-item-actions.tsx:87`(size-4) vs `-drive-sidebar.tsx:289`/`-documents-sidebar.tsx:359`(size-3.5)
- 行尾操作图标 admin 区 size-3.5 vs 其余 size-4

**低/合规**：删除图标全仓统一 Trash2（无 Trash 混用）；截断 truncate/line-clamp 基本一致；`tracking-[0.5em]`（TOTP）两处一致属专用样式。

## 6. 组件原语 / 弹层模式

**高（硬锁定）**：无违规。`package.json` UI 层仅 `@base-ui/react` + `shadcn`，源码 import 零命中被禁库。

**中（绕过 Sheet/Dialog 原语手写 modal）**——4 处 `createPortal`+`fixed inset-0`：
- `projects/$projectId.issues.$issueId.lazy.tsx:96-137` 右侧抽屉 → 改 `<Sheet side="right">`
- `projects/$projectId.procurements.$procurementId.lazy.tsx:96-137` 同构 → 与上共用 `ResizableDetailSheet`
- `admin/-cron-create-drawer.tsx:88-107` 还手写 Esc 处理（原语已提供）→ 改 `<Sheet>`
- `-file-preview-dialog.tsx:384-402` 居中预览 → 改 `<Dialog>`
- 副作用：遮罩浓度三套并存（Dialog/Sheet 原语 black/10、抽屉 black/30、预览 black/50），焦点陷阱/滚动锁缺失

**低/合规确认**：`window.confirm` 零命中（统一 ConfirmDeleteDialog/AlertDialog，22 文件）；Toast 统一 sonner；无原生 `<select>`/`<dialog>`；下拉统一 Select/DropdownMenu/Combobox；表单反馈统一 mutation onSuccess/onError 模式。

---

## 建议的收敛路线（破坏性更改可行）

1. **状态色 token 化**（P1）：把 green/emerald/amber/red 状态用法批量替换为 success/warning/destructive，删手写 dark 变体。低风险、高收益。
2. **状态态组件统一**（P2）：确立 `CenteredHint` + 新增 `EmptyState`/`Spinner` 为唯一入口，逐页替换列表加载/空/错误态，列表三元补 error 分支，删本地 `ListState` 与 admin 本地 `ErrorBanner`。
3. **列表页脚手架**（P3+P4）：抽 `ListPageShell`（统一 header 字重/space-y、搜索框宽度、筛选控件族、容器风格 borderless grid 或 Table 二选一、分页器）。
4. **详情抽屉原语化**（P5）：抽 `ResizableDetailSheet` 包装 Sheet，4 处手写 modal 迁移，统一遮罩浓度。
5. **排版收口**（§5）：统一编辑图标（Pencil + size-4）、详情 H1 字重，新增 `text-2xs` 语义档替换 ~50 处 magic number。
