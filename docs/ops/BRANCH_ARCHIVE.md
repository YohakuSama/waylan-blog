# Git 分支存量档案 · 2026-11-05

此档案保存在仓库中，**不是额外的长期归档分支**。历史 PR、提交仍由 Git 保留；删除已合并分支不等于删除提交历史。完整分支名称、准确 SHA 和关联 PR 见 [JSON 快照](branch-inventory-2026-11-05.json)。

## 快照统计

- 总计 98 分支：主分支 1；已合并 PR 对应 85；仍有开放 PR 2；已关闭未合并 8；快照时无关联 PR 2。
- **可自动清理的上限：85 个**。执行前须再次确认 GitHub 上分支 SHA 未变、PR 真正 merged、没有新的开放 PR、未被保护。
- 开放 PR 和无合并记录的分支全部保留待人工判断。旧分支可能有尚未合入的独立工作，不能用日期或前缀判定“垃圾”。
- 快照仅反映记录时的 HEAD；未来产生的分支不在此次自动清理范围内。本次运维分支不包含在初始快照中；本次合并后如仍存在，应纳入下一期人工核验。

## 清理完成记录 · 2026-11-05

- [Waylan CI 主分支运行 #42034859036](https://github.com/YohakuSama/waylan-blog/actions/runs/42034859036) 的 `branches` job 成功：`Eligible: 85 Skipped: 13`，`failures: []`。实际 GitHub 分支列表再次核验，快照中 **85 个 merged 分支已全部删除**，13 个快照内非 merged / 主分支均保留。
- 当前 GitHub 有 **14 个分支**：快照内保留 13 个，另有本次已合并的 PR [#99](https://github.com/YohakuSama/waylan-blog/pull/99) 运维分支 `ops/actions-budget-and-branch-archive-20261105`（SHA `30385ae62ba2`）。它创建于快照之后，不属于本次 85 个自动删除目标；可以在下一次分支例行检查时单独处理。
- 保留的快照内分支包括：`main` 1 个、开放 PR 2 个、关闭未合并 PR 8 个、无 PR 记录 2 个。**不要**因为分支名看起来陈旧就删除这些分支。
- 原始 JSON 保持清理前的事实快照，不回写成新列表；这份执行记录补充清理后的审计信息。通常不需要再手动运行 `branches-prune`。

## 四阶段交付后的分支复核（2026-11-06）

这是一份**新增的核验记录**，不覆盖 2026-11-05 的原始 JSON 快照。检查时（创建本次结项文档分支前）远端共 **21 条分支**：`main` 1、已合并 PR 且分支 SHA 与 PR head 完全相同 8、开放 PR 2、已关闭未合并 PR 8、未关联 PR 2。本次结项工作另创建 `docs/stage1-4-closeout-20261106` 分支，故后续实时数量会多 1；旧数字不是实时仪表盘。

**仅供下一次经人工复核的候选清理（8 条，非已删除）：**

| 已合并 PR | 可核对的分支 | PR head SHA |
| --- | --- | --- |
| [#99](https://github.com/YohakuSama/waylan-blog/pull/99) | `ops/actions-budget-and-branch-archive-20261105` | `30385ae62ba254667267ee118918af7a9d26e9fa` |
| [#100](https://github.com/YohakuSama/waylan-blog/pull/100) | `docs/architecture-traceability-20261105` | `151256b28655e1b9788a54a669bf899369370c18` |
| [#101](https://github.com/YohakuSama/waylan-blog/pull/101) | `refactor/reader-feature-boundaries-20261105` | `573c513db70457d494f16c2610fa6539077491ac` |
| [#102](https://github.com/YohakuSama/waylan-blog/pull/102) | `refactor/admin-feature-boundaries-20261105` | `7edeb4f09b843ca1964844c5fb4d4555f36d768c` |
| [#103](https://github.com/YohakuSama/waylan-blog/pull/103) | `docs/admin-stage2-verified-record-20261105` | `8b07b478d3f2a93a9268814c074e13e82faa003b` |
| [#104](https://github.com/YohakuSama/waylan-blog/pull/104) | `refactor/admin-discussions-boundary-20261105` | `11db99857139eb2ee5c1475c64aeafedebcb3fc3` |
| [#105](https://github.com/YohakuSama/waylan-blog/pull/105) | `refactor/css-ownership-cascade-20261105` | `e92e05255428f427a39df8182e843e3f595352a1` |
| [#106](https://github.com/YohakuSama/waylan-blog/pull/106) | `refactor/worker-content-repository-20261105` | `f5263384c5e3f5f72dadf762fd50c45e2e359518` |

- **禁止**把此表当成删除授权。删除前必须再次查询真实 ref SHA、分支保护、PR 合并状态及是否新建开放 PR；若 SHA 变化，停止并人工审查。
- 当前 `scripts/branch-maintenance.mjs` 仍指向 **2026-11-05 的不可变历史快照**，再次选择旧 `branches-prune` **不会删除上面这 8 条新候选**。如需要新一轮批量清理，先建立新的有审计记录的快照并验证运行脚本；本次不为清理 8 条分支增设工作流或修改脚本。
- [PR #57](https://github.com/YohakuSama/waylan-blog/pull/57) 和 [PR #23](https://github.com/YohakuSama/waylan-blog/pull/23) 仍开放；其他 8 条已关闭但未合并与 2 条未关联分支均在保护范围内，禁止仅凭“日期旧”或“名字像测试”删除。
- 已合并的 Git commit 与 PR 可以通过 GitHub 历史追溯，**分支清理不等于删除项目维护历史**。本次仅新增档案，未运行删除操作。

## 例外分支（不允许自动删除）

| 类型 | 分支 | PR | SHA |
| --- | --- | --- | --- |
| unlinked | `design/mobile-header-hierarchy-main-20261104` | — | `2ff96bb2a9c3` |
| closed-unmerged | `feat/article-action-rail-floating-reader-20261104` | [#49](https://github.com/YohakuSama/waylan-blog/pull/49) | `d9d8c15b03ee` |
| closed-unmerged | `fix/feed-invalid-filter-params-20261103` | [#15](https://github.com/YohakuSama/waylan-blog/pull/15) | `39a4e944abe7` |
| unlinked | `fix/ios-reader-toolbar-browser-chrome-20261105` | — | `436eaeed3a8c` |
| closed-unmerged | `fix/mobile-thread-visible-center-20261104` | [#37](https://github.com/YohakuSama/waylan-blog/pull/37) | `a8d2b681ab3c` |
| closed-unmerged | `fix/notification-reliability-motion-logo-20261105` | [#68](https://github.com/YohakuSama/waylan-blog/pull/68) | `174d7054e974` |
| open-pr | `fix/share-mobile-header-geometry-20261105` | [#57](https://github.com/YohakuSama/waylan-blog/pull/57) | `a7013499f799` |
| open-pr | `ops/manual-cloudflare-deploy-fallback-20261104` | [#23](https://github.com/YohakuSama/waylan-blog/pull/23) | `d9781977a879` |
| closed-unmerged | `refactor/architecture-cleanup-phase1` | [#96](https://github.com/YohakuSama/waylan-blog/pull/96) | `7a60afc20cd6` |
| closed-unmerged | `test/accessibility-wcag-20261103` | [#11](https://github.com/YohakuSama/waylan-blog/pull/11) | `175dee098b02` |
| closed-unmerged | `test/excerpt-logic-ui-audit-20261103` | [#14](https://github.com/YohakuSama/waylan-blog/pull/14) | `14da9af286b0` |
| closed-unmerged | `work/phase-a-core-reliability-20261103` | [#16](https://github.com/YohakuSama/waylan-blog/pull/16) | `ec7c79067787` |

## 删除流程

1. 合并统一的 `verify.yml` 后，在仓库 **Actions → Waylan CI → Run workflow**，选择 `branches-preview` 检查可删除清单，无写权限副作用。
2. 检查本次清单的 PR、SHA 和例外分支。选择 `branches-prune`，手工输入确认串 `DELETE_VERIFIED_MERGED_BRANCHES`。
3. 维护脚本在主分支运行，逐条重新查询实际 SHA，仅删除快照中合并完成且完全匹配的分支。分支变化、受到保护、仍有开放 PR 均跳过并报告。
4. 清理后复查分支列表与两条开放 PR。**不要**手工删除未合并的 `ops/manual-cloudflare-deploy-fallback-20261104`，除非专门决定该备用部署方案的去留。

连接器没有直接删除 Git refs 的操作，因此脚本使用 GitHub Actions 作为受限执行通道。**首次合并这份分支档案时**，若主分支合并提交标题含唯一标记 `[branch-gc-20261105]` 且触发者为仓库所有者，将仅对快照中 85 个已合并且 SHA 未变化的分支执行一次清理；普通 PR / main push 不会触发。本次已全部成功，不需要重复执行；若后续发生其他分支清理需求，应先重新建档并审查所有 SHA，而不是无限复用旧快照。执行结果和失败记录保存在相应的 Actions 运行日志中。

## 二次清理预案 · 2026-11-06

本次实时核查共有 **43 条**分支，其中 **26 条**满足“PR 已合并、分支 HEAD SHA 与对应 PR HEAD SHA 完全一致、无开放 PR、未受保护”的条件。其余 **17 条**为 `main` 1、开放 PR 2、关闭未合并 PR 12、无 PR 关联 2；全部排除在批量清理范围之外。

第二次清理的 SHA 固定快照：[`branch-inventory-2026-11-06.json`](branch-inventory-2026-11-06.json)。仅在合并提交带有唯一标记 `[branch-gc-20261106]` 时，可信 `main` 的 Actions 执行一轮删除，并在逐条删除前重新验证 SHA、PR merged 状态以及开放 PR。**计划记录不代表删除成功**，实际结果以运行日志与清理后 GitHub 分支列表为准。旧的 2026-11-05 快照维持原样作为历史证据。清理完成后应移除这套一次性执行配置，不保留长期自动删除机制。

## 第二轮显式替代分支清理预案 · 2026-11-06

第一轮 Actions run [#42105139504](https://github.com/YohakuSama/waylan-blog/actions/runs/42105139504) 的 `branches` 作业成功，共删除 26 条已合并的分支，实时列表 18 条。第二轮仅纳入 5 个已经人工核对的对象：已合并 PR #129 分支，以及因已合并 #125/#46/#69 明确取代而关闭且未合并的 #126、#127、#49、#68 分支。详见 [第二轮冻结快照](branch-inventory-2026-11-06-round2.json)。PR #117 的实时分支 SHA 与 PR head 不相等，故**不得**纳入本次删除；其余开放、未关联与未确认替代分支同样保留。

清理遵循快照 SHA 不变、PR 状态匹配、无开放 PR 和分支未保护的规则，并校验替代 PR 确实已合并。本计划不保证删除成功；以第二轮 Actions job 日志和实际分支数为准。完成后删除临时垃圾回收 workflow 入口、脚本和两轮 JSON 快照，防止项目继续堆积维护基础设施。
