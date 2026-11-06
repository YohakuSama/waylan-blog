---
id: echo-015
slug: project-margin-echo
type: project
title: 页边回声：可重新定位的文本批注
excerpt: 把一段讨论锚定在原文的某几个字上。文章修改之后，按块标识、原文与前后文依次找回位置；找不到时明确标记，而不是悄悄贴错。
date: 2026-10-08
topic: dev
tags: [批注, Web Annotation]
status: 实验中
stack: [TypeScript, W3C Web Annotation, Cloudflare D1, GitHub Discussions]
---
<!-- block:what -->
每条批注同时记录块标识、字符偏移、原文片段及其前后文，数据结构参考 W3C Web Annotation 的 TextQuoteSelector 与 TextPositionSelector。文章更新后先按偏移校验，失败时再搜索原文；仍无法唯一定位的批注会标记为“原文已变化”，保留原始引用，不会被丢弃。

<!-- block:design -->
设计过程与定位算法记录在[文本锚点如何在改稿后存活](/post/stable-text-anchors)。

<!-- block:status -->
目前作为 Waylan 阅读器的一部分，只在本站使用。
