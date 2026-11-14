---
id: echo-008
slug: use-reduced-motion
type: note
title: 读取“减少动态效果”偏好：一个函数和一个 Hook
excerpt: 系统设置里的“减少动态效果”是读者明确表达过的偏好。动画开始之前先确认是否允许，并且在预渲染时给出确定的默认值。
date: 2026-10-13
topic: dev
tags: [可访问性, TypeScript, React, 动效]
---
<!-- block:intro -->
本站允许读者在站内覆盖系统的动效偏好，所以判断分两步：站内有明确选择时以站内为准，否则跟随系统设置。

<!-- block:code -->
```ts
export type MotionChoice = "system" | "full" | "reduced";

export function motionAllowed(choice: MotionChoice): boolean {
  if (choice !== "system") return choice === "full";
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}
```

<!-- block:hook-intro -->
在 React 组件里，系统偏好可能在页面打开期间改变。用 `useSyncExternalStore` 订阅媒体查询，并为预渲染提供一个确定的快照：

<!-- block:hook-code -->
```tsx
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mql = matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(QUERY).matches,
    () => false, // 预渲染与水合阶段使用固定值，水合后再读取真实偏好
  );
}
```

<!-- block:note -->
减少动效不等于取消反馈。按钮状态、焦点位置和加载提示仍然需要清楚可见，只是不再依赖位移和缩放来表达；淡入淡出这类不涉及运动的过渡通常可以保留。

<!-- block:refs -->
参考：[MDN · prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) · [React · useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) · [WCAG 2.2 · Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
