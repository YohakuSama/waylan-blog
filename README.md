# Waylan / 系统、软件与技术实践

一个可以自行部署到 Cloudflare 的个人博客工程。采用 **React + TypeScript + Vite 静态预渲染 + Workers Static Assets + D1 + GitHub Discussions**。

这次重建沿用了旧工程中值得保留的“静态内容优先”思路，重新设计了页面结构、内容流、阅读器、转场与评论系统。没有继续使用固定视口逐条切换的信息流。

**页面本身是静态网页。GitHub 登录、发表评论、跨设备公开批注必须由 Worker 服务端处理，不能只上传静态 HTML 就安全实现。** 本工程把两部分放在同一个 Cloudflare Worker 部署，无需额外服务器、Vercel 或 Supabase。

本站写的是**系统配置、软件使用、网络服务、脚本自动化和新技术实践**；React 等仅是建站所用工具，不代表作者职业或写作方向。

## 2.2：网页后台

新增 `/admin` 网页后台：在浏览器里发布、修改、删除文章，上传图片，修改站点名、作者名、头像和联系方式，并一键为新文章开启评论区。启用方法见下文“网页后台 /admin”。另修复了“全部 / 文章 / 笔记”等分区切换时，黑色滑块先到、文字后出现的闪烁。

## 2.0 正式版

2.0 是 1.x 系列的收官版本，重点是“稳”和“满”：

- **首屏不跳字**：预渲染时按页面正文挑出实际用到的中文/等宽字体切片做 `preload`，并为等宽字体提供度量对齐的本地回退；`theme.js` 在首帧前确定皮肤、明暗与地址栏颜色。
- **浏览量**：文章卡片、阅读器和侧栏“读得最多”显示真实阅读数。计数由 Worker 写入 D1，同一访客同一篇每天只计一次，爬虫不计；不设 Cookie，不保存 IP（只存带密钥、两天内过期的哈希）。未连接 D1 或离线预览时不显示，不伪造数字。
- **阅读清单**：书签入口集成在页眉，可收藏、移除、随机读一篇；清空采用两步确认。数据只在当前浏览器。
- **更充实的页面**：阅读器侧栏增加字数、阅读量、发布/修订日期与剩余阅读时间；归档页在宽屏增加统计与标签云；关于页增加站点数据；项目以仓库卡片呈现；404 会猜测你要找的文章并列出最近更新（点一下那枚回声图标试试）。
- **统一的交互层级**：移动端菜单带遮罩且点遮罩只关闭、不误触下方链接；加载提示统一为页眉底部一条细线；对话框、确认按钮、错误状态使用同一套样式。
- **新头像与站标**：杂志与终端两套形态，随明暗自动换色；favicon / ICO / Apple Touch Icon 同源导出。详见 `docs/BRAND.md`。
- **清理**：移除 1.6 的外挂脚本 `reading-tools.js/css`（已并入 React 组件）、被皮肤覆盖的旧 Token 和无引用的样式。

## 先看网站：直接双击，无需安装

压缩包目录：

```text
Waylan-v2.0/
├── index.html       单文件浏览入口（本地可打开，不用于线上部署）
├── 先看这里.txt     从这里开始
├── 本次更新与验收.md 2.0 改动与验证记录
├── 上线前核对.md     发布前确认项
└── source/          源码、部署配置、测试与 dist
```

**直接浏览网站：解压后双击最外层的 `index.html`。** 所有脚本、样式、中文/等宽字体和配图已经装进一个 HTML 文件，不需要 Node、不需要安装依赖、不依赖 CDN。预览中可以切换页面、筛选、搜索、阅读、打开图片、切换主题和进行私人划线。GitHub 公开评论显示尚未连接，不会模拟读者或伪造登录。

本地独立浏览文件放在压缩包最外层的 `index.html`；运行 `npm run build` 会在 `source/preview/index.html` 重新生成。`source/index.html` 是 Vite 入口，不能双击当作完整网站。某些浏览器不允许本地文件保存数据，此时私人划线可能仅保留到本次阅读。

正式部署使用 `source/` 内的工程。下面的命令都在 **source 目录** 执行。

## 开发调试

需要 Node.js **24 或更新版本**（测试使用 Node 内置 SQLite）、npm 和现代浏览器。

```bash
npm ci
npm run dev
```

打开终端显示的地址。此模式执行真实 Worker 的“无绑定”路径：可以浏览文章、筛选、搜索、切换主题、私人划线；公开讨论明确显示未开放。它没有伪造登录或读者评论。

