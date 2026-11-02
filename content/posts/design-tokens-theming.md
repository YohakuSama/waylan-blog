---
id: echo-002
slug: design-tokens-theming
title: 设计 token 的三层结构：让多主题不再是第二套样式
excerpt: 深色模式之所以难维护，往往是因为颜色直接写在了组件里。把 token 分成原始值、语义与组件三层，主题切换就只是换一组映射。
date: 2026-10-28
topic: dev
tags: [设计系统, CSS, 主题]
cover: /art/balance.svg
coverAlt: 米白色纸面上的几何线条与一枚绿色圆点（示意插图）
---
<!-- block:opening -->
给一个已有的站点加深色模式，最常见的做法是复制一份样式，再逐个覆盖颜色。这种做法第一周很快，之后每加一个组件都要维护两份规则，迟早会有遗漏。问题的根源在于：组件直接引用了具体的颜色值，而不是引用颜色的用途。

<!-- block:h-layers -->
## 三层 token

<!-- block:layers -->
我现在把设计 token 分成三层，每一层只引用上一层：

<!-- block:layers-list -->
1. **原始值（primitive）**：调色板本身，例如 `--green-600`、`--sand-50`。它们只描述“是什么颜色”，不描述用途，也不随主题变化。
2. **语义（semantic）**：描述用途，例如 `--color-text`、`--color-surface`、`--color-accent`。主题切换只发生在这一层。
3. **组件（component）**：只在确有必要时出现，例如 `--button-bg`。它引用语义 token，让组件可以局部调整而不破坏全局约定。

<!-- block:layers-note -->
组件样式只允许使用语义或组件 token。代码评审时，一旦看到组件里出现原始色值或十六进制颜色，就说明分层被绕过了。

<!-- block:h-css -->
## 用 CSS 自定义属性实现

<!-- block:css-intro -->
CSS 自定义属性会沿 DOM 继承，并且可以在运行时改变，天然适合承载语义层：

<!-- block:css-code -->
```css
:root {
  --green-600: #3f6b4f;
  --green-300: #8fb59a;
  --sand-50: #faf8f3;
  --ink-900: #1d1f1c;
  --ink-100: #e8e6df;

  --color-surface: var(--sand-50);
  --color-text: var(--ink-900);
  --color-accent: var(--green-600);
  color-scheme: light;
}

:root[data-theme="dark"] {
  --color-surface: var(--ink-900);
  --color-text: var(--ink-100);
  --color-accent: var(--green-300);
  color-scheme: dark;
}

.button-primary {
  background: var(--color-accent);
  color: var(--color-surface);
}
```

<!-- block:color-scheme -->
`color-scheme` 值得单独一提：它告诉浏览器当前页面的配色倾向，表单控件、滚动条这类由浏览器绘制的部分会随之切换，不需要我们逐个覆盖。

<!-- block:h-flash -->
## 避免首屏闪烁

<!-- block:flash -->
如果主题偏好存放在 `localStorage`，而读取发生在应用脚本里，深色模式的读者会先看到一帧浅色页面。解决办法是在 `<head>` 中放一段很小的同步脚本，在首次绘制之前写好 `data-theme`：

<!-- block:flash-code -->
```js
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    // 某些隐私模式或 file:// 环境下不可用，退回系统偏好
  }
  const dark = stored
    ? stored === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
```

<!-- block:flash-note -->
这段脚本会阻塞解析，所以要保持足够短，并且不依赖任何模块。对静态预渲染的站点来说，它还意味着 `<html>` 上的属性会在水合前被修改，需要确认框架不会因此报告不一致。

<!-- block:quote -->
> 主题不是第二套样式，而是同一套语义的另一组取值。

<!-- block:h-check -->
## 检查清单

<!-- block:table -->
| 检查项 | 做法 |
| --- | --- |
| 组件不出现原始色值 | 用 Stylelint 规则或简单的 grep 在 CI 中拦截 |
| 两套主题的对比度 | 对语义 token 组合逐对检查，而不是逐个页面检查 |
| 浏览器绘制的控件 | 通过 `color-scheme` 跟随主题 |
| 首屏主题 | 同步脚本在首次绘制前写入 `data-theme` |

<!-- block:closing -->
分层的收益在第三个主题出现时最明显：高对比度主题只需要再定义一组语义映射，组件代码一行都不用改。相关的动效偏好处理，见[读取“减少动态效果”偏好](/post/use-reduced-motion)。

<!-- block:refs -->
参考：[MDN · 使用 CSS 自定义属性](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) · [MDN · prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) · [MDN · color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme) · [W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/)
