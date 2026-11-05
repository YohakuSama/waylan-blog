# Waylan Blog 分支清理归档

此文件仅保留已核验的清理摘要。详细 SHA、PR 和运行证据可在提交历史与 GitHub Actions 中追溯，不再将过期 JSON 清单作为长期仓库文件。

- **2026-11-05**：历史第一轮清理已合并分支 85 条。依据 [原操作记录 PR #99](https://github.com/YohakuSama/waylan-blog/pull/99) 与 [Actions #42034859036](https://github.com/YohakuSama/waylan-blog/actions/runs/42034859036)。
- **2026-11-06**：核验 43 条分支，确认并通过 [PR #129](https://github.com/YohakuSama/waylan-blog/pull/129) 删除 26 条已合并分支；[Actions #42105139504](https://github.com/YohakuSama/waylan-blog/actions/runs/42105139504) 显示 `Eligible: 26`、`failures: []`，并已重新核查远端分支列表。
- **第二轮被取代分支**：见 [PR #130](https://github.com/YohakuSama/waylan-blog/pull/130)，须以该 PR 的最终合并状态、主分支 Actions 删除日志和远端分支列表为准，不把候选记录当成已删除结果。

保留未合并、受保护、无 PR 对应关系或 SHA 不匹配的分支；特别是仍开放的 [PR #23](https://github.com/YohakuSama/waylan-blog/pull/23) 与 [PR #57](https://github.com/YohakuSama/waylan-blog/pull/57) 有未完成事项，不根据时间或前缀自动删除。

**此仓库不保留周期性自动删除分支的 Actions 任务。** 后续需要逐个核验并另行执行清理。