```bash
npm run check        # 类型、自动化测试、静态构建、产物完整性
npm run build        # 生成 dist/ 完整 HTML、JS、CSS、RSS、Sitemap
npm run preview      # 预览静态构建；API 需完整 Worker 模式
```

`dist/` 是正式 HTTP 部署产物，必须经由 Web 服务器访问；请勿双击 `dist/index.html` 测试站内链接。只有最外层的 `index.html` 可直接本地打开。`source/index.html` 是 Vite 开发入口；运行 `npm run build` 会在 `source/preview/index.html` 生成新的独立浏览文件。

重新生成独立浏览文件可运行 `npm run build`，或在已有 dist/RSS 后执行 `npm run build:preview`。离线构建使用单一普通脚本和 fragment 路由；正式网站仍使用独立 URL、预渲染和真实 API。

## 页面与使用

| 地址          | 内容                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `/`           | 首页：站点介绍、最新内容流（类型筛选/密度切换）、侧栏主题与更新热力图、继续阅读 |
| `/feed`       | 纵向文章流；主题、全文搜索、日期排序；真实评论预览与浏览量                      |
| `/post/:slug` | 阅读器、目录、进度与剩余时间、字号、图片放大、代码复制、划线、讨论、深链        |
| `/projects`   | 项目卡片：仓库、技术栈、状态                                                    |
| `/archive`    | 按年归档与快速检索；宽屏附统计与标签云                                          |
| `/about`      | 可编辑的个人自述、写作主题与站点数据                                            |
| 其他路径      | HTTP 404 与 404 页面：猜你要找的文章、最近更新                                  |

首页进入内容流、卡片进入阅读器共享标题和配图的位置。支持 View Transitions 的浏览器使用原生共享元素动画；其余浏览器使用图片位置过渡和淡入反馈。页眉的“阅读设置”可以切换杂志/终端风格、明暗配色和动效；低核心数设备默认使用轻量过渡，不劫持滚动。返回恢复 URL 中的筛选、排序、关键词与历史条目的滚动位置。

阅读时选择 2–4000 字、最多 8 个内容块，可选择“划线 / 回声 / 复制 / 分享”。私人划线保存在当前浏览器，可在“阅读设置 → 私人划线”查看及清除；**公开评论启用后，正文保存在 GitHub，定位关系在 D1**。公开批注可通过 `#echo-COMMENT_NODE_ID` 分享。登录前的选区和草稿使用 sessionStorage 暂存，登录回来恢复。

## 目录

```text
source/
├── content/
│   ├── site.json                 站名、作者、头像、分类、简介和联系方式
│   ├── about.md                  「关于」页正文
│   └── posts/*.md                文章内容
├── public/art/                   原创 SVG 插图及 PNG 社交预览
├── public/images/                文章配图
├── admin/index.html              网页后台入口（/admin）
├── src/
│   ├── admin/                    网页后台界面：内容列表、编辑器、站点资料
│   ├── App.tsx                   导航、主题、搜索和页面装配
│   ├── pages.tsx                 首页、信息流、关于、归档、404
│   ├── components/Reader.tsx     阅读器、选区工具栏、讨论与草稿
│   ├── components/UI.tsx         统一 PostCard、评论预览、原生 Dialog
│   ├── components/Shelf.tsx      阅读清单、两步确认按钮、回到顶部
│   ├── lib/views.ts              浏览量读取与记录（离线时自动停用）
│   ├── lib/                      路由、API、DOM 选区与高亮
│   ├── generated/                从 Markdown 生成，不手动改
│   └── styles.css                全局设计 Token 与组件规范
├── shared/                       前后端类型与文本定位算法
├── worker/                       OAuth、会话、GitHub、缓存、评论与后台 API
├── migrations/                   D1 结构与初始文章记录
├── scripts/                      内容、预渲染、完整性检查、GitHub 初始化
├── tests/                        Node 原生测试、真实 SQLite、JSDOM
├── docs/                         架构、写作与设计系统说明
├── .env.example                  构建与一次性 GitHub 配置示例
├── .dev.vars.example             本地 Worker 机密示例
├── wrangler.jsonc                Cloudflare Worker + Assets + D1
└── dist/                         可直接部署的预渲染静态资源
```

## Cloudflare 第一次部署

**上线前必须检查**：`SITE_URL`、`wrangler.jsonc` 的域名与数据库绑定须与实际账号一致。当前打包仍含原项目的演示性质文章，发布前应由站长核实其真实性和版权；见根目录 `上线前核对.md`。源码附带的 `tests/` 用于质量验证，不会被部署为静态资源。

