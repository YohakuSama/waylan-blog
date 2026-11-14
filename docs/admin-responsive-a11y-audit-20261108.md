# /admin 三端设计与可访问性审计（2026-11-08）

## 范围与边界

- 基线：main `ced1a6caca488aeaf34e62406cf3ab0e70a7fbff`。
- 依据：《Refactoring UI》（尤其是 52–54 页操作层级、65–70 页内容宽度、83–86 页表单分组）及 Waylan Blog AI Engineering Guidelines。
- 本次仅修改后台 UI、浏览器模拟 QA、无障碍检测及 CI 证据留存；不改鉴权、CSRF、GitHub API、数据格式、发布和部署业务逻辑。
- 所有浏览器测试对 `/api/admin/**` 进行路由拦截，**不写入生产数据**。

## 已从基线源码复现的问题与修复

| 编号 | 基线复现方式 / 根因 | 修复和检查点 |
| --- | --- | --- |
| A11Y-01 | /admin 内容列表：搜索框仅有 placeholder，缺乏明确关联标签。 | `ContentList.tsx` 添加持续可见的「搜索内容」关联 label；无结果提示区分空列表与无匹配。 |
| A11Y-02 | 站点资料：每条联系方式地址和名称仅依靠 placeholder；多行「删除这一行」名称相同。 | `SiteEditor.tsx` 为各行两项输入添加带序号的 label；删除按钮名称包含行号，联系方式集合增加 aria-labelledby。 |
| A11Y-03 | 文章编辑：封面替代文字输入仅有 placeholder；封面和头像操作内含多个按钮、输入，却被通用 Field 的 label 包住。 | 封面替代文字加持续标签及帮助文字；复合图片操作使用 `Field asGroup` 避免嵌套可交互标签。 |
| LAYOUT-01 | 390/320px：编辑器返回、标题、脏状态、线上入口和保存按钮都争夺同一行。 | 将编辑栏拆为 `editor-head-main` / `editor-head-actions`，在 ≤900px 分两行，≤520px 单独显示脏状态，保留保存/审核/发布原文案。 |
| LAYOUT-02 | 联系方式两列转单列时、长 URL/文件名/PR 号/错误文本和操作按钮可能挤压。 | `minmax(0,…)` / `min-width:0` / `overflow-wrap:anywhere` / 操作区换行，保留分组。 |
| TOUCH-01 | Markdown 工具按钮原为 30px，分段切换原为 30px。 | 对粗指针设备将交互命中区扩大到 ≥44px；移动表情面板固定在可见视口内。 |
| STATUS-01 | 删除失败提示未声明 alert；确认弹窗未关联可访问标题。 | 错误提示使用 `role=alert`；确认弹窗绑定 `aria-labelledby`，保留取消和忙碌状态逻辑。 |

## 测试与证据

在已配置的 CI 中，`npm run check` 覆盖 TS/构建/单测/静态检查；`scripts/quality-smoke.mjs` 将对 320/390/768/1024/1440px × 浅/深运行 **完全模拟 API** 的浏览器交互，验证无水平溢出并写入 `quality-report/` 截图；`scripts/a11y-smoke.mjs` 对 390/768/1440px × 浅/深运行 axe（WCAG 2.0/2.1/2.2 AA 标签）。

截图文件命名示例（CI 执行成功后查看 PR 的 `waylan-qa-evidence` artifact）：

- `quality-report/admin-dashboard-{width}-{light|dark}.png`
- `quality-report/admin-site-{width}-{light|dark}.png`
- `quality-report/admin-editor-{width}-{light|dark}.png`
- `quality-report/admin-short-390-{light|dark}.png`
- `quality-report/admin-review-390-light.png`

模拟测试路径包括：未配置、游客、无权限、管理员；搜索空匹配；站点资料/联系方式；两条公告添加及撤回；新建文章；已有文章、Markdown 编辑和预览；超大封面失败；未保存离开确认（留在页面和确认离开）；保存 409 冲突；删除确认及删除 409 冲突；模拟审核队列待审核、已合并待部署、已关闭未合并三态，并检查继续编辑仍为「提交 PR 审核」；粗指针下验证 Markdown 工具按钮触控高度不低于 44px。

**证据状态：** 以上为已提交的测试脚本和预期输出，不代表 CI 已通过或截图已生成。通过后以 PR 对应运行的日志、artifact 和 `axe-report.json` 为准。

## 业务状态不混淆

- 保留 main 立即提交后的构建中/已部署/部署异常提示。
- 保留内容分支与 review-pr 的未发布提示、PR 审核状态及已合并待部署状态。
- 保留 `useLeaveGuard` 与返回未保存确认。
- 保留图片校验、审核、发布和删除 API 参数及后端规则。

## 未解决风险 / 人工验收

1. 不能用 Playwright 视口模拟替代真实 iOS/Android 虚拟键盘、浏览器地址栏与安全区行为；需人工验证 320px、390px 和较短视口。
2. Axe 不能代替 VoiceOver / TalkBack / NVDA 的读屏及实际触屏测试；尤其需实际检查日期控件、文件选择器、动态状态播报。
3. 内容审核 PR 模式下的真实 GitHub 返回和 Cloudflare 部署未写入、未更改；需对应专项任务在隔离环境进行完整集成测试。
4. 后台仍复用前台 `MarkdownTools` 组件，但仅在后台 CSS 提高触屏尺寸，未更改公开站点组件实现。
