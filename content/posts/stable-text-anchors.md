---
id: echo-004
slug: stable-text-anchors
title: 读 Web Annotation 数据模型：文本锚点如何在改稿后存活
excerpt: 一条批注指向的是“某几个字”，而文章会被修改。精读 W3C Web Annotation 的选择器设计，并记录我在实现中采用的定位顺序与失败策略。
date: 2026-10-20
topic: notes
tags: [W3C, 批注, 规范精读, TypeScript]
cover: /art/margin.svg
coverAlt: 展开的纸页与页边一条细细的绿色批注线（示意插图）
---
<!-- block:opening -->
给文章加划线和批注时，最难的部分不是界面，而是“指向”。一条批注要记住它针对的是哪几个字，而文章在发布之后仍然会被修改：错别字被订正，段落被拆分，例子被替换。锚点如果只记录字符位置，改一个字就会整体错位。

<!-- block:spec -->
W3C 的 Web Annotation 数据模型早就讨论过这个问题。它没有给出一种“完美”的定位方式，而是提供了几种可以组合的选择器（Selector），让实现者在精确与健壮之间自行权衡。

<!-- block:h-selectors -->
## 两种互补的选择器

<!-- block:selectors-list -->
- **TextPositionSelector**：记录 `start` 和 `end` 两个字符偏移。定位快、无歧义，但对任何前置修改都很脆弱。
- **TextQuoteSelector**：记录被选中的原文 `exact`，以及紧邻的前缀 `prefix` 和后缀 `suffix`。文本前后插入内容也能找回，但同一句话出现多次时需要靠前后文消歧。

<!-- block:selectors-note -->
规范允许一个目标同时携带多个选择器。我的做法是两者都存：位置用于快速路径，原文和前后文用于校验与恢复。此外再加一层本站特有的信息：段落的块标识。块标识在改稿时通常保持不变，可以把搜索范围从整篇文章缩小到一个段落。

<!-- block:h-order -->
## 定位顺序

<!-- block:order-list -->
1. 在原块标识对应的段落里，按记录的偏移取出文字，与 `exact` 比较。相同则直接命中。
2. 不同则在全文所有段落中搜索 `exact`，用 `prefix` 或 `suffix` 校验每一个候选位置。
3. 恰好只有一个候选通过校验时，迁移到新位置；零个或多个候选时，判定为无法定位。

<!-- block:order-code -->
```ts
interface Quote {
  exact: string;
  prefix: string;
  suffix: string;
}
interface Anchor {
  blockId: string;
  start: number;
  end: number;
  quote: Quote;
}
type Located = { blockId: string; start: number; end: number };

export function locate(blocks: { id: string; text: string }[], a: Anchor): Located | null {
  const same = blocks.find((b) => b.id === a.blockId);
  if (same && same.text.slice(a.start, a.end) === a.quote.exact) {
    return { blockId: same.id, start: a.start, end: a.end };
  }
  const hits: Located[] = [];
  for (const b of blocks) {
    for (let i = b.text.indexOf(a.quote.exact); i !== -1; i = b.text.indexOf(a.quote.exact, i + 1)) {
      const end = i + a.quote.exact.length;
      const before = b.text.slice(Math.max(0, i - a.quote.prefix.length), i);
      const after = b.text.slice(end, end + a.quote.suffix.length);
      if (before === a.quote.prefix || after === a.quote.suffix) hits.push({ blockId: b.id, start: i, end });
    }
  }
  return hits.length === 1 ? hits[0] : null;
}
```

<!-- block:h-fail -->
## 找不到时，承认找不到

<!-- block:fail -->
很多实现会在第三步引入模糊匹配：计算编辑距离，把批注贴到“最像”的那句话上。我刻意没有这样做。批注是读者对某段具体文字的回应，如果那段文字已经被改写，把它挂到一句相似但含义不同的话上，比直接显示“原文已变化”更具误导性。

<!-- block:quote -->
> 锚点失效是正常的；锚点悄悄指错，才是缺陷。

<!-- block:fail-ui -->
因此，无法定位的批注不会被丢弃，而是保留原文引用，集中显示在文章末尾，并注明它对应的是旧版本。作者也可以借此看到哪些修改影响了已有讨论。

<!-- block:h-version -->
## 版本号的作用

<!-- block:version -->
每篇文章在构建时计算一个内容哈希作为版本号，批注提交时一并记录。版本相同则可以完全信任偏移量，跳过搜索；版本不同才进入上面的恢复流程。这让绝大多数读取都走快速路径，只有改稿后的第一次读取需要重新定位。

<!-- block:closing -->
读规范最大的收获，是它把问题拆清楚了：“指向哪里”和“如何找回”是两件事，前者需要冗余信息，后者需要明确的失败语义。这个设计后来落成了[页边回声](/post/project-margin-echo)。

<!-- block:refs -->
参考：[W3C · Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) · [W3C · Selectors and States](https://www.w3.org/TR/selectors-states/) · [MDN · Range](https://developer.mozilla.org/en-US/docs/Web/API/Range)
