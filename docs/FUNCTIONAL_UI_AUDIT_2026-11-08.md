# Waylan Blog 前台功能界面审计（2026-11-08）

## 审计边界与证据

- 基线：`main` 提交 `ced1a6caca488aeaf34e62406cf3ab0e70a7fbff`。
- 范围：全站搜索、阅读清单/收藏、阅读设置/私人划线、消息/公告、GitHub 未登录入口、404 与辅助操作，以及功能相关的响应式与交互行为。
- 依据：《Refactoring UI》（Adam Wathan、Steve Schoger）；Waylan Blog AI Engineering Guidelines；本仓库设计系统及实际组件、样式、现有回归脚本。
- 性质：源代码审计已完成；新增浏览器矩阵及截图脚本需要 CI 执行，**不可将脚本存在等同于浏览器验证通过**。前台 API 全部使用 mock，不依赖真实用户会话或消息。
- 非目标：首页/内容/归档/项目/关于/隐私/阅读页布局重做；阅读字号的正文计算；评论编辑器/批注具体操作；OAuth、会话、GitHub Discussions、数据库和其他后端逻辑。

## 已确认问题与修改

| 级别 | 功能 | 主分支代码证据 | 修复与判断 |
| --- | --- | --- | --- |
| 高 | 手机公告 | `src/styles/announcements.css` 曾在 `max-width:700px` 将 `.site-announcement-priority` 设为 `display:none`，使横幅重要/紧急级别失去文字标识，只剩颜色线条 | 改为手机两行小型栅格，明确显示「重要公告」「紧急公告」文字；保留查看详情和关闭入口。 |
| 中 | 通知键盘操作 | `NotificationBell` 非模态弹层原本只监听指针外点和 Escape；Tab 焦点移出时面板仍可覆盖后续内容 | 焦点移出即关闭；原本 Escape 恢复到铃铛、点击外部关闭的行为保持不变。 |
| 中 | 通知可见高度 | 通知面板原始 `max-height:min(490px,75dvh)`，手机固定定位位于两行页眉之后，没有为底部剩余视口及安全区留出预算 | 在功能专属样式中增加手机、短屏幕高度约束；需浏览器实测验证。 |
| 中 | 阅读字号失败状态 | `Settings` 原本忽略 `storage.set("font-size", …)` 的布尔结果，失败仍更新选项与阅读页事件 | 写入失败时保留原选项，给出 `role=alert` 错误；成功时才同步界面和正文事件。键与存储格式均不变。 |
| 低 | 通知无颜色标识 | 消息未读仅用 `.unread` 样式识别；订阅按钮缺少状态语义 | 为未读消息补充屏幕阅读器「未读」文本，为订阅按钮增加 `aria-pressed`。 |

## 对照《Refactoring UI》的设计决策

- **Hierarchy is Everything / Semantics are secondary**（第 29–54 页）：未读和订阅状态与主要操作需要清晰层级；保留可见入口，破坏性操作仍需要第二次确认，而非依靠红色大按钮。
- **Establish a spacing and sizing system**（第 60–64 页）、**Avoid ambiguous spacing**（第 83–86 页）：手机公告的级别与标题明确分组，触控按钮保留既有最小尺寸与左右内边距，不新增临时全局 Token。
- **Don't rely on color alone**（第 146 页）：紧急公告优先级保留文字，不靠主题色线条传达。
- **Don't overlook empty states**（第 203–205 页）：搜索无结果、阅读清单为空、无通知/服务不可用分别保留可读说明，不移除操作入口。
- **Use fewer borders**（第 206 页）：仅用公告级别的局部细边框加强身份，维持 Editorial 与 Terminal 既有形态，不将卡片和弹层全部重构成统一模板。

## 未修改但纳入交叉回归的现有行为

- 搜索：`src/App.tsx` 中 Ctrl/⌘K 与 `/` 快捷键、输入框初始聚焦、上下方向键、Enter、Escape、建议/空状态/结果以及关闭后路由导航顺序。
- 阅读清单：`waylan:reading-list:v1` 的本地持久化，收藏/移除、随机阅读、`ConfirmButton` 两次按压清空。
- 设置：Editorial/Terminal 两个预览、浅色/深色/跟随系统，正文档位与私人划线键 `echo:marks:*` 语义、清空再次确认。
- 公告：公开静态数据、`announcement:read/dismissed` 按修订号记录，不改变私有消息与公开公告的分界。
- 404：返回首页、归档及最近文章；全局 Toast、返回顶部、Dialog 的现有行为。
- GitHub 登录：保留现有前端入口，本任务不触发授权流程、不修改任何后端。

## 验收矩阵与可复现命令

基础矩阵：桌面 **1440px**、平板 **768px**、手机 **390px** × Editorial Light / Editorial Dark / Terminal Light / Terminal Dark，共 **12 组**。`scripts/functional-ui-smoke.mjs` 对每组记录截图和结果，覆盖搜索建议/正常结果/空结果、清单空/已保存/删除、设置和私人划线、未登录与已登录通知、订阅切换；使用 Playwright 路由拦截模拟 API。附加 **320×568、390×480、768×500** 检查搜索及通知弹层可视范围，并通过纯测试 DOM 验证手机紧急公告的级别可见性。数据仅存在浏览器临时上下文，不触发真实 GitHub 登录或写用户数据。

已存在的 `scripts/visual-smoke.mjs` 在标准 PR 中按 9 个关键断点和四种外观做页面/共享组件检查，`scripts/quality-smoke.mjs`、`scripts/a11y-smoke.mjs` 和 `scripts/interaction-state-smoke.mjs` 覆盖多浏览器、可访问性和导航/搜索交错行为；全局共享样式变更时 `visual-smoke` 可运行 18 个断点的完整矩阵。本 PR 未改动这些全局样式文件。

验证命令：
```sh
npm ci
npm run check
node scripts/functional-ui-smoke.mjs
# 在 CI 中另执行 visual-smoke / quality-smoke / a11y-smoke 等既有回归
```

### 验收状态

- 已确认（代码级）：高优先级问题及修复差异、组件状态管理、旧存储键不变、无后端逻辑改动。
- 已添加但**尚待 CI 证明**：12 组视觉截图，模拟未登录/已登录和异常状态，焦点离开，320px、短屏幕以及全站共用组件回归。
- 不可冒充的测试：真实 iOS/Android 软键盘弹出造成的 `visualViewport` 平移、Safari 浏览器工具栏折叠/安全区、200% 缩放和实体触屏测试；这些需要真实设备或独立的浏览器自动化证据。

## 共享组件与并行开发风险

| 变更文件 | 所有权/影响 |
| --- | --- |
| `src/styles/announcements.css` | 公告横幅与通知的功能专属样式，未编辑 skins/responsive/Tokens。 |
| `src/components/NotificationBell.tsx` | 仅私有通知面板焦点退出和语义状态。 |
| `src/components/Settings.tsx` | 仅设置表单成功/失败反馈，不碰阅读页字号计算。 |
| `tests/announcements*.test.ts` | 组件状态及手机文字级别的回归约束。 |
| `scripts/functional-ui-smoke.mjs`、`.github/workflows/verify.yml` | 新模拟矩阵、截图工件；仅新增一项 CI 工作步骤。 |

未编辑 `src/App.tsx`、`src/styles/skins.css`、`src/styles/responsive.css`、全局 Token、其他页面布局或认证/数据库后端文件。与并行页面分支合并时重点检查通知在跳转时的关闭、`Settings` 在阅读字号更新时的选择态、公告横幅在手机页眉下方的排版。仓库主分支不在本任务内合并。
