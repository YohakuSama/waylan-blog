# 架构清理清单（2026-11-05）

## 已核实的现状

- 前端：React 19、TypeScript、Vite；后端：Cloudflare Worker / D1。
- 动画已由 `src/lib/motion.ts`（运行时策略、Web Animations、View Transitions）与 `src/styles/motion.css`（CSS tokens、过渡）共同管理。**没有必要再引入 Framer Motion 或 GSAP**。
- API 读取入口是 `src/lib/api.ts`（`api`、`useApi`、缓存失效），但不能未经盘点把 OAuth、文件上传、流式请求一律改成 JSON API。
- `src/pages.tsx` 同时包含多个页面；`src/components/UI.tsx` 同时包含图片、Dialog、Toast、关联阅读等，职责偏宽。
- `package.json` 的 `test`、`check`、`check-build`、`check-preview` 明确依赖 `tests/` 和 `scripts/`。**这些是有效质量门禁，不是可直接删除的测试残留**。
- README 仍包含 2.0/2.2 的历史版本和旧离线包目录；应移至版本历史，而不是误认为当前部署目录。

## 本次第一阶段

- 将 UI 对动效策略的调用直接指向 `lib/motion`，不再通过 router 间接取用。
- 暂时保留 router 的 `motionOK` 兼容别名，避免在没有全仓引用检查和构建结果时破坏其他调用者。

## 下一阶段（必须在完整仓库扫描及 npm run check 后实施）

1. **文件清单与引用图**：枚举全部受 Git 跟踪文件，标记 `tests/`、`scripts/`、`docs/`、`public/` 的入口和使用方；只删除确认无引用、无构建依赖的文件。
2. **页面拆分**：把 `src/pages.tsx` 中 Home/Feed/Projects/Archive/About/NotFound 按页面拆分；保留统一导出，避免路由、SSR 预渲染断裂。
3. **UI 拆分**：将 `src/components/UI.tsx` 按 Dialog、ArtImage、Toast、Related 等拆分，避免循环依赖。
4. **动效单一入口**：统一从 `lib/motion` 调用策略与动画工具，CSS 动效保留在 `styles/motion.css`；确认所有使用者迁移后删除 router 兼容别名。重点回归 iOS Safari、减少动态效果、对话框、返回滚动位置。
5. **API 分层**：统一普通 JSON 请求的错误、超时、取消和缓存；保留 Worker/OAuth/上传的专用传输协议。
6. **文档归档**：将历史版本说明移至 `docs/history/`，README 仅展示当前结构与部署流程。
7. **验收**：`npm ci && npm run check`，并手工验证首页、内容筛选、文章、书签、登录、评论、后台、离线预览、iOS Safari。

## 删除准则

不得仅凭名称含 `test`、`old`、`backup` 删除文件。删除前必须同时确认：无 import/动态 import/脚本引用、非构建输入、非数据库迁移、非上线资产，并有可恢复的 Git 历史。已应用的 D1 migrations 不得重写或删除。
