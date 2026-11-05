# Waylan 维护手册 · 模块责任、PR 与发布记录

本文件是**维护流程与维护记录**的单一入口。不要再为同一流程创建平行的 checklist。技术边界及“问题→文件→测试”索引由 [ARCHITECTURE.md](ARCHITECTURE.md) 维护；响应式规范由 [RESPONSIVE_LAYOUT.md](RESPONSIVE_LAYOUT.md) 维护；Actions 选择规则由 [ops/ACTIONS_POLICY.md](ops/ACTIONS_POLICY.md) 维护；历史分支与删除档案见 [ops/BRANCH_ARCHIVE.md](ops/BRANCH_ARCHIVE.md)。

## 维护总原则

- **定位按需**：先按故障表找到归属模块，只读该入口及直接依赖。找不到根因再依次扩大到跨端契约、数据生成、Worker、基础设施；不要把全仓扫描作为每个故障的第一步。
- **改动单责**：一次 PR 一个明确目的，不能把“顺便重构全部组件”混入修复。任何跨模块改动都要写出必要的依赖链。
- **验证适量**：变更文件决定最小测试集；身份权限、持久化、全局样式、公共路由、生成管线、动效等跨模块风险需扩大回归。自动变更分类器是提示与门禁，不是永远准确的影响图；发现漏项应修正分类规则并补测试。
- **证据先行**：用户反馈、假设、已经复现、根因证据和已验收必须分开写。构建成功不等于线上功能验收。
- **可追溯**：每次维护说明目标、责任模块、受影响合同、PR、验证的 commit、合并 commit（如有）、部署确认和回滚方式。技术上的责任归属不等于主观追责：以 Git/PR 事实定位变更者和受影响决策。
- **循序渐进**：目录、算法、框架或库的新增应有复用或风险价值；不以文件越多/越少作为质量标准。已有能稳定工作的能力不因风格偏好重写。

## 六步维护流程（按故障走）

1. **分类与事实**：标出页面/接口、设备、主题、状态、错误时间、环境（线上/预览/本地）、所用 commit，以及能否重现。对隐私信息脱敏。
2. **定位最短路径**：在 [ARCHITECTURE.md](ARCHITECTURE.md) 找归属文件，检查最近有关 PR 和直接 import/调用方，列出直接原因和根因假设。优先做最小复现。
3. **定义变更边界**：先写“不允许影响”的 API、数据、样式、离线/SSR、辅助功能或安全约束。选最小根因修复；如确有必要才拆功能，并明确迁移兼容期。
4. **实现与验证**：在独立分支提交，做模块单测、相关集成/浏览器测试，关键公共能力触发完整回归。验证同一 SHA，不删除失败测试来伪造绿色结果。
5. **PR 审核、合并与发布**：在 PR 中附定位、风险、已运行的实际结果、可回滚方案和相关文档；符合门禁后合并。记录状态应分别为“已提交 → 已验证 → 已合并 → 已部署 → 线上确认”，不可跳级。
6. **维护复盘**：重要缺陷在本文件记录问题根因、PR 与预防机制；反复出现的共性错误优先补责任边界与测试，再评估抽象化，避免再加一层兼容补丁。

### 按风险分级决定验证

| 级别 | 典型变更 | 最低验证 |
| --- | --- | --- |
| R0 文档 / 非运行时说明 | `docs/*`、`README.md` | 链接、格式、事实检查；CI 变更分类应跳过 npm 与浏览器 |
| R1 单功能 / 可隔离 | 单个显示模块、文本映射、局部交互 | 核心 `npm run check` + 该功能已有测试；有 UI 改动则相关浏览器场景 |
| R2 共享 UI、响应式、路由、主题、动画、内容生成 | 跨页面、双皮肤、离线/预渲染合同 | 核心检查 + 相关多屏宽/双主题/跨浏览器/离线回归；较大变更建议手动 full |
| R3 安全、身份、评论写入、D1、部署或不可逆数据 | 认证、权限、Webhook、迁移、持久化 | 核心 + 服务端/数据回归 + 权限/失败路径；预发布环境验证、数据备份和人工发布确认 |

若涉及多项，按最高风险处理。**没有测试环境不等于通过测试**，应如实标记未验证与阻断合并的风险。

## 责任归属与 PR 约束

当前主要由仓库维护者管理；不预设不存在的部门或审查人员。模块责任记录在 PR 的“负责模块”中，提交和审核者记录由 GitHub 提供。未来多人协作时可以增加真实维护者和 CODEOWNERS，不能为了形式虚构负责人。

