# 分支清理结项与保留原则

2026-11-05 的首次归档建立 98 条分支快照，已核对并通过 [Waylan CI 运行 #42034859036](https://github.com/YohakuSama/waylan-blog/actions/runs/42034859036) 删除其中 85 条已合并分支。

2026-11-06 的 [PR #129](https://github.com/YohakuSama/waylan-blog/pull/129) 为 26 条新增已合并分支建立 SHA/PR 双重核验清单，随后 [运行 #42105139504](https://github.com/YohakuSama/waylan-blog/actions/runs/42105139504) 成功回收 26 条，分支数量从 43 条降至 18 条（包含 #129 的工作分支）。

第二轮 [PR #130](https://github.com/YohakuSama/waylan-blog/pull/130) 仅针对已合并 #129 的工作分支，以及 #126、#127、#49、#68 四条被已合并 PR 明确取代的未合并分支。[Waylan CI 运行 #42106024139](https://github.com/YohakuSama/waylan-blog/actions/runs/42106024139) 的分支任务成功，实际删除四条被明确取代的分支。#129 分支因删除前 HEAD SHA 已变化（`sha-changed`）自动跳过，**未删除且不能据原快照再删除**。 特别注意 PR #117 关联分支 SHA 与 PR head 不一致，未列入删除目标。

历史 JSON 快照与专用脚本已从长期项目文件中撤除（仍可在 Git 提交与 PR 审计历史中查阅）。剩余的开放 PR、关闭未合并但未证明可弃用的分支、无 PR 关联分支均需人工判断。**关闭或删除分支不删除 GitHub PR 讨论与提交记录。** 不再为临时垃圾回收维护额外 Actions 任务。
