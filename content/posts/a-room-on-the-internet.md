---
id: echo-001
slug: a-room-on-the-internet
title: 静态优先：内容站的预渲染、水合与边缘 API
excerpt: 正文在构建时渲染成完整 HTML，交互在水合后接管，登录与评论交给同一个 Worker。记录这个博客的架构取舍，以及为水合一致性处理的那些细节。
date: 2026-10-31
topic: dev
tags: [架构, 预渲染, React, Cloudflare]
cover: /art/room.svg
coverAlt: 苔绿色背景中的一扇拱形窗与一页纸（示意插图）
featured: true
---
<!-- block:opening -->
这个博客的每一篇文章都在构建时渲染成完整的 HTML。浏览器即使没有执行任何脚本，读者也能看到标题、正文和代码；脚本加载完成后，React 再接管页面，补上筛选、划线和评论这些交互。这篇文章记录这种“静态优先”架构背后的几个取舍。

<!-- block:h-why -->
## 为什么不是纯客户端渲染

<!-- block:why -->
内容站最重要的是正文本身。纯客户端渲染意味着首屏要等 JavaScript 下载、解析、执行之后才有内容，搜索引擎、RSS 阅读器和网络较差的读者都要为此付出代价。而请求时的服务端渲染又需要持续运行的计算资源，对一个以阅读为主、内容按天更新的站点来说并不划算。

<!-- block:choice -->
折中的方案是构建期预渲染：内容在构建时就确定，每个 URL 对应一份完整的 HTML 文件，作为静态资源部署到边缘节点。真正需要服务端参与的只有少数动态能力，它们以 API 的形式单独存在。

<!-- block:h-split -->
## 静态与动态的边界

<!-- block:split-list -->
- **静态部分**：文章、目录、归档、RSS 与 Sitemap，全部在 `npm run build` 时生成。
- **客户端状态**：主题、字号、列表密度和私人划线，只保存在读者本地。
- **服务端能力**：GitHub 登录、发表评论、公开批注，必须经过 Worker 校验，不能信任浏览器提交的任何身份信息。

<!-- block:split-note -->
这条边界同时决定了安全模型：静态文件可以被任意缓存和复制，因此不能包含任何需要保密的内容；所有写操作都由 Worker 处理，并在数据库层面加上约束。

<!-- block:h-hydration -->
## 水合一致性

<!-- block:hydration -->
水合（hydration）要求客户端第一次渲染的结果与预渲染的 HTML 一致。一旦不一致，React 会报告错误，并在受影响的范围内回退为客户端重新渲染，首屏的收益随之打折。实践中，不一致几乎都来自同一类问题：渲染过程读取了只在浏览器中存在、或在两端取值不同的数据。

<!-- block:hydration-list -->
1. **本地存储**：在渲染函数里读取 `localStorage`，构建时根本拿不到值。
2. **时间与时区**：`new Date()` 和不带 `timeZone` 的 `Intl.DateTimeFormat`，在构建机和读者设备上可能得到不同的日期。
3. **媒体查询**：`matchMedia` 在预渲染环境中不存在。

<!-- block:hydration-fix -->
处理原则只有一条：首次渲染只使用两端都确定的数据，读者的本地偏好在水合之后再应用。

<!-- block:hydration-code -->
```tsx
import { useEffect, useState } from "react";

type Density = "full" | "compact";

export function useDensity() {
  // 首次渲染使用与预渲染一致的默认值
  const [density, setDensity] = useState<Density>("full");
  useEffect(() => {
    // 水合完成后再读取本地偏好
    if (localStorage.getItem("density") === "compact") setDensity("compact");
  }, []);
  return [density, setDensity] as const;
}
```

<!-- block:dates -->
日期格式化则固定时区。本站统一使用 `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Taipei" })`，保证构建机与任何读者看到的都是同一天。

<!-- block:quote -->
> 预渲染输出的是一份承诺：脚本加载前后，读者看到的应该是同一个页面。

<!-- block:h-ids -->
## 稳定的标识

<!-- block:ids -->
评论和批注需要指向具体的文章与段落，所以每篇文章有一个不会改变的 `id`，正文中的每个段落也有显式的块标识。slug 可以为了可读性调整，id 不行；段落内容可以改写，块标识尽量保持。这样即使文章修订，已有的讨论也能找回原来的位置。关于如何在改稿后重新定位一段引用，可以接着读[文本锚点如何在改稿后存活](/post/stable-text-anchors)。

<!-- block:h-cost -->
## 代价

<!-- block:cost -->
静态优先并非没有成本。每次修改内容都需要重新构建和部署；所有依赖浏览器环境的功能都必须写成“水合后增强”；预渲染脚本本身也需要测试覆盖。对一个更新频率以天计的个人博客来说，这些代价是可以接受的。

<!-- block:refs -->
参考：[web.dev · Rendering on the Web](https://web.dev/articles/rendering-on-the-web) · [React · hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot) · [Cloudflare · Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
