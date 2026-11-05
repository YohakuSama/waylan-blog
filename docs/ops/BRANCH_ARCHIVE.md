# Git 分支存量档案 · 2026-11-05

此档案保存在仓库中，**不是额外的长期归档分支**。历史 PR、提交仍由 Git 保留；删除已合并分支不等于删除提交历史。完整分支名称、准确 SHA 和关联 PR 见 [JSON 快照](branch-inventory-2026-11-05.json)。

## 快照统计

- 总计 98 分支：主分支 1；已合并 PR 对应 85；仍有开放 PR 2；已关闭未合并 8；快照时无关联 PR 2。
- **可自动清理的上限：85 个**。执行前须再次确认 GitHub 上分支 SHA 未变、PR 真正 merged、没有新的开放 PR、未被保护。
- 开放 PR 和无合并记录的分支全部保留待人工判断。旧分支可能有尚未合入的独立工作，不能用日期或前缀判定“垃圾”。
- 快照仅反映记录时的 HEAD；未来产生的分支不在此次自动清理范围内。本次运维分支不包含在初始快照中；本次合并后如仍存在，应纳入下一期人工核验。

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
| unlinked | `ops/actions-budget-and-branch-archive-20261105` | — | `e82999b23dd9` |
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

连接器没有直接删除 Git refs 的操作，因此脚本使用 GitHub Actions 作为受限执行通道。**首次合并这份分支档案时**，若主分支合并提交标题含唯一标记 `[branch-gc-20261105]` 且触发者为仓库所有者，将仅对快照中 85 个已合并且 SHA 未变化的分支执行一次清理；普通 PR / main push 不会触发。若这一轮未执行或部分失败，仍可按上述手动预览和确认流程补做。执行结果和失败记录保存在相应的 Actions 运行日志中。
