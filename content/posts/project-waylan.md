---
id: echo-014
slug: project-waylan
type: project
title: Waylan 技术博客
excerpt: 你正在浏览的这个网站。静态预渲染的 React 应用，部署在 Cloudflare Workers 上，支持私人划线、段落级批注，以及基于 GitHub Discussions 的公开讨论。
date: 2026-10-27
topic: dev
tags: [React, Cloudflare, 开源工具]
status: 持续迭代
stack: [React, TypeScript, Vite, Cloudflare Workers, D1]
---
<!-- block:what -->
Waylan 是一个内容优先的技术博客工程。页面在构建时预渲染为静态 HTML，不执行脚本也能阅读正文；登录、评论和批注由同一个 Worker 提供的 API 处理。

<!-- block:features -->
## 已经实现

<!-- block:list -->
- 文章、技术笔记、观点、开发日志与项目的统一信息流，支持按类型、主题和标签筛选
- 阅读目录、阅读进度、字号调整与私人划线
- 基于块标识与原文引用的段落级批注，改稿后自动重新定位
- 代码块高亮与一键复制，尊重“减少动态效果”的系统偏好
- 单文件离线预览，无需服务器即可打开

<!-- block:next -->
## 接下来

<!-- block:next-text -->
计划补充全文搜索的分词与 RSS 全文输出。仓库与演示地址尚未公开，因此这里暂不提供链接。
