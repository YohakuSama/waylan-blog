# Waylan CI（精简后的长期策略）

仓库仅保留 `.github/workflows/verify.yml` 一个工作流。对 `main` 的 PR 与推送自动检查，手动运行 `Waylan CI` 执行完整质量审计。历史清理用的临时分支回收任务不属于长期 CI，已移除；ThinkPad Windows 自托管 Runner 已停用，因此不再定义 `windows-check` / `windows-connectivity`。

## 核心门禁

- `scripts/ci-plan.mjs` 根据文件变更选择测试；无法识别变更时回退到完整检查。
- 仅变更 Actions 工作流、CI 分类、已退休维护脚本时，只执行核心检查与 CI 规则单测，不无故下载 Chromium / Firefox / WebKit。
- 有代码变更时执行 Node 24 依赖安装、TypeScript、构建、单元测试及静态完整性检查。
- PR 的受影响 UI 模块复用同一次浏览器安装运行 Chromium、Firefox、WebKit、三端布局、WCAG、Reader、Feed、交互与动效专项；仅文档变更不安装浏览器。
- 已验证 PR 合并后推送 `main` 只重新执行核心检查，不重复安装浏览器；手动运行执行完整审计。
- 截图与报告仅在失败或手动完整审计时上传，产物保留 3 天。历史 CI 日志由 GitHub 管理。

## 运维边界

Cloudflare Workers Builds 与 GitHub Actions 是独立的状态检查；不能把 GitHub CI 成功等同于 Cloudflare 发布成功。运行/维护前核实两个状态。正式版本合并请尽量通过 PR，保留必要质量门禁。旧分支 GC 的处理记录见 [分支清理结项](BRANCH_ARCHIVE.md) 与 GitHub 历史，不保留长期删除分支的自动化入口。
