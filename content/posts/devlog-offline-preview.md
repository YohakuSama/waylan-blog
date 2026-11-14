---
id: echo-013
slug: devlog-offline-preview
type: journal
title: 开发日志：单文件离线预览
excerpt: 为了让人不装任何依赖就能看到网站效果，这周做了一个可以直接双击打开的单文件 HTML 预览。
date: 2026-09-14
topic: dev
tags: [开发日志, 构建, Vite]
---
<!-- block:text -->
为了让人不安装任何依赖就能看到网站效果，这周做了一个可以直接双击打开的单文件预览。脚本、样式、字体和配图全部内联进一个 HTML 文件，不依赖网络。

<!-- block:cmd -->
```bash
$ npm run build
$ npm run build:preview
```

<!-- block:details -->
- `file://` 下没有服务端路由，改用 `#/post/...` 形式的 fragment 路由。
- 图片转成 data URI 内联；体积变大，但这个文件只用于本地预览，不参与正式部署。
- 部分浏览器在 `file://` 下禁止使用 `localStorage`，此时退回内存存储，并在页面上明确提示“划线只保留到本次阅读”。
- 评论与登录在预览中显示为未连接，不模拟任何数据。