一条功能的修改应先到它的公开入口：例如阅读/选区先查 `src/components/Reader.tsx` 和 `src/lib/selection.ts`，后台先查 `src/admin/*`，接口与鉴权先查 `worker/*`。引用关系和详细路径以架构故障地图为准。**跨领域深层引用要有明确理由**：不能因方便而让 Reader 读取后台私有状态，或让 UI 直接使用 D1 / GitHub 管理 Token。

PR 操作规范：一个问题对应一个 PR（除非确需分阶段且每阶段可独立验证），短命分支、明确范围、少量相关提交。PR 被关闭但未合并时保留分支到人工复核；PR 合并后若无新增提交和未完成用途，按 [分支治理规则](ops/BRANCH_ARCHIVE.md) 归档并删除，不再积累几十个临时分支。**不要为每个测试场景新建 Actions workflow；使用现有 `Waylan CI` 分类器或相应脚本。**

### 每个 PR 的最小记录模板（直接放 PR 描述）

```markdown
## 问题与证据
- 环境 / 复现步骤 / 实际结果 / 预期结果：
- 已确认根因（或尚待验证的假设）：

## 责任边界与方案
- 归属模块、入口文件、受影响的直接调用方：
- 此次修改 / 明确不修改的内容：
- API、schema、URL、文章 ID、主题、SSR/离线兼容性影响：

## 验收（必须写实际结果）
- PR 头部 SHA：
- 类型检查、构建、相关单元/浏览器/权限测试：通过 / 失败 / 未运行
- 三端与两皮肤双主题是否需要检查：
- 未解决风险、人工验证要求：

## 交付与回滚
- PR 链接与审批 / 合并 SHA：
- 部署 SHA 和线上验证（未知则明确写“未确认”）：
- 如何回滚、是否需要数据恢复：
- 关联维护记录 / 后续议题：
```

R0 文档 PR 可按需缩减模板；R3 高风险 PR 不得省略数据/权限和回滚段。

## 关键不变合同（需要主动确认）

- 内容源是 `content/*`，生成数据来自 `scripts/content.ts`；`src/generated/*` 和 `worker/generated/*` 不应手改。已发布 `post.id`、永久链接和 GitHub Discussion / D1 关联保持稳定。
- 登录会话、同源/CSRF、Webhook 签名、D1 迁移不能与纯 UI 优化一起偷偷调整。数据库迁移不可回写、不可删除。
- 正式站点、预渲染及 `preview/index.html` 离线模式是不同边界。某个浏览器通过不代表离线或真实 Worker 登录与评论已通过。
- `src/styles/index.ts` 的 CSS / 字体顺序和 `lib/motion.ts` 的减少动效策略保持统一。双皮肤、深浅主题共享核心布局约束；禁止以不可验证的间距补丁掩盖换行、Grid 或重用生命周期根因。
- 需要报告具体版本：PR 通过、已合并、Cloudflare 已部署、线上复测是四种不同事实。

## 从公开仓库转回私有：执行清单（计划，尚未执行）

1. **代码与权限**：确认内容仓库确实适合转私有，检查外部依赖的 README/Raw URL、GitHub App 安装权限、Cloudflare Builds 的 GitHub 集成权限和部署用仓库访问权限；不要以为修改可见性后 Cloudflare 会自动保持连接。
2. **Discussions 的公开边界**：本项目的公开评论依赖 GitHub Discussions。`docs/ARCHITECTURE.md` 现有约定要求**专用公开 Discussions 仓库**；若代码仓库转私有，应确认 Discussions 所在仓库仍为公开且仓库 ID、Token 权限、Webhook / GraphQL 访问与访问控制符合设计，不能把公开讨论功能一并关掉而不自知。
3. **密钥和缓存**：核验 Worker 的 OAuth 回调域名、Webhook 签名、Token、私有仓库最小权限及 Cloudflare Secrets；任何泄露过的密钥应轮换。公开缓存和预览日志不得暴露私有源码、个人信息或凭据。
4. **Actions 预算**：私有仓库的 GitHub-hosted Runner 受套餐包含计算量与账单设置影响，优先运行按需 PR 检查；保留必须的构建/安全回归，深度发布审计按风险手动启动。设置消费提醒/预算阈值并定期对照 GitHub Usage，不依据推算声称节省了多少分钟。
5. **发布前回归**：验证文章、RSS、Sitemap、静态资源、域名、404、登录、评论读取/发表、批注、D1 对账、Cloudflare Worker；高风险需要可回滚的版本和数据库备份。
6. **版本与审计**：记录“转私有前 SHA / 后 SHA、可见性、成功的部署、测试结果、回退步骤”，并验证前端和公开评论没有误读私有资源。

