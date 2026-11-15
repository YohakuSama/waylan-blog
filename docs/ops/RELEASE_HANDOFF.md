# Waylan 发布前核对与回滚清单

更新：2026-11-15。本文件描述需要检查的项目，不代表生产部署已完成。

## 当前仓库状态

- 源码仓库：`YohakuSama/waylan-blog`，默认分支 `main`。
- 仓库从 ZIP 导入，旧项目的 PR、Issue、分支和历史 CI 记录没有随之迁移；不要使用旧编号作为当前仓库证据。
- 导入提交：`c564f98c92a7b80911502f43ae8619d3a5506a21`。
- [导入后的 CI 运行](https://github.com/YohakuSama/waylan-blog/actions/runs/43631594229) 执行了构建、类型检查、394 项单元测试及静态检查。该次运行跳过了实际浏览器矩阵。
- 此前检查发现源仓库没有启用 Discussions，配置中所指的旧评论仓库也无法访问。评论和通知尚未完成真实服务验证。
- `main` 未配置分支保护。不要把代码中的 `review-pr` 功能当作已启用的发布门禁。

## 上线之前

1. 确认你有权限使用 `SITE_ORIGIN` 对应的真实域名；让云端 Build 环境的 `SITE_URL` 与其一致。正式构建不能保留 `YOUR_DOMAIN` 或 `noindex`。
2. 在 Cloudflare 核对实际 Worker 名称 `waylan-blog`、D1 绑定 `DB`、数据库 ID、迁移和生产 Secrets。源文件中的数据库 ID 不足以证明账号里存在该数据库。
3. 选择一个公开且开启 Discussions 的仓库，在 `wrangler.jsonc`、`.env` 和 GitHub App 安装授权中填写相同的 owner/repo。当前配置使用占位符，评论服务保持未配置状态。
4. 验证 GitHub App 的 Homepage、回调地址、只读 Token、独立内容仓库写入 Token 和管理员白名单；不要在仓库或聊天里分享 Secret。
5. 初始化文章对应的 Discussion，并核对 D1 映射、评论、批注、Webhook、通知。
6. 检查 Cloudflare Workers Builds 是否与目标 `main` SHA 一致，并确认激活版本。GitHub CI 成功不能代替部署成功。
7. 验证实际网址的 HTML、RSS、Sitemap、robots、canonical、OG 图片、404、后台授权和移动端阅读。
8. 在 iPhone、Android、平板与 Chromium/Firefox/WebKit 检查导航、选区、评论和布局；没有设备证据就明确记录为未验证。

## 更改发布模式

默认 `CONTENT_PUBLISH_MODE` 是 `direct`，后台直接提交源码分支。切换到 `review-pr` 前，先在隔离环境验证草稿 PR 创建、继续编辑、冲突、审核和合并。通过后再设置分支保护及必需的 `Waylan CI / check`。未经验证不直接切换生产模式。

## 每次发布记录

| 项目 | 记录 |
| --- | --- |
| 源码 | 提交 SHA、对应 PR（如果存在） |
| GitHub Actions | 运行链接、哪些测试执行、结论 |
| Cloudflare | Build ID、活跃 Worker Version ID |
| 站点 | 真实网址、测试时间、通过/失败/未验证 |
| 数据 | D1 迁移、Discussion 映射、回滚要求 |

回滚分为源码回滚和 Cloudflare 活跃版本回滚。D1 迁移不能随意删除或倒改；数据变更先检查备份和兼容性。
