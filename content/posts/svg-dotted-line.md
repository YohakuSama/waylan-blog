---
id: echo-007
slug: svg-dotted-line
type: note
title: 用 stroke-dasharray 把一条 SVG 路径变成点阵
excerpt: 不需要 Canvas，也不需要额外的图片。把虚线的线段长度设为接近零，再配合圆形端点，一条 SVG 路径就会变成一串均匀的圆点。
date: 2026-10-29
topic: dev
tags: [SVG, CSS, 前端]
---
<!-- block:idea -->
首页的网络图形只用了普通的 SVG 路径。关键在于三个属性：虚线的线段长度接近零、间隔固定、端点为圆形。每个“线段”被圆形端点撑开成一个直径等于 `stroke-width` 的圆点。

<!-- block:code -->
```css
.network path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-dasharray: 0.1 7;
}
```

<!-- block:why -->
这样做体积小、可以无损缩放，还能通过 `currentColor` 继承文字颜色。切换深色主题时只需要改变语义颜色 token，不必准备第二张图片。

<!-- block:zero -->
线段长度用 `0.1` 而不是 `0`：规范要求零长度线段在圆形端点下也要绘制，但不同渲染器的处理并不完全一致，留一点长度更稳妥。

<!-- block:caveat -->
> 路径越多、点越密，绘制开销越高。几十条路径在桌面浏览器里没有压力，但不应该为了装饰无限加密。

<!-- block:refs -->
参考：[MDN · stroke-dasharray](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dasharray) · [MDN · stroke-linecap](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-linecap)
