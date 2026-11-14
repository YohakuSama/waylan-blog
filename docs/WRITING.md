# 写作与维护指南

日常维护只需要改 `content/` 和 `public/` 两个文件夹，不用碰任何代码。每次修改后运行 `npm run build`（或开着 `npm run dev` 重启一下）就能看到效果；格式写错时，构建会用中文提示是哪个文件、哪个字段出了问题。

## 一、发表新文章

在 `content/posts/` 新建一个 `.md` 文件，文件名建议用英文，例如 `win11-setup.md`。最小模板：

```markdown
---
title: Win11 装完系统后我会做的十件事
date: 2026-11-01
topic: system
tags: [Windows, 系统优化]
---

正文从这里开始，标准 Markdown 即可。
```

只有 `title`、`date`、`topic` 是必填项，其余都可选：

| 字段      | 说明                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | 标题                                                                                                                                            |
| `date`    | 发布日期，格式 `YYYY-MM-DD`                                                                                                                     |
| `topic`   | 分类，取 `content/site.json` 里 `topics` 的 `id`：`system` 系统与软件 / `network` 网络与服务 / `dev` 编程开发 / `explore` 新技术 / `notes` 随笔 |
| `tags`    | 标签，`[Linux, Docker]` 或只写一个 `Linux`                                                                                                      |
| `excerpt` | 摘要。不写时自动截取正文开头；写了会同时显示在文章标题下方                                                                                      |
| `updated` | 修订日期。文章标题下会显示「更新于 …」，RSS/Sitemap 同步更新                                                                                    |
| `draft`   | 写 `draft: true` 为草稿，不会发布，写完删掉这一行即可                                                                                           |
| `type`    | 内容类型，默认 `article` 文章；可选 `note` 笔记、`thought` 想法、`journal` 日志、`project` 项目                                                 |
| `slug`    | 网址，默认等于文件名：`/post/win11-setup`。文件名是中文时必须手写，只能用小写英文、数字和连字符                                                 |
| `cover`   | 封面图，例如 `/images/win11-cover.png`；写了封面必须同时写 `coverAlt`（图片的文字说明）                                                         |

`type: project` 还需要 `status`（如「维护中」）和 `stack: [Go, SQLite]`，可选 `repo`、`demo`（https 链接）。

> **发布后不要再改 slug。** 评论和划线是挂在文章上的，改了 slug 旧链接会失效；确实要改时，先在 frontmatter 写 `id: 旧slug` 保留身份，再在 `public/_redirects` 加一行 `/post/旧slug /post/新slug 301`。

### 正文支持的写法

- 标题 `##` / `###` 会自动生成右侧目录（`#` 已被文章标题占用，正文从 `##` 开始）；`####` 也可以用，但不进目录。
- 代码块请标注语言，构建时自动高亮：` ```bash `、` ```powershell `、` ```yaml `、` ```nginx `、` ```json `、` ```python ` 等。
  bash 代码块里以 `$ ` 开头的行会被当作命令，其余行显示为输出，复制时自动去掉 `$`。
- 表格、引用、有序/无序列表、任务清单 `- [x] 已完成` / `- [ ] 待办`、行内代码、链接都可以直接用。
- 图片：把文件放进 `public/images/`，正文里写 `![图片说明](/images/文件名.png)`。也可以直接用 `https://` 外链图片。
- 出于安全考虑，正文里的 `<script>`、`<iframe>`、内联样式等 HTML 会被过滤掉。

### 发布

```bash
npm run build      # 检查格式并生成页面
npm run deploy     # 发布到 Cloudflare
```

新文章第一次发布时，还要按 README「持续写文章」一节同步数据库和评论区映射。

## 二、更换头像

1. 把头像图片放到 `public/`，例如 `public/avatar.jpg`（正方形、至少 256×256，支持 jpg/png/webp/avif/svg）。
2. 修改 `content/site.json`：`"avatar": "/avatar.jpg"`。

侧栏、文章署名和「关于」页会一起更新。改回 `""` 即恢复默认的字母徽标。路径填错或文件不存在时，构建会直接报错提醒。

## 三、填写联系方式

在 `content/site.json` 的 `socials` 里填写，只需要 `url`，图标和名称会自动识别：

```json
"socials": [
  { "url": "https://x.com/你的用户名" },
  { "url": "https://t.me/你的用户名" },
  { "url": "you@example.com" },
  { "url": "https://github.com/你的用户名" },
  { "url": "https://example.com", "label": "个人主页" }
]
```

- X（x.com / twitter.com）、Telegram（t.me）、GitHub、邮箱会显示对应图标；其他网址显示链接图标，名称默认是域名，可用 `label` 自定义。
- 邮箱直接写地址即可，会自动变成 `mailto:` 链接。
- 只接受 `https://` 链接和邮箱。
- 联系方式会出现在侧栏头像下方（图标）和「关于」页（图标 + 文字）。当 `socials` 为空时不会展示 X、Telegram 等入口；请只填写自己真实的账号地址，勿保留示例地址。

## 四、修改个人介绍

- 「关于」页正文：编辑 `content/about.md`，普通 Markdown。
- 站点名、作者名、首页标语、简介、分类：编辑 `content/site.json` 中的 `name`、`author`、`hero`、`description`、`intro`、`topics`。
  新增分类时给出 `id`（英文）、`name`、`description`；没有文章的分类不会出现在筛选栏里。

## 五、发布前确认文章与作者信息

当前工程保留了建站期间撰写的技术文章。此前已删除 `sample: true` 这类展示标记，但**标记消失不代表文章经历已由站长核实**。正式发布前：

1. 检查 `content/posts/` 中每篇文章的作者、具体环境、结论、日期与引用，删除未实际完成或未经核实的内容。
2. 核对 `content/about.md` 是否符合实际介绍，更新 `content/site.json` 的站名、简介与分类。
3. 检查插图和第三方素材的授权；需要移除文章时，连同不再被使用的图片一起删除。
4. `npm run check` 构建并检查站内链接，再执行域名、OAuth、D1 的实际部署验收。