GitHub Actions 计费以 [GitHub 官方说明](https://docs.github.com/en/actions/concepts/billing-and-usage) 为准；安全生命周期可参考 [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)。这些是风险导向的参考，不构成项目已取得政府或企业认证的声明。


### A 后续：评论树纯模型归属（2026-11-06，PR 待验收）

- **原问题**：Reader 直接执行评论可见性过滤、跨主列表/深链/面板评论去重、以及编辑/删除后的局部树形数据修正，导致纯数据和页面生命周期混在一起。
- **处理**：复用 `features/discussions/model.ts` 的原有评论职责，迁入 `discussionView` 和 `updateCommentNodes/updateCommentPage`，Reader 仍统一负责副作用；保留原排序、空父过滤与引用、回复数量及主评论总数更新规则。未修改 API、数据库、CSS、事件监听和 Safari 原生选区状态机。
- **验收与回滚**：在现有 `tests/reader-modules.test.ts` 检查可见评论、重复 ID 优先级、编辑/删除后计数与不变性，沿 Waylan CI 执行 `npm run check`、三端/双皮肤、三浏览器、阅读器/选区专项。未验证前不合并；如回归单独 revert 本次 PR，无迁移和外部数据变更。生产 iOS Safari 仍需真机确认。

### 阅读器后续增量解耦 A（2026-11-06；已合并 PR #108）

- **修改前/根因**：阅读进度保存、目录当前章检测与 `resume=1` 恢复混在阅读器的选择/评论效果之间；修改滚动逻辑难以独立审查。
- **处理**：仅把原监听及保存/恢复效果搬入 `src/features/reader/useReadingProgress.ts`；`Reader.tsx` 保持 `Reader({post})` API，并通过稳定的 setter 保持原有触摸设备不主动清空选区的判断。未改 DOM、样式或页面路由，也未增加存储抽象。
- **风险及保留**：同一效应依赖原样保留 `[post, excerptMode]`；原生 iOS Safari 选择句柄、评论提交、图片缩放状态机不适合与滚动观察同步改写。真实 iOS 设备/生产尚无验收证据。
- **验收/回滚**：[PR #108](https://github.com/YohakuSama/waylan-blog/pull/108) · [Waylan CI #42072965186 成功](https://github.com/YohakuSama/waylan-blog/actions/runs/42072965186) · squash `aa52f770ef2bb79aa6bc243e32e3b4fd8fea5288`。首次 #42072800534 因目录 setter 漏传导致 TypeScript 失败，修正后重测完整通过。可审核后单独 revert 此 squash、重新部署，无 D1 迁移；不把模拟 WebKit 等同真机。

### 后台第二阶段维护索引与故障处置

- **保存/发布失败：** 先看 `src/admin/PostEditor.tsx` 或 `SiteEditor.tsx` 的表单和错误状态，再查 `form.ts` / `helpers.ts` 验证和 `api.ts` 的 CSRF/超时；服务端错误再往 `worker/admin.ts`、GitHub OID 冲突、Secrets 追踪。不要在显示组件里重写 HTTP 客户端。
- **后台空白/无法登录：** 先查 `main.tsx` 的启动和主题初始化、`Gate.tsx` 的登录/权限状态，再查 `admin/api.ts` 会话调用，再查 `worker/auth.ts` / 配置。不要通过删除鉴权来修复。
- **列表旧数据/构建状态不更新：** 先查 `Dashboard.tsx` 的 `latest` 请求序号、`refresh` 和 30 秒部署轮询；列表搜索与删除查 `ContentList.tsx`；评论区初始化查 `Discussions.tsx` 的批处理完成/无进展/上限条件，再根据异常响应追查 `admin/api.ts` 与 `worker/admin.ts`，不要在看板里新增重试循环。刷新和页面跳转由 Dashboard 负责，编辑器只通过 `onSaved` 回调发信号。
- **图片或 Markdown 预览异常：** 先查 `ui.tsx` 的 `Markdown` / `Preview` 和 `helpers.ts`，再查 `shared/uploads.ts`；验证 5MB 类型限制、8 张/15MB 本次保存限制及未保存警告。已有数据校验协议不做猜测性放宽。
- **新增后台功能：** 新页面有独立状态且确有需求时才新增对应模块；UI 复用原有 `ui.tsx`，跨模块数据通过明确 props/回调和 `types.ts`，对 Worker 的调用统一走 `admin/api.ts`。新增风险测试挂在现有 `Waylan CI`，不再建新的 workflow。

**第二阶段完成状态：** 已在 `main` 合并并通过自动化门禁（PR #102，合并 SHA `49de396e`）；随后 `main` push 核心检查成功。后续如果新增 `/admin` 功能，只改对应 `src/admin` 所属模块，契约测试从 `tests/admin-modules.test.ts`、`tests/admin-form.test.ts` 和 `tests/admin.test.ts` 起步。只有遇到跨端依赖或新增 HTTP 合同时，才沿 `api.ts → worker/admin.ts` 延伸排查。涉及权限、站点发布或数据删除时必须重新执行 R3 验证，不可把这次结构重构的 CI 当成永久保证。

**增量补强（PR [#104](https://github.com/YohakuSama/waylan-blog/pull/104)）：** 已将内容列表和评论区初始化的前端职责隔离；只有服务端 `remaining === 0` 才允许显示完成通知。无法进展、超过 50 轮、返回非法结果均转为可见错误；添加 `tests/admin-modules.test.ts` 对这些路径进行覆盖。PR #104 的头部提交 `11db9985` 已通过 [Waylan CI #42048949781](https://github.com/YohakuSama/waylan-blog/actions/runs/42048949781) 的核心检查、跨设备视觉、三浏览器后台交互与 WCAG；已合并至 `main`，合并提交 `1f2f4606`。**生产环境的真实 GitHub Discussions 创建、登录与 Cloudflare 部署尚未单独验收。**

以上是**代码定位与后续维护规则**，不是“所有后台场景已在生产环境实测”的声明。涉及发布、删除、OAuth 或上传等写操作，仍须遵守原有 R3 风险验证标准。

### 第三阶段 CSS 样式归属与回归（首批）

- **现状与原因**：原 `src/styles/site.css` 约 66 KB 混合页眉、首页、列表、侧栏、索引页、断点和手机标题的多次覆盖，维护时容易修改错层级。皮肤与动效有独立末尾覆盖，不能改变它们相对顺序。
- **最小拆分**：`src/styles/index.ts` 顺序不变，仅将原 site 文件内五个连续顶层区块按顺序分配到 `shell.css`（页眉/首页）、`feed.css`（卡片基础）、`sidebar.css`、`site.css`（索引/页脚）、`responsive.css`（跨页面断点）；`skins.css`、`motion.css` 和 `src/styles.css` 不动。
- **已核对的冗余**：在 ≤767px 条件下，前两处首页/文章卡片标题的 `font-size`、`line-height`、`margin-top` 均被其后同条件、同 specificity 的最终定义覆盖；仅删除这两处旧声明。通过源文件与新模块去注释后的逐字比对，其他非注释 CSS **完全一致**。
- **影响和验证路径**：`tests/css-ownership.test.ts` 检查共享入口、导入次序与唯一所属；`tests/skin-parity.test.ts` 改为按 `shell.css` / `responsive.css` 找真实规则；`npm run check` 包含预渲染和离线 CSS；`scripts/visual-smoke.mjs` 检查三端四种外观的最终几何，另用 `quality-smoke` / WCAG 检查交互和可用性。
- **不变合同**：不改 CSS class、HTML/React DOM、页面路由、字体、API、D1、动效库和后台权限；不引入 CSS-in-JS、`@layer` 或新框架。若出现错位或换行，优先复核导入与某个屏宽的后置覆盖，不额外追加新的临时 CSS。
- **合并与回滚**：本批 [PR #105](https://github.com/YohakuSama/waylan-blog/pull/105) 头部 `e92e0525` 已通过 [Waylan CI #42056032731](https://github.com/YohakuSama/waylan-blog/actions/runs/42056032731) 的构建/单测、三端四外观、跨浏览器、WCAG、阅读器、选区、信息流状态机和三引擎动效预览；已合并 `main`，squash 提交 `f9503ed3`。若出现回归，可审核后 revert 此提交并重新部署，无数据库回迁。本轮只覆盖第三阶段首批，旧 `styles.css` / `skins.css` 复杂规则尚未完成全面去重；生产部署和真实设备验证仍需独立确认。

### 第四阶段 Worker 解耦（首批：管理员内容仓库访问）

- **改动理由**：`worker/admin.ts` 原约 743 行将管理员授权、输入校验、GraphQL/REST、Git OID 和提交事务交织在一起。认证安全和 Git 内容仓库访问有独立的变更原因，应有独立责任路径。
- **实施范围**：完整抽取原 GitHub I/O 与 `repo/head/files/posts/commit/blobOid` 到 `worker/admin-repo.ts`；`worker/admin.ts` 仍控制身份和权限检查、内容/上传校验及各个 HTTP API 的处理顺序。原 `worker/github.ts` 公共 GraphQL transport 保留，不与私有内容 Token 建立新的共享状态。
- **原样保留**：Git Data API 请求地址、headers、20 秒超时、409 冲突、403/429/404 等错误映射、OID/UTF-8 blob 计算、force:false 提交、D1 表结构、评论重试/幂等语义，以及所有 CSRF/同源/登录步骤。只移动函数与导入，不修改原函数内部的请求次序。
- **验证**：新增 `tests/admin-repository.test.ts` 记录分支配置、UTF-8 Git blob OID、空文件读取、权限模块与内容仓库客户端互不反向依赖的边界；原 `tests/admin.test.ts` 的模拟 Git API 和实际 SQLite 仍验证并发版本冲突、文章和图片的原子保存与内容规则；`npm run check` 包含所有 Worker/构建/静态完整性回归。已有 CI 选择器对 `worker/` 改动自动运行跨浏览器质量/无障碍基线。
- **风险 R3 与回滚**：本批已合并 `0708fa5b`（PR #106），对应最终 CI 见 [#42065361326](https://github.com/YohakuSama/waylan-blog/actions/runs/42065361326)。尽管业务逻辑无计划变化，内容仓库写入仍属高风险。PR 的自动化测试仅使用模拟 GitHub，不等于真实 GitHub 写入、Cloudflare Worker 部署和生产 OAuth 已验收；发布需单独验证 token 权限、无副作用的内容读取，并通过受控测试稿确认提交与冲突回退。若线上出现不符，审核后 revert 该 squash commit 并重新部署，**不涉及 D1 反向迁移**。
- **下一步**：`worker/comments.ts` 的读取/缓存/重复提交恢复应先单独画出状态转换和失败路径，再按不改变幂等性、评论 ID 与 Webhook 语义的原则分批拆分；不能将此步骤混进本次仓库访问适配器 PR。

### B 后续：正文校验消除重复（2026-11-06，PR 待验收）

- **根因**：公开评论创建和编辑都校验空白/超长、超过两个正文链接、受保护的 `<!-- echo:` 元数据，但在同一个写入模块重复实现；未来修复可能漏改其中一个接口。
- **最小改动**：仅在 `worker/comments.ts` 内共享 `validatedCommentBody`，按 create/edit 保留原有不同的 `COMMENT_LENGTH` HTTP 文案、状态和先后顺序。没有另建通用校验库、修改 `worker/comment-reads.ts`、`comment-shared.ts` 或幂等事务。
- **验证/回滚**：`tests/worker.test.ts` 添加实际 HTTP 边界、错误消息、拒绝副作用回归；Waylan CI 全套通过后独立 PR 合并。没有 D1 迁移；可单独 revert 本 PR。真实 Cloudflare/OAuth/Discussion 写入仍需独立验收。

### 评论 Worker 职责整理 B（2026-11-06；已合并 PR #109）

- **根因和边界**：原 `worker/comments.ts` 同时包含 6 类只读端点与高风险写入幂等事务，修改预览时容易影响鉴权写入；将只读端点/批注绑定移至 `worker/comment-reads.ts`，仓库/文章/游标校验移至 `worker/comment-shared.ts`，原 `comments.ts` 保持路由兼容导出和写入状态机。
- **删除与保留**：删除 feed preview 原样抛出的冗余 catch（上游异常照旧传播）；保留 `worker/github.ts` 单一 transport/cacheGet；所有缓存键、TTL、D1 SQL、`requestId` payload hash、`sending/sent/failed`、网络不确定恢复、限流、授权均保留，不采用泛化 repository 层。
- **验收证据**：原 `tests/worker.test.ts` 真实 SQLite schema + GitHub Mock 与新架构边界断言；依赖现有 Waylan CI 的 `npm run check` / 三引擎基线。CI、PR 与 squash SHA 在确认后追加记录；模拟不代表 Cloudflare/OAuth/Discussion/D1 真实环境。
- **回滚**：仅代码和文档，按 PR 的单独 squash SHA revert 并重新部署；不运行、修改或回退 migrations，不清除 write_intents（已落地的 GitHub 写入不能靠代码 revert 自动取消）。


**B 实际验收与合并：** [PR #109](https://github.com/YohakuSama/waylan-blog/pull/109)，最终分支版本 `c53ce4e1ce6977dce3485674efe3d27d3223662b`，在已合并 A 的 `main` 基础上通过 [Waylan CI #42075026817](https://github.com/YohakuSama/waylan-blog/actions/runs/42075026817)：类型/构建、全部单元与 Worker 合同、SSR/离线检查、三端视觉、Chromium/Firefox/WebKit 及 WCAG。squash 合并 SHA `1a21bb9d5d5437e70217b1d9116ca975ca6c79c6`。原始 CI #42073247868 新增模块测试因为断言使用了不存在的局部变量名而失败（300/301 项通过），仅修正测试，业务代码未改。回滚为审查后单独 revert 此合并提交并重新部署；不回滚 D1 数据，也不能通过回滚自动撤销已经发布到 GitHub 的评论。

### 四阶段结项核验（2026-11-06，代码与自动化层面）

**结项范围**：P1～P4 在各自 PR 中约定的**首批职责拆分**已经合并。不是宣告所有大文件均已拆完，也不是 Cloudflare 生产部署/真实数据写入验收成功。所有依据以 GitHub PR、提交 SHA 和对应 Actions 运行结果为准。

| 阶段 | 已交付的实际边界 | PR / 合并 SHA | 可追溯的自动化证据 |
| --- | --- | --- | --- |
| P1 阅读器 | `src/features/reader/` 负责头部/目录/图片预览，`src/features/discussions/` 负责评论显示；`Reader.tsx` 仍保留交互状态与入口 | [#101](https://github.com/YohakuSama/waylan-blog/pull/101) · `31797ff3` | [CI #42040153620](https://github.com/YohakuSama/waylan-blog/actions/runs/42040153620)：核心、布局、三浏览器、WCAG、阅读器/选区/路由和动效回归通过 |
| P2 后台 | `main/Gate/Dashboard/ContentList/Discussions/PostEditor/SiteEditor` 分责；`admin/api.ts` 是后台专有 HTTP 边界 | [#102](https://github.com/YohakuSama/waylan-blog/pull/102) · `49de396e`；[#104](https://github.com/YohakuSama/waylan-blog/pull/104) · `1f2f4606` | [CI #42044394381](https://github.com/YohakuSama/waylan-blog/actions/runs/42044394381)、[CI #42048949781](https://github.com/YohakuSama/waylan-blog/actions/runs/42048949781)：核心、布局、后台浏览器和 WCAG 通过 |
| P3 CSS | `styles/index.ts` 统一加载；`shell/feed/sidebar/site/responsive/skins/motion` 按职责与固定级联顺序分离 | [#105](https://github.com/YohakuSama/waylan-blog/pull/105) · `f9503ed3` | [CI #42056032731](https://github.com/YohakuSama/waylan-blog/actions/runs/42056032731)：核心、四种外观/多屏宽、三浏览器、WCAG、阅读器、信息流和动效专项通过 |
| P4 Worker | `worker/admin-repo.ts` 负责私有内容仓库 GitHub 读写与原子提交；`admin.ts` 保持权限校验与 HTTP 编排 | [#106](https://github.com/YohakuSama/waylan-blog/pull/106) · `0708fa5b` | [CI #42065361326](https://github.com/YohakuSama/waylan-blog/actions/runs/42065361326)：核心、Worker 契约、构建/离线、布局、后台三浏览器、WCAG、信息流专项通过 |

**交付基线**：P4 合并后 [main 核心检查 #42066763832](https://github.com/YohakuSama/waylan-blog/actions/runs/42066763832) 成功；随后 `main` 的 `5f446d4d` 仅更新 `docs/ARCHITECTURE.md` 和 `docs/MAINTENANCE.md`，对应 [CI #42067004377](https://github.com/YohakuSama/waylan-blog/actions/runs/42067004377) 是**文档级检查**，没有重复运行 npm、构建或浏览器。不能把文档级绿色状态当成 P4 的完整重新验收。

**收尾核对**：上表全部 PR 已合并、阶段对应模块在 `main` 中存在、统一工作流仍为 `.github/workflows/verify.yml` 一份；README、架构、维护及运维文档的仓库内 Markdown 相对链接已检查，没有发现缺失目标（仅验证路径存在，不代表外部链接或所有锚点都可达）。本收尾只修改文档，不改变生产功能、依赖、D1、OAuth、API 或 CI 策略。

#### 交付后尚未验收 / 不在本阶段中继续拆解

| 风险 | 状态与后续动作 | 是否阻止“代码阶段结项” |
| --- | --- | --- |
| **R3：真实私有内容仓库写入** | PR #106 在模拟 GitHub 契约下通过；尚无可核对的生产/预发布 GitHub 内容提交、409 冲突、回滚、Token 权限验收。使用受控测试稿与可恢复版本独立验收。 | 不阻止“代码/CI 完成”，但**阻止宣称生产写入已验证** |
| **R3：Cloudflare Worker、OAuth、D1 与公开 Discussions** | 未从可审计的部署记录确认生产 SHA、真实登录、评论发表、D1 关联及 webhook。发布负责人按本文“转私有前清单”核对，记录 Cloudflare 部署 ID 和回滚版本。 | 同上；转私有前必须完成 |
| **R2：线上真实设备与双皮肤** | PR 浏览器回归通过，但未据此宣称线上 iPhone/iPad/桌面实际部署一致。部署后按 `docs/RESPONSIVE_LAYOUT.md` 验收。 | 不影响 PR 验收；影响上线确认 |
| **已有未完成分支/PR** | [#57](https://github.com/YohakuSama/waylan-blog/pull/57)（移动页眉）和 [#23](https://github.com/YohakuSama/waylan-blog/pull/23)（Cloudflare 手动备用部署）仍开放；不能擅自合并或关闭。新近已合并分支的审计名单见 `docs/ops/BRANCH_ARCHIVE.md`。 | 不阻止已交付阶段，但需人工决策 |
| **技术债（非本次收尾）** | `src/components/Reader.tsx`、`src/styles.css`、`worker/comments.ts` 仍较大。已抽出的功能边界应保持；若真实问题证明需要进一步拆分，再单独 PR、单独基线、按需测试，禁止单纯为减少行数重写。 | 不阻止结项 |

**回滚路径**：先定位具体阶段的 squash SHA 和关联测试证据，确认后对故障阶段单独 revert / 修复并重新部署；不要无差别回滚四阶段，也不要修改已应用的 D1 migrations。源代码可以回滚不等于已提交到 GitHub 的内容或 D1 数据自动回滚，写入路径须单独核验。

**结项判断**：P1～P4 **约定的首批代码改造与相应 CI：已完成并通过**；**真实部署、OAuth/内容写入/数据和私有化转换：未取得足够验收证据**。需要分别记录状态，不将 PR 合并等同生产完成。


### A/B 后续发布验收与剩余技术债（2026-11-06）

本次仅在源代码与现有自动化验收层面结项，**不代表 Cloudflare 生产部署已核实**：GitHub 中的 Cloudflare Workers Builds 在 A/B 修改前的 `main` 基线 `815102af` 就有失败检查，在 PR 分支也出现失败；GitHub 检查摘要不包含可确认的 Cloudflare 失败根因，不将其归因于本轮拆分，也不声称部署成功。发布负责人需要到 Cloudflare dashboard 读取对应构建日志，确认部署版本 SHA、可回滚生产版本及静态资产。

真实 iOS Safari 触摸句柄、原生分享、返回滚动/图片放大需要 iPhone/iPad 真机回归；评论需受控账号分别验证 OAuth 登录与 CSRF、Discussion 仓库归属、D1 写入、同 requestId 的网络中断恢复、Webhook 缓存失效。只读验证优先，写入测试不得自动产生重复评论。生产已提交的第三方评论和 D1 数据不会因代码 revert 自动回退。

**保留不强拆：** `Reader.tsx` 中原生 WebKit 手势、目录焦点与评论草稿事务存在同步时序，`worker/comments.ts` 中 `sending/sent/failed` 与恢复窗口依赖原子顺序；缺乏真实端到端证据时继续维持现状。CSS 冗余/综合清理 C/D 未纳入 A/B，仍需独立任务和 PR；不删除测试、工作流或迁移文件。

## 重要维护记录（只记录影响边界的重大维护，避免文档噪音）

| 日期 | PR / 证据 | 责任范围和结果 | 验证与未确认项 |
| --- | --- | --- | --- |
| 2026-11-05 | [PR #106](https://github.com/YohakuSama/waylan-blog/pull/106) · [CI #42065361326](https://github.com/YohakuSama/waylan-blog/actions/runs/42065361326) | P4 首批：`worker/admin-repo.ts` 负责 GitHub 内容仓库版本/读取/原子提交，`worker/admin.ts` 保留身份与 API 编排；新增仓库选择、Blob OID、409 冲突与模块边界测试。为消除视觉测试模拟状态叠加，改为一个通知状态 Mock。合并 `0708fa5b`。 | PR head `f5263384` 的类型检查、构建、Worker 合约、三端视觉、三浏览器后台交互、WCAG 和信息流回归均通过；生产真实 GitHub 写入、OAuth、Cloudflare 部署尚未验收。可审核后回滚此提交，不涉及 D1 迁移。 |
| 2026-11-05 | [PR #105](https://github.com/YohakuSama/waylan-blog/pull/105) · [CI #42056032731](https://github.com/YohakuSama/waylan-blog/actions/runs/42056032731) | P3 首批 CSS 按页眉/信息流/侧栏/页面/断点职责分拆；顺序未改变，移除两组被完全覆盖的手机标题声明；合并 `f9503ed3`。 | `e92e0525` 核心测试、跨屏四外观、三浏览器/WCAG、Reader/Feed/Motion 完整 CI 通过。生产部署与真机未单独确认；可回滚此纯 CSS 提交，无 D1 迁移。 |
| 2026-11-05 | [#98](https://github.com/YohakuSama/waylan-blog/pull/98) | 六页面拆分，独立后台 API，统一动效调用与 CSS 入口；修复阅读器相关交互 | 对应 PR CI 已通过；生产站点是否部署以实际 Cloudflare 记录为准 |
| 2026-11-05 | [#99](https://github.com/YohakuSama/waylan-blog/pull/99)、[分支维护运行](https://github.com/YohakuSama/waylan-blog/actions/runs/42034859036) | 7 个 Actions YAML 合为 1 个，85 个已合并遗留分支安全删除；保留未合并/开放 PR | 主分支与文档-only CI 成功；实际月度分钟节省应日后对比 Usage |
| 2026-11-05 | [PR #102](https://github.com/YohakuSama/waylan-blog/pull/102) · [PR CI #42044394381](https://github.com/YohakuSama/waylan-blog/actions/runs/42044394381) · [main CI #42045915291](https://github.com/YohakuSama/waylan-blog/actions/runs/42045915291) | 管理后台按职责拆分：`main` 启动、`Gate` 会话/CSRF、`Dashboard` 看板刷新、`ContentList` 列表/删除/Discussion、`PostEditor` / `SiteEditor` 独立表单；`ui` / `helpers` / `types` 公共能力集中。**已合并 SHA `49de396e`**，未改后台 API、OID 乐观锁、Worker、D1 与上传协议。 | PR head `7edeb4f0` 的核心构建/单测、管理权限与保存合同测试、多端视觉、Chromium/Firefox/WebKit 后台交互和 WCAG **成功**；main 核心检查成功。阅读器/摘录/动效专项因按需分类跳过。**生产部署、真实 OAuth 登录、GitHub 写入与 Cloudflare 上传尚未单独验证**。如回归，审核后可 revert 该 squash commit 并重新部署；无 D1 反向迁移。 |
| 2026-11-05 | [PR #104](https://github.com/YohakuSama/waylan-blog/pull/104) · [CI #42048949781](https://github.com/YohakuSama/waylan-blog/actions/runs/42048949781) | 增量 P2：`ContentList.tsx` 仅负责内容列表，`Discussions.tsx` 负责评论区初始化；批处理零进展及时停止、50 轮未完成准确报错，不再虚假提示成功。合并 `1f2f4606`，不改 Worker/API/权限/数据库。 | 头部 `11db9985` 的核心/模块测试、布局、三浏览器后台交互和 WCAG 通过。主分支文件已核对；生产真实写入及部署未单独验证，按前端提交回滚，无 D1 迁移。 |
| 2026-11-05 | [#101](https://github.com/YohakuSama/waylan-blog/pull/101) · [CI #42040153620](https://github.com/YohakuSama/waylan-blog/actions/runs/42040153620) | 阅读器入口保持，独立 `features/reader` 与 `features/discussions`；评论树显式 `postId` 传递、评论 Markdown 统一渲染；合并提交 `31797ff3` | PR 检查及合并后 main 核心检查通过，涵盖三端、四种外观、阅读器、选区、跨浏览器；**生产站点部署及真实登录/评论写入未单独确认** |
| 2026-11-05 | 本维护手册及 [ARCHITECTURE.md](ARCHITECTURE.md) | 建立模块责任、故障定位、渐进拆分、PR 和私有转换规则；**只有文档规划，未修改业务代码** | 此条由对应文档 PR 与 Git 历史追踪；后续拆分按阶段单独验收 |

后续维护记录至少包含：**日期、问题编号/PR、归属模块、根因、变更版本、实际测试、合并和部署状态、回滚信息**。普通文字调整可只保留 PR 历史；涉及安全、数据、跨模块接口或反复复发的缺陷须回写本文件，避免修完即失去上下文。
