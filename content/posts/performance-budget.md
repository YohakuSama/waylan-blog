---
id: echo-006
slug: performance-budget
title: 前端性能预算：把“别变慢”写成构建门禁
excerpt: 性能很少在某一次提交里突然变差，而是在几十次“只多了几 KB”之后。给资源体积设定预算，并让 CI 在超出时失败，是我目前最有效的做法。
date: 2026-10-10
topic: dev
tags: [性能, CI, Core Web Vitals]
cover: /art/garden.svg
coverAlt: 网格纸上，几条细线连接着不同形状的叶片（示意插图）
---
<!-- block:opening -->
性能退化很少来自某一次明显的错误提交。更常见的情况是：引入一个日期库多了十几 KB，加一个图标集又多了一些，每次评审都觉得“这点体积可以接受”。几个月后再测，首屏已经慢了一截，却找不到具体是哪一次改动造成的。

<!-- block:idea -->
性能预算的思路是把“别变慢”从一种意愿变成一条可以被机器检查的规则：事先约定上限，超出时构建失败，由提交者解释原因或者优化。

<!-- block:h-kinds -->
## 预算的两类指标

<!-- block:kinds-list -->
- **资源体积**：JavaScript、CSS、字体和图片在压缩后的字节数。它与用户体验是间接关系，但在构建时就能精确测量，适合做门禁。
- **用户体验指标**：Core Web Vitals 中的 LCP、INP 和 CLS。web.dev 给出的“良好”阈值分别是 2.5 秒、200 毫秒和 0.1，以第 75 百分位的真实用户数据为准。

<!-- block:kinds-note -->
体验指标才是最终目标，但它依赖真实设备和网络，波动较大，不适合在每次提交时作为硬性门槛。我的做法是：体积预算放进 CI，体验指标通过线上采集持续观察，两者互相印证。

<!-- block:h-script -->
## 一个最小的体积检查

<!-- block:script-intro -->
不需要引入额外工具，Node 自带的 `zlib` 就能计算 gzip 后的体积。下面的脚本读取构建产物，按扩展名汇总，超出预算时以非零状态码退出：

<!-- block:script-code -->
```js
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const dir = "dist/assets";
const budgets = { ".js": 150 * 1024, ".css": 30 * 1024 };
const totals = { ".js": 0, ".css": 0 };

for (const file of readdirSync(dir)) {
  const ext = extname(file);
  if (ext in totals) totals[ext] += gzipSync(readFileSync(join(dir, file))).length;
}

let failed = false;
for (const [ext, limit] of Object.entries(budgets)) {
  const used = totals[ext];
  console.log(`${ext.padEnd(5)} ${(used / 1024).toFixed(1)} / ${limit / 1024} KiB (gzip)`);
  if (used > limit) failed = true;
}
process.exit(failed ? 1 : 0);
```

<!-- block:script-run -->
```bash
$ npm run build
$ node scripts/budget.mjs
```

<!-- block:script-note -->
示例中的数字只是起点，不是推荐值。合理的做法是先测出当前体积，在此基础上留一点余量作为预算，之后只允许经过讨论的上调。

<!-- block:h-rules -->
## 让预算可以执行

<!-- block:rules-list -->
1. **预算跟着页面类型走**：文章页和需要编辑器的页面，承载的功能不同，不应共用一个数字。
2. **超出时给出明细**：只报告“超了 8 KB”没有用，要能看到是哪个入口、哪个依赖变大了。
3. **上调需要理由**：允许上调预算，但要写在提交说明里，让这个决定可以被追溯。
4. **定期回看**：每过一段时间检查一次余量，体积下降时顺手把预算收紧。

<!-- block:quote -->
> 预算真正约束的不是代码，而是“这点体积可以接受”这句话。

<!-- block:h-limits -->
## 预算解决不了的问题

<!-- block:limits -->
体积预算无法发现长任务阻塞主线程、布局抖动或者首屏图片没有设置尺寸这类问题，它们需要 Lighthouse 这样的实验室工具和线上数据来发现。预算只是最便宜的一道防线：它不保证页面一定快，但能保证页面不会在无人察觉的情况下慢下去。这也是我在[静态优先的架构](/post/a-room-on-the-internet)里尽量把交互写成渐进增强的原因之一。

<!-- block:refs -->
参考：[web.dev · Performance budgets 101](https://web.dev/articles/performance-budgets-101) · [web.dev · Web Vitals](https://web.dev/articles/vitals) · [web.dev · Interaction to Next Paint](https://web.dev/articles/inp)
