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


### 后台第二阶段维护索引与故障处置

- **保存/发布失败：** 先看 `src/admin/PostEditor.tsx` 或 `SiteEditor.tsx` 的表单和错误状态，再查 `form.ts` / `helpers.ts` 验证和 `api.ts` 的 CSRF/超时；服务端错误再往 `worker/admin.ts`、GitHub OID 冲突、Secrets 追踪。不要在显示组件里重写 HTTP 客户端。
- **后台空白/无法登录：** 先查 `main.tsx` 的启动和主题初始化、`Gate.tsx` 的登录/权限状态，再查 `admin/api.ts` 会话调用，再查 `worker/auth.ts` / 配置。不要通过删除鉴权来修复。
- **列表旧数据/构建状态不更新：** 先查 `Dashboard.tsx` 的 `latest` 请求序号、`refresh` 和 30 秒部署轮询；列表/删除/Discussion UI 则查 `ContentList.tsx`，再查 Worker 的状态接口。刷新和页面跳转由 Dashboard 负责，编辑器只通过 `onSaved` 回调发信号。
- **图片或 Markdown 预览异常：** 先查 `ui.tsx` 的 `Markdown` / `Preview` 和 `helpers.ts`，再查 `shared/uploads.ts`；验证 5MB 类型限制、8 张/15MB 本次保存限制及未保存警告。已有数据校验协议不做猜测性放宽。
- **新增后台功能：** 新页面有独立状态且确有需求时才新增对应模块；UI 复用原有 `ui.tsx`，跨模块数据通过明确 props/回调和 `types.ts`，对 Worker 的调用统一走 `admin/api.ts`。新增风险测试挂在现有 `Waylan CI`，不再建新的 workflow。

**第二阶段完成状态：** 已在 `main` 合并并通过自动化门禁（PR #102，合并 SHA `49de396e`）；随后 `main` push 核心检查成功。后续如果新增 `/admin` 功能，只改对应 `src/admin` 所属模块，契约测试从 `tests/admin-modules.test.ts`、`tests/admin-form.test.ts` 和 `tests/admin.test.ts` 起步。只有遇到跨端依赖或新增 HTTP 合同时，才沿 `api.ts → worker/admin.ts` 延伸排查。涉及权限、站点发布或数据删除时必须重新执行 R3 验证，不可把这次结构重构的 CI 当成永久保证。

以上是**代码定位与后续维护规则**，不是“所有后台场景已在生产环境实测”的声明。涉及发布、删除、OAuth 或上传等写操作，仍须遵守原有 R3 风险验证标准。

## 重要维护记录（只记录影响边界的重大维护，避免文档噪音）

| 日期 | PR / 证据 | 责任范围和结果 | 验证与未确认项 |
| --- | --- | --- | --- |
| 2026-11-05 | [#98](https://github.com/YohakuSama/waylan-blog/pull/98) | 六页面拆分，独立后台 API，统一动效调用与 CSS 入口；修复阅读器相关交互 | 对应 PR CI 已通过；生产站点是否部署以实际 Cloudflare 记录为准 |
| 2026-11-05 | [#99](https://github.com/YohakuSama/waylan-blog/pull/99)、[分支维护运行](https://github.com/YohakuSama/waylan-blog/actions/runs/42034859036) | 7 个 Actions YAML 合为 1 个，85 个已合并遗留分支安全删除；保留未合并/开放 PR | 主分支与文档-only CI 成功；实际月度分钟节省应日后对比 Usage |
| 2026-11-05 | [PR #102](https://github.com/YohakuSama/waylan-blog/pull/102) · [PR CI #42044394381](https://github.com/YohakuSama/waylan-blog/actions/runs/42044394381) · [main CI #42045915291](https://github.com/YohakuSama/waylan-blog/actions/runs/42045915291) | 管理后台按职责拆分：`main` 启动、`Gate` 会话/CSRF、`Dashboard` 看板刷新、`ContentList` 列表/删除/Discussion、`PostEditor` / `SiteEditor` 独立表单；`ui` / `helpers` / `types` 公共能力集中。**已合并 SHA `49de396e`**，未改后台 API、OID 乐观锁、Worker、D1 与上传协议。 | PR head `7edeb4f0` 的核心构建/单测、管理权限与保存合同测试、多端视觉、Chromium/Firefox/WebKit 后台交互和 WCAG **成功**；main 核心检查成功。阅读器/摘录/动效专项因按需分类跳过。**生产部署、真实 OAuth 登录、GitHub 写入与 Cloudflare 上传尚未单独验证**。如回归，审核后可 revert 该 squash commit 并重新部署；无 D1 反向迁移。 |
| 2026-11-05 | [#101](https://github.com/YohakuSama/waylan-blog/pull/101) · [CI #42040153620](https://github.com/YohakuSama/waylan-blog/actions/runs/42040153620) | 阅读器入口保持，独立 `features/reader` 与 `features/discussions`；评论树显式 `postId` 传递、评论 Markdown 统一渲染；合并提交 `31797ff3` | PR 检查及合并后 main 核心检查通过，涵盖三端、四种外观、阅读器、选区、跨浏览器；**生产站点部署及真实登录/评论写入未单独确认** |
| 2026-11-05 | 本维护手册及 [ARCHITECTURE.md](ARCHITECTURE.md) | 建立模块责任、故障定位、渐进拆分、PR 和私有转换规则；**只有文档规划，未修改业务代码** | 此条由对应文档 PR 与 Git 历史追踪；后续拆分按阶段单独验收 |

后续维护记录至少包含：**日期、问题编号/PR、归属模块、根因、变更版本、实际测试、合并和部署状态、回滚信息**。普通文字调整可只保留 PR 历史；涉及安全、数据、跨模块接口或反复复发的缺陷须回写本文件，避免修完即失去上下文。