### 1. 设置域名和仓库

复制 `.env.example` 为 `.env`。填入真实域名和公开的 GitHub Discussions 仓库。不要提交 `.env`。

```dotenv
SITE_URL=https://blog.your-domain.com
GITHUB_REPO_OWNER=your-github-name
GITHUB_REPO_NAME=your-public-blog-discussions
GITHUB_CATEGORY_NAME=Blog
GITHUB_SETUP_TOKEN=your-maintainer-token
```

在 GitHub 仓库 Settings → General → Features 启用 Discussions，创建 **open-ended discussion** 分类，例如 `Blog`。不要使用只允许维护者发帖、且禁止普通读者评论的仓库策略。

`GITHUB_SETUP_TOKEN` 只给本机初始化脚本使用，需要指定仓库的 Discussions 读写权限。它以维护者身份建立文章的 Discussion **主帖**，不用于代表读者发表评论。初始化完成后可以撤销该 Token 并从 `.env` 删除。

### 2. 创建 D1

```bash
npx wrangler login
npx wrangler d1 create echo-db
```

把返回的 `database_id` 填到 `wrangler.jsonc`。同一文件的 `vars` 改为：

```json
{
  "SITE_ORIGIN": "https://blog.your-domain.com",
  "GITHUB_REPO_OWNER": "your-github-name",
  "GITHUB_REPO_NAME": "your-public-blog-discussions"
}
```

`SITE_ORIGIN` 必须与 `.env` 的 `SITE_URL` 完全一致，包括协议；不要尾斜杠。它用于 OAuth 回调、Cookie 和 CSRF 来源校验。

```bash
npm run build
npm run db:remote
npm run db:sync:remote
```

迁移文件只执行一次；每次内容变更由构建生成的 `.echo/posts.sql` 同步文章元数据。已应用的迁移文件不要重新修改。

### 3. 建立文章与 Discussion 的真实映射

```bash
npm run setup:github
```

上面只读取并显示计划。检查仓库和分类无误后：

```bash
npm run setup:github -- --write
npx wrangler d1 execute echo-db --remote --file .echo/discussions.sql
```

脚本查询真实 repository/category/discussion ID；通过主帖里的稳定文章 ID 标记找回已有 Discussion，不因为标题修改而新建。不要手工编造 GraphQL 节点 ID。

如果创建请求遇到不确定网络结果，请先在 GitHub 确认；再次运行脚本会先遍历已有主帖再建立缺失项。不要同时运行多个初始化脚本。

### 4. 创建 GitHub OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App：

- Homepage URL：`https://blog.your-domain.com`
- Authorization callback URL：`https://blog.your-domain.com/api/auth/callback`

本实现使用 OAuth App 的 `public_repo` scope。GitHub Discussions 的 OAuth 写入要求该权限；**这是公共仓库的较宽权限**，不是一个仅评论的独立 scope。仓库和账号的最终权限仍由 GitHub 执行。代码不申请私有仓库的 `repo` scope。若今后改为 GitHub App，可进一步收窄授权，但不能只替换 Client ID 而不重做完整的授权配置。

