# Waylan Blog 软件交接与生产验收清单

> 最近核对：2026-11-08（中国标准时间）。这是可审计的**检查点**，不是自动更新的运行状态；在任何生产操作前应重新检查 GitHub、Cloudflare 和实际站点。项目源代码和当前配置以最新 `main` 为准。

## 一、范围与完成判定

已开发并通过相应 GitHub 自动化的功能，与已经在 Cloudflare 成功部署、且真实域名及设备验收通过，是**三个不同层级**。任何一层均不可替代下一层。

- **开发/自动化交付**：只以 PR 最终 HEAD 的 Waylan CI 以及合并后 `main` 的独立 CI 结论为依据。推送 `main` 的 CI 仅执行核心检查，不会自动重复 PR 的完整三浏览器测试。
- **云端发布**：核对**相同提交 SHA** 对应的 Cloudflare Workers Builds 与实际激活的 Worker Version ID。Build success 不等于所有线上功能成功；Build failure 不能被同一 SHA 的 GitHub CI success 覆盖。
- **生产端到端**：实际域名、OAuth/评论/后台受控写入、D1、iOS/Android/iPad 真机，需要另取证；未取得证据均标注「未确认」。

### 已完成的软件实现证据

| 能力 | 合并的 PR | 当前证据与限制 |
| --- | --- | --- |
| 非主分支的后台状态/发布语义 | [#166](https://github.com/YohakuSama/waylan-blog/pull/166) | 不能把已保存到内容分支误报成已上线 |
| 显式可选的草稿 PR 提审 | [#167](https://github.com/YohakuSama/waylan-blog/pull/167) | 原子提交文章、图片、301、站点资料；`main` 不直接写入；**默认关闭** |
| 审核队列与合并状态 | [#168](https://github.com/YohakuSama/waylan-blog/pull/168) | PR 合并只显示待确认部署，不当作已经上线 |
| 同一待审 PR 继续编辑 | [#169](https://github.com/YohakuSama/waylan-blog/pull/169) | 验证源分支、草稿状态、文件与乐观锁；不强推、不自动合并 |
| 短屏长代码和宽表内部滚动测试 | [#170](https://github.com/YohakuSama/waylan-blog/pull/170) | Chromium/WebKit 浏览器模拟，**不代表真机** |
| SSR 水合可恢复错误诊断 | [#171](https://github.com/YohakuSama/waylan-blog/pull/171) | 合并前必须检查**最终 HEAD** CI；不要把测试失败解释为线上错误，需先区分诊断信号与真问题 |

代码基线检查点：`main@ab10095bf7ae0b867a8e86adb91e49ff6e23b744`，对应 [Waylan CI #42389763320](https://github.com/YohakuSama/waylan-blog/actions/runs/42389763320) **success**（仅该 SHA 的 `main` 核心检查），**同一 SHA 的 Workers Builds failure**，Build ID `f77017bd-ccd1-43c8-af7a-17d8da9c2c1d`。此状态不证明实际线上已部署该 SHA，也不能在未读取 Cloudflare 日志时归因于代码。

## 二、软件版本与默认发布行为

当前仓库 `wrangler.jsonc` 配置 `CONTENT_BRANCH=main`，没有配置 `CONTENT_PUBLISH_MODE`。代码的默认模式仍是 `direct`；已合并的 `review-pr` 功能**不会自动切换生产**。真实 Cloudflare 环境中的覆盖变量与 Secrets 仍需由有权限的管理员确认，禁止在讨论、截图或 PR 中泄露具体密钥。

GitHub [Protect main Ruleset](https://github.com/YohakuSama/waylan-blog/rules/26758808) 当前为 `active`、目标默认分支，只包含 `deletion` 和 `non_fast_forward`。它**未启用** Require PR / required status checks；正常 fast-forward 仍可能直接更新 main。严禁在后台仍以 `direct` 保存时盲目开启强制 PR，否则可能使编辑器不能发稿。

**代码侧下一次受控演练**：在隔离或预发布环境使用可删的测试文章，验证「新增（含图片）→ draft PR → 继续编辑并测试冲突 → 审核与 CI → 合并 → Cloudflare 构建 → 实际域名读取」；还要覆盖删除、301、站点资料、权限不足保留分支与手工恢复。先确认测试环境没有对正式内容产生写入，且内容 Token 仅限目标仓库：Contents read/write 与 Pull requests write。此流程未从真实 Worker 完成，不标记为通过。

## 三、发布门禁：必须在验证之后才开启

管理员按照以下顺序执行，且每一步保留回退路径：

1. **Cloudflare 当前状态**：在 Worker → Deployments / Builds 查最新失败 Build `f77017bd-ccd1-43c8-af7a-17d8da9c2c1d` 的真实阶段日志、最近成功部署的活跃 Version ID 与 SHA。不要把历史成功的 Build 当作当前活跃版本，也不要无证据调整 Secret 或强制部署。
2. **审查分支实测**：在受控环境确认 GitHub Token 最小权限与 PR 创建/复用/回写/合并，确认 D1 和评论没有产生意外数据。权限检查只需是否存在及粒度，**无需向助手提供 Token 内容**。
3. **逐步切换后台**：确认读写来源一致后，评估将 `CONTENT_PUBLISH_MODE` 显式设为 `review-pr`；确认返回的是草稿 PR、并无直推 main，记录可恢复的待审分支。此步为独立的管理员配置变更，不能由合并源码 PR 自动代替。
4. **GitHub 仓库保护**：后台提审全路径确认可用后，对 `main` 开启 Require a pull request before merging 和**确切的**必需状态检查（当前工作流的 `check` job），测试红灯不可合并、绿灯经审核可合并，避免把草稿的 skipped 当作成功。
5. **Cloudflare 串行门禁**：独立调整自动发布的触发链，要求最终合并 SHA 的 CI **成功之后**才允许部署。当前 Cloudflare Git 集成与 GitHub CI 并行，不具备此保证。新链路经失败拦截/成功发布/回滚演练前，不应在生产上开启并行的另一套自动部署。

GitHub Ruleset 本身**不等于** Cloudflare 的部署前门禁；二者必须分别证明。

## 四、剩余遗留 PR 的处理结论

| PR | GitHub 事实 | 建议 |
| --- | --- | --- |
| [#155](https://github.com/YohakuSama/waylan-blog/pull/155) | **closed / not merged**；旧 UI 对齐分支 | 已有更新的主干视觉系统与测试；保留历史供溯源，不从旧基线重新合入 |
| [#57](https://github.com/YohakuSama/waylan-blog/pull/57) | **closed / not merged**；旧手机页眉分支 | 历史验证与当前 CSS/断点不同；保持关闭，不合并过时代码 |
| [#23](https://github.com/YohakuSama/waylan-blog/pull/23) | **open / Draft**；手动 Wrangler 生产部署备用通道 | 涉及新增第二生产写入入口、Cloudflare Secrets、竞态和发布权限；**不自动合并**。由仓库所有者在确定正式 CI→部署方案后决定重写/关闭/保留为手动应急通道 |

上述审查只判断是否适合当前合并，**不删除旧分支，不改写历史**。

## 五、人工验收清单（由有权限的站点管理员执行；不计入软件完成率）

- [ ] Cloudflare：核对失败 Build 日志、活跃 Version ID、激活 SHA、可回滚版本；记录与 GitHub CI 是否同一 SHA。
- [ ] GitHub / 内容发布：预发布测试草稿 PR（文章 + 图 + 301 + 编辑 + 冲突 + 删除）及管理员 Token 最小权限。不要分享 Secret。
- [ ] GitHub / Cloudflare 门禁：验证需 PR、必需 `check`、失败不能合并、CI 通过后才能部署；避免直接推送与两条自动发布通道竞态。
- [ ] GitHub App / Worker：正式域名只读 `/api/status`、登录退出、评论/批注、D1 映射与恢复；写入测试只使用隔离的测试账号和可恢复数据。
- [ ] 实际设备：iPhone、Android、iPad；Editorial/Terminal × Light/Dark、横竖屏、导航、长代码/表格、图片与选区、键盘和安全区。
- [ ] 内容运营：文章版权和真实信息、RSS、Sitemap、404、隐私页面、SEO 与分享预览；用户决定内容上线是否合适。

### 每次版本验证的证据行

| 项目 | 必须填写 |
| --- | --- |
| Source | `main` SHA / PR 号、最终 PR HEAD SHA |
| GitHub | Waylan CI run URL、该 SHA 的 `check` 结论、是否执行浏览器专项 |
| Cloudflare | Build ID、结论、Version ID、实际**活跃**版本 |
| 线上 | URL、访问日期、实际结果、核验人（不记录私人凭据） |
| 恢复 | 可以回退到哪个已验证版本、是否涉及 GitHub 内容提交或 D1 数据 |

**回滚边界**：源码可按 PR 的 squash commit 经审查 revert；Cloudflare 则需单独选择已知良好部署版本并确认线上流量切换。切换 `CONTENT_PUBLISH_MODE` 回 `direct` 只改变后续提交路径，不会取消已有 PR 或撤销已发布内容。GitHub Discussions / D1 的历史数据不随代码回滚，绝不可自动删除或反向运行迁移。

相关维护入口：[架构地图](../ARCHITECTURE.md)、[维护手册](../MAINTENANCE.md)、[CI 策略](ACTIONS_POLICY.md)、[分支治理](BRANCH_ARCHIVE.md)、[全项目跟踪 #164](https://github.com/YohakuSama/waylan-blog/issues/164)、[发布门禁 #79](https://github.com/YohakuSama/waylan-blog/issues/79)、[鉴权验收 #80](https://github.com/YohakuSama/waylan-blog/issues/80)。
