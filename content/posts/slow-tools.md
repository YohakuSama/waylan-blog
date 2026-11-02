---
id: echo-005
slug: slow-tools
title: 好工具，应该允许人慢一点：评论框的草稿保存与离开保护
excerpt: 读者写一条评论，中途去登录、切换标签页或误触返回，文字都不应该丢。记录评论框里草稿持久化与离开保护的实现细节。
date: 2026-10-16
topic: dev
tags: [交互设计, 表单, 状态持久化]
cover: /art/tools.svg
coverAlt: 静物般摆放的一支笔、一张纸和一个圆形计时器（示意插图）
---
<!-- block:opening -->
写评论是一件需要停顿的事。读者可能写了两句，去查一个链接；也可能写完才发现还没登录，跳转到 GitHub 授权后再回来。如果回来时输入框是空的，大多数人不会再写第二遍。

<!-- block:h-friction -->
## 两种不同的阻力

<!-- block:friction -->
一种阻力来自工具：保存状态不明确，跳转后丢失输入，错误提示不说明原因。这些应该被彻底消除。另一种阻力来自思考：还没想好怎么表达，需要删掉重写。这种慢不是缺陷，工具要做的是容纳它，而不是催促它。

<!-- block:h-persist -->
## 草稿持久化

<!-- block:persist -->
评论框的内容在输入时做防抖保存，以文章 id 为键写入 `localStorage`。几个细节：

<!-- block:persist-list -->
- **键要包含作用域**：至少包含文章 id；如果是针对某段文字的批注，还要包含锚点信息，否则两处输入会互相覆盖。
- **空内容要删除**：用户清空输入框，就应该同时清除存储，避免下次打开时“复活”已放弃的内容。
- **写入可能失败**：隐私模式或存储配额已满时 `setItem` 会抛出异常，必须捕获并明确提示，而不是静默丢失。
- **提交成功后清理**：只在服务端确认成功之后才删除本地内容。

<!-- block:persist-code -->
```ts
const keyOf = (postId: string) => `draft:${postId}`;

export function saveDraft(postId: string, body: string): boolean {
  try {
    if (body.trim()) {
      localStorage.setItem(keyOf(postId), JSON.stringify({ body, savedAt: Date.now() }));
    } else {
      localStorage.removeItem(keyOf(postId));
    }
    return true;
  } catch {
    return false; // 由调用方显示“本次输入无法在本机保存”
  }
}

export function loadDraft(postId: string): string {
  try {
    const raw = localStorage.getItem(keyOf(postId));
    return raw ? (JSON.parse(raw) as { body: string }).body : "";
  } catch {
    return "";
  }
}
```

<!-- block:h-leave -->
## 离开保护

<!-- block:leave -->
`beforeunload` 可以在用户关闭或离开页面时弹出浏览器的确认框，但它有代价：注册了这个监听的页面在部分浏览器中无法进入往返缓存（bfcache）。所以只在确实有未保存内容时才注册，内容保存或提交后立即移除。

<!-- block:leave-code -->
```ts
export function guardUnload(isDirty: () => boolean): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = ""; // 兼容仍要求设置 returnValue 的浏览器
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}
```

<!-- block:leave-note -->
移动端浏览器在后台可能直接结束页面而不触发 `beforeunload`。因此真正可靠的保存时机是 `visibilitychange`：页面变为 `hidden` 时立刻写入一次，不等防抖计时器。

<!-- block:quote -->
> 工具可以很快，但它不应该要求使用它的人永远很快。

<!-- block:h-login -->
## 登录跳转

<!-- block:login -->
OAuth 登录会离开当前页面。跳转前，除了保存输入内容，还要记录返回地址和当前选中的原文引用；回到页面后先恢复这些状态，再打开评论框。读者感知到的应该是“登录了一下”，而不是“重新开始”。

<!-- block:closing -->
这些细节都不显眼，做好了也没人会注意到。但它们决定了读者是否敢在这里慢慢写。关于界面状态的另一部分约定，见[设计 token 的三层结构](/post/design-tokens-theming)。

<!-- block:refs -->
参考：[MDN · beforeunload 事件](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) · [MDN · visibilitychange 事件](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) · [web.dev · Back/forward cache](https://web.dev/articles/bfcache)