服务端 Secrets 逐个录入，终端会安全提示输入值：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_READ_TOKEN
npx wrangler secret put SESSION_SECRET
```

- `GITHUB_READ_TOKEN`：独立的 fine-grained PAT，仅选择此公开仓库，Discussions **read-only**、Metadata read。匿名访客由服务端读取公开讨论。留意 Token 有效期并按时轮换。
- `SESSION_SECRET`：至少 32 个字符的高熵随机值。例如 `openssl rand -base64 32`。Windows 可用密码管理器生成，或使用 Node 的 `crypto.randomBytes(32).toString('base64')`。
- 用户发表评论时使用**自己的 OAuth Token**；读评论的 Token 不参与写入。
- 会话到期或 GitHub 撤销授权后重新登录，草稿保留。若 OAuth 返回带有效期的 Token，会话会在其失效前到期；本版不长期持有 refresh token。

### 5. 部署并绑定自己的域名

```bash
npm run deploy
```

这个命令先完成类型、测试、静态构建和配置校验，再应用迁移并执行 Wrangler 部署。部署后的 Worker 会从本次构建生成的文章清单自动校准 D1 元数据（slug、标题、版本），不再需要在部署前手工执行文章同步。域名或数据库仍是占位符时会阻止部署。

Cloudflare 控制台 → Workers & Pages → `echo-blog` → Settings → Domains & Routes → Add → Custom Domain，填入自己的完整域名。域名已由同一 Cloudflare 账户管理时，平台负责所需 DNS 和证书。已有同名 DNS 记录请先在控制台核对，避免误覆盖其他服务。

也可在 `wrangler.jsonc` 顶层添加：

```json
"routes": [{ "pattern": "blog.your-domain.com", "custom_domain": true }]
```

按当前 Wrangler 规则使用自定义域名，不要给 `custom_domain` 的 pattern 加 `/*`。绑定完成后用**正式域名**测试 OAuth 回调，不能拿 workers.dev 登录再期待 Cookie 自动跨域。

### 6. 可选：GitHub Webhook 加速同步

```bash
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

GitHub 仓库 → Settings → Webhooks：

- Payload URL：`https://blog.your-domain.com/api/webhook/github`
- Content type：`application/json`
- Secret：与 Worker Secret 一致
- Events：Discussions、Discussion comments

Webhook 校验 SHA-256 签名和仓库名，编辑后失效缓存，删除后清理对应定位。没有 Webhook 时，公开读取缓存最长 60 秒更新；短暂上游故障可使用 15 分钟内的缓存，并明确标记为缓存内容。活动页面每 60 秒或回到窗口时重新读取。

## 网页后台 /admin（2.2 新增）

上线后打开 `https://你的域名/admin`，用 GitHub 登录即可在浏览器里管理网站，不用再开终端：

- **发布 / 修改 / 删除**文章、笔记、项目等全部内容；Markdown 编辑带实时预览，`Ctrl/Cmd + S` 保存。
- **上传图片**：封面和正文插图直接选文件，自动存到 `public/images/`。
- **站点资料**：站点名、作者名（用户名）、**头像**、介绍、个人标签、联系方式、关于页。
- **开启评论区**：新发布的文章出现提示时点一下，后台用你自己的 GitHub 账号为它建立 Discussion，评论和划线即可使用。
- 顶部显示部署状态：保存后约一两分钟网站自动更新，完成后显示“线上已是最新版本”。

**原理（为什么这样设计）**：网站仍是静态页面，速度和安全性不变。后台每次保存都会作为一次 Git 提交写进你的源码仓库（提交说明里写明操作者），Cloudflare 收到提交后自动重新构建、部署。所以：

- 所有改动都有历史记录，误删的文章可以在 GitHub 提交历史里找回；
- 你在本地改文件、`git push`，和在后台改，效果完全一样，两边可以混用；
- 两个窗口同时编辑同一篇时，后保存的会被拒绝并提示刷新，不会互相覆盖。

### 启用步骤（在上面 1–5 步之后做一次）

**A. 把源码放进 GitHub 仓库。** 新建一个仓库（可以是**私有**），把本目录推上去。`.env`、`.dev.vars` 已在 `.gitignore` 中，不会被提交。这个“源码仓库”和第 1 步的“评论仓库”可以是两个仓库；如果源码仓库本身公开并开启了 Discussions，也可以是同一个。

**B. 让 Cloudflare 从仓库自动部署（Workers Builds）。** Cloudflare 控制台 → Workers & Pages → `echo-blog` → Settings → Build → Connect，选择源码仓库和分支 `main`，然后填写：

| 项目 | 填写 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build variables | `SITE_URL` = `https://blog.your-domain.com`（与 `SITE_ORIGIN` 完全一致） |

`SITE_URL` 必须在这里填：云端构建读不到你本地的 `.env`，不填会被当成预览站并加上 `noindex`。Worker 名称必须与 `wrangler.jsonc` 的 `name`（默认 `echo-blog`）一致。工程需要 Node.js 24，仓库根目录的 `.node-version` 会让云端构建自动使用它。D1 迁移已在第 2 步执行过，自动部署不再碰数据库结构；以后若某个新版本新增了 `migrations/` 文件，在本机运行一次 `npm run db:remote` 即可。

**C. 填后台配置。** `wrangler.jsonc` 的 `vars`：

```json
"ADMIN_GITHUB_LOGINS": "your-github-name",
"CONTENT_REPO": "your-github-name/your-blog-source",
"CONTENT_BRANCH": "main"
```

- `ADMIN_GITHUB_LOGINS`：允许进后台的 GitHub 用户名，多个用逗号分隔。不在名单里的人即使登录也只能看到“没有权限”。
- `CONTENT_REPO`：源码仓库 `owner/name`；`CONTENT_BRANCH`：Cloudflare 监听的分支。

**D. 创建写入用的 Token。** GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate：

- Repository access：**Only select repositories** → 只选源码仓库；
- Permissions：**Contents: Read and write**（Metadata: Read 会自动带上），其余都不要；
- 有效期按需选择，到期前换新。

```bash
npx wrangler secret put GITHUB_CONTENT_TOKEN
```

**E. 提交并推送**修改后的 `wrangler.jsonc`，等第一次自动构建完成，访问 `/admin` 登录。之后的日常更新都在后台完成；第 5 步的 `npm run deploy` 仍然可以用来手动部署。

登录沿用第 4 步的 GitHub OAuth App，**不需要新建 App 或新增回调地址**。

### 常见问题

- **后台显示“后台还没有配置完成”**：页面会列出缺少的项目。通常是 `ADMIN_GITHUB_LOGINS` / `CONTENT_REPO` 仍是占位符、新的 `wrangler.jsonc` 还没部署，或没有录入 `GITHUB_CONTENT_TOKEN`。
- **提示“无法访问源码仓库”**：检查 `GITHUB_CONTENT_TOKEN` 是否过期、是否勾选了源码仓库、Contents 是否为 Read and write。
- **保存成功但网站一直没变**：到 Cloudflare → `echo-blog` → Deployments 查看构建日志。最常见的是文章内容不合法导致构建失败（后台会先做同样的检查，通常在保存时就会提示）。超过 10 分钟未更新时后台会给出提醒。
- **改了文章链接名（slug）**：通过 `/admin` 保存时，会自动在同一次 Git 提交中生成旧地址的 301 跳转；评论和划线仍绑定不变的 `id`。直接编辑仓库 Markdown 时，请自行维护 `public/_redirects`；构建会检查旧地址不能与现行文章冲突、目标文章必须存在。
- **图片限制**：PNG / JPEG / WebP / AVIF / GIF，单张 5 MB；出于安全原因不接受 SVG 上传。

## 完整本地联调

GitHub OAuth App 的回调只允许预先配置的地址。本地请**另建开发 OAuth App**，不要频繁修改正式 App。

1. `.dev.vars.example` 复制为 `.dev.vars`；本地 `SITE_ORIGIN=http://localhost:8787`，填开发 OAuth App 的 ID/Secret 和只读 Token。开发 App 回调为 `http://localhost:8787/api/auth/callback`。
2. 保持与 `.env`、`wrangler.jsonc` 一致的仓库。建表、同步内容和映射：

```bash
npm run build
npm run db:local
npm run db:sync:local
npm run setup:github -- --write
npx wrangler d1 execute echo-db --local --file .echo/discussions.sql
npm run dev:worker
```

3. 打开 Wrangler 显示的 `http://localhost:8787`。本地依旧会对**真实公开仓库**读写；建议单独测试仓库。不要把本地测试评论当成示例数据发到正式讨论里。
4. 完成：首页 → 主题筛选 → 文章 → 选中文字 → 回声 → GitHub 登录 → 恢复草稿 → 发表 → 刷新 → 点高亮 → 退出 → 返回列表。

纯前端热更新可用 `npm run dev`；需要同时连接另一个本地 Worker 时设置 `ECHO_DEV_API=http://localhost:8787`。同源 Cookie/Origin 验证以完整 `dev:worker` 模式为准。

## 持续写文章

**启用网页后台后，日常写作直接在 `/admin` 完成，下面的命令行流程可以不用。** 以下适用于在本地编辑文件的方式。

在 `content/posts/` 新建 `.md`，不需要修改 React 组件。**字段说明、图片、头像与联系方式的写法，见 [`docs/WRITING.md`](docs/WRITING.md)。**

```markdown
---
title: Win11 装完系统后我会做的十件事
date: 2026-11-01
topic: system
tags: [Windows, 系统优化]
---

正文，标准 Markdown。
```

- `slug` 默认等于文件名，`id` 默认等于 `slug`。**发布后 `id` 永久不变**（评论和划线挂在它上面）；手工改网址时保留 `id: 旧slug`，并在 `public/_redirects` 增加旧址的 301 跳转。网页后台会自动处理这一流程。
- `topic` 取自 `content/site.json`；主题计数、列表、归档、搜索、RSS 和 Sitemap 自动生成。
- 可以给重要段落写显式的 `<!-- block:... -->`，修改段落时保留 ID；未标注时使用内容哈希作为块 ID，仍可借助原文上下文重定位划线。
- `src/generated/` 和 `worker/generated/` 由 `npm run content`/build 自动生成；重启开发命令可读取新增文章。

新增文章后：

```bash
npm run build
# 仅在马上手动导入 Discussion 映射时，先同步新文章的 D1 外键目标
npm run db:sync:remote
npm run setup:github -- --write
npx wrangler d1 execute echo-db --remote --file .echo/discussions.sql
npm run deploy
```

仅修改文字可直接 `npm run deploy`，旧 Discussion 和批注不会因为标题改变而丢失。

## 安全、数据与故障行为

详见 `docs/ARCHITECTURE.md`。摘要：

- OAuth state、PKCE S256、一次性 flow、同源校验与会话 CSRF Token。
- 生产 Cookie：`__Host-`、HttpOnly、Secure、SameSite=Lax、Path=/；本地 HTTP 使用无 `__Host-` 的开发 Cookie。
- D1 只存会话 ID 的哈希；用户 OAuth Token 使用 AES-GCM 加密。轮换 SESSION_SECRET 会使旧会话失效。
- GitHub 为正文来源；D1 缓存有期限。站内不伪造用户身份，不使用管理员 Token 代发。
- 评论 Markdown 禁止原始 HTML 和危险 URL；评论图片不自动加载。
- 用户写入 5 次/分钟、80 次/天；公开 API 每 IP 180 次/分钟。限流键哈希化并定期清理。
- 网络结果不确定时保留提交 ID，查询 GitHub 隐藏标记恢复，避免自动重复发表。恢复窗口为最新 100 条主评论及各自最新 100 条回复，极高流量场景需在 GitHub 手动确认。
- 划线以稳定块 ID、准确原文、前后文、文本位置和内容版本关联。重叠批注按区间拆分；定位失败展示原始引用，不错误高亮。
- 读者评论的编辑/删除在 GitHub 原页面操作；站内没有越权编辑、删除评论的接口。
- 后台 `/admin`：只有 `ADMIN_GITHUB_LOGINS` 中的账号可用；所有写操作校验会话、CSRF Token 和同源来源，并限流。写入 Token 只能写源码仓库的文件，从不发送到浏览器。提交基于读取时的版本，冲突时拒绝而不是覆盖。上传图片按文件内容识别类型并拒绝 SVG。`/admin` 和 `/api/` 不被搜索引擎收录。
- 浏览量：每位访客每篇每天最多计一次，按 UA 排除常见爬虫，并有每 IP 30 次/分钟的上限。D1 的 `view_marks` 只存“密钥 + IP + 文章 + 日期”的哈希，两天内过期并定时清理。
- 浏览器仅保存主题、字号、阅读位置、阅读清单和私人划线；会话中的草稿在 sessionStorage。清理浏览器数据会移除这些本地数据，不影响 GitHub 公开讨论。

## 验证状态

2.2 在 Node.js 24+ 下完成 `npm run check`：类型检查、105 项自动化测试（新增后台接口与编辑器测试：权限、CSRF、冲突、图片校验、未改动保存逐字节一致等）、完整构建和产物检查全部通过。另用无头浏览器对后台做了端到端走查（发布、带图预览、编辑、改类型、删除、站点资料与头像、暗色、手机布局），共 30 项检查通过。GitHub 在测试中由模拟服务替代。

以下为 2.0 的验证记录：

2.0 在 Node.js 24+ 下完成 `npm run check`：类型检查、81 项自动化测试（含真实 SQLite 的 Worker 测试与 JSDOM 交互测试）、完整构建、产物完整性检查和离线单文件检查全部通过。另用 Chromium 内核浏览器对 7 类页面 × 2 种皮肤 × 明暗 × 桌面/手机（共 56 张）做了截图走查，无运行时错误；首屏字体切换的布局偏移（CLS）在模拟慢字体下由 0.088 降至 0.0003。

**本交付没有你的 GitHub OAuth、仓库和 Cloudflare 账户信息，因此没有声称已经实连或上线。** 真实 API 已实现，测试替代的只是外部网络。iOS/Android 实机长按选择、线上 Core Web Vitals 与 OAuth 回调，请在正式域名部署后按根目录 `上线前核对.md` 复查。

## 官方资料

- [Workers Static Assets 配置](https://developers.cloudflare.com/workers/static-assets/binding/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [GitHub Discussions GraphQL](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions)
- [GitHub OAuth Web Application Flow / PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
