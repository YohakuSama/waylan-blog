/** Browser regression: first touch actions and oversized excerpt composer. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium, webkit } from "playwright";

const origin = "http://127.0.0.1:4184";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview",
  "--host", "127.0.0.1", "--port", "4184", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (bytes) => { log = (log + bytes).slice(-2500); });

async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error("Preview unavailable: " + log);
}

async function run(engine, label, width, height, touch) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height }, hasTouch: touch, isMobile: touch,
      reducedMotion: "reduce",
    });
    try {
      await context.addInitScript(() => {
        localStorage.setItem("echo:motion", JSON.stringify("reduced"));
        window.__copyCount = 0;
        window.__shareCount = 0;
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async () => { window.__copyCount++; },
        } });
        Object.defineProperty(navigator, "share", { configurable: true, value:
          async () => { window.__shareCount++; },
        });
        Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/status", (route) => route.fulfill({
        json: { comments: false, notifications: false },
      }));
      await page.route("**/api/session", (route) => route.fulfill({
        json: {
          user: { login: "test-reader", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
          configured: true, moderator: false, csrf: "browser-test",
        },
      }));
      await page.goto(origin + "/post/a-room-on-the-internet/", { waitUntil: "domcontentloaded" });
      await page.locator(".reader-prose .article-block[data-type='paragraph']").first().waitFor();
      // SSR markup exists before React hydrates. Prove the reader's handlers
      // are live before generating a programmatic Selection and selectionchange.
      const shareArticle = page.getByRole("group", { name: "本文操作" })
        .getByRole("button", { name: "分享文章" });
      await shareArticle.click();
      // Fine-pointer desktop uses a clipboard fallback, while touch browsers
      // use navigator.share. Either outcome confirms React hydration.
      await page.waitForFunction(() => window.__shareCount + window.__copyCount > 0,
        null, { timeout: 15000 });
      await page.evaluate(() => { window.__shareCount = 0; window.__copyCount = 0; });
      // A newly opened quick-actions menu confirms the reader controls are hydrated.
      const more = page.getByRole("group", { name: "本文操作" }).getByRole("button", { name: "展开更多操作" });
      await more.click();
      await page.getByRole("group", { name: "更多阅读操作" }).getByRole("button", { name: "复制链接" }).waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelector(".article-action-more")?.getAttribute("aria-expanded") === "false");

      const selectLongText = async () => {
        const length = await page.evaluate(() => {
          // Include contiguous text blocks only. Skipping intervening headings
          // makes a Range cross unbounded blocks and exceed the anchor limit.
          const blocks = [...document.querySelectorAll(".reader-prose .article-block[data-block-id]")];
          const start = blocks.findIndex((b) => b.dataset.type === "paragraph");
          const chosen = blocks.slice(start, start + 6);
          const length = chosen.reduce((count, b) => count + b.textContent.length, 0);
          if (chosen.length !== 6 || length < 300 || length > 3000 ||
              chosen.some((b) => b.dataset.type === "code"))
            throw Error("Expected six consecutive, selectable text blocks");
          const range = document.createRange();
          range.setStart(chosen[0], 0);
          const end = chosen[chosen.length - 1];
          range.setEnd(end, end.childNodes.length);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          return length;
        });
        await page.locator(".selection-toolbar").waitFor({ state: "visible" });
        return length;
      };
      const act = async (name) => {
        const button = page.getByRole("toolbar", { name: "选中文字的操作" })
          .getByRole("button", { name, exact: true });
        if (touch) await button.tap();
        else await button.click();
      };

      // WebKit can drop the compatibility click while releasing a native range.
      // pointerdown must retain the quote until pointerup gives permission to copy.
      await selectLongText();
      const customSelection = await page.evaluate(() => {
        const supported = !!window.CSS?.highlights && !!window.Highlight;
        return {
          supported,
          registered: !!window.CSS?.highlights?.has("waylan-selected-quote"),
          nativeRanges: window.getSelection()?.rangeCount || 0,
        };
      });
      if (touch && customSelection.supported) {
        assert.ok(customSelection.registered && customSelection.nativeRanges === 0,
          label + ": native iOS selection was not transferred to a visible custom highlight");
      }
      const copyAction = page.getByRole("toolbar", { name: "选中文字的操作" })
        .getByRole("button", { name: "复制", exact: true });
      await copyAction.dispatchEvent("pointerdown", {
        bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true, pointerId: 42,
      });
      assert.equal(await page.evaluate(() => window.__copyCount), 0,
        label + ": copy must await transient activation on pointerup");
      await copyAction.dispatchEvent("pointerup", {
        bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true, pointerId: 42,
      });
      await page.waitForFunction(() => window.__copyCount === 1);
      await copyAction.dispatchEvent("click", { bubbles: true, detail: 1 });
      await page.waitForTimeout(90);
      assert.equal(await page.evaluate(() => window.__copyCount), 1,
        label + ": compatibility click repeated an already handled press");

      // A separate real touch must execute again, not be swallowed by the
      // previous gesture's de-duplication. Share must execute exactly once.
      await act("复制");
      await page.waitForFunction(() => window.__copyCount === 2);
      await act("分享");
      await page.waitForFunction(() => window.__copyCount + window.__shareCount === 3);
      await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => window.__copyCount + window.__shareCount), 3,
        label + ": a toolbar action was swallowed or repeated");
      await act("关闭摘录工具栏");
      await page.locator(".selection-toolbar").waitFor({ state: "hidden" });

      await selectLongText();
      const oldCount = await page.locator("mark.private-mark").count();
      await act("划线");
      await page.waitForFunction((n) => document.querySelectorAll("mark.private-mark").length > n, oldCount);
      assert.equal(await page.locator(".selection-toolbar").count(), 0,
        label + ": highlight must complete on the first tap");

      const selectedLength = await selectLongText();
      await act("评论");
      const composer = page.locator("dialog.discussion-dialog.composer-dialog[open]");
      await composer.waitFor({ state: "visible" });
      await composer.locator("textarea").fill("验证长引用下的发表评论操作");
      await page.waitForTimeout(100);

      const checkGeometry = async (mode) => {
        const data = await composer.evaluate((dialog) => {
          const body = dialog.querySelector(".discussion-panel-body");
          const quote = body.querySelector(".panel-original blockquote");
          const footer = dialog.querySelector(".composer-bottom");
          const send = footer?.querySelector(".primary-button");
          const visual = window.visualViewport;
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          return {
            dialog: rect(dialog), body: rect(body), quote: rect(quote),
            footer: rect(footer), send: rect(send),
            visibleTop: visual?.offsetTop ?? 0,
            visibleBottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
            bodyOverflow: getComputedStyle(body).overflowY,
            quoteOverflow: getComputedStyle(quote).overflowY,
            quoteScrollHeight: quote.scrollHeight, quoteClientHeight: quote.clientHeight,
            bodyScrollHeight: body.scrollHeight, bodyClientHeight: body.clientHeight,
            sendEnabled: !send.disabled,
          };
        });
        assert.equal(data.bodyOverflow, "auto", label + "/" + mode + ": editor needs one scroll owner");
        assert.equal(data.quoteOverflow, "visible", label + "/" + mode + ": nested quote scrollbar");
        assert.ok(data.quoteScrollHeight <= data.quoteClientHeight + 2,
          label + "/" + mode + ": quote is internally scrolling: " + JSON.stringify(data));
        assert.ok(data.body.bottom <= data.footer.top + 2 &&
          data.send.bottom <= data.visibleBottom + 3 &&
          data.send.top >= data.visibleTop - 3 &&
          data.send.left >= -2 && data.send.right <= width + 2 &&
          data.sendEnabled,
          label + "/" + mode + ": action not visible: " + JSON.stringify(data));
        return data;
      };
      const normal = await checkGeometry("normal");
      assert.ok(normal.bodyScrollHeight >= normal.bodyClientHeight);
      if (!touch || width > 1024) {
        // Wide touch tablets preserve the compact sheet and can expand it.
        await composer.getByRole("button", { name: "进入全屏编辑" }).click();
        await page.waitForFunction(() => !!document.querySelector(".composer-dialog.composer-fullscreen"));
        await checkGeometry("fullscreen");
      }
      if (touch) {
        // Model keyboard/browser-chrome shrinking Safari's visual viewport.
        await page.evaluate(() => {
          const v = window.visualViewport;
          if (!v) throw Error("visualViewport missing");
          Object.defineProperty(v, "height", {
            configurable: true, value: Math.min(v.height, 430),
          });
          v.dispatchEvent(new Event("resize"));
        });
        await checkGeometry("keyboard");
      }
      console.log(JSON.stringify({ label, width, selectedLength, quoteScrollOwner: normal.bodyOverflow,
        sendVisible: true, actionsFirstTouch: true }));
      assert.deepEqual(errors, [], label + ": runtime errors");
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await ready();
  await run(chromium, "desktop Chromium", 1440, 900, false);
  await run(webkit, "phone WebKit", 390, 760, true);
  await run(webkit, "tablet WebKit", 820, 900, true);
  await run(webkit, "landscape tablet WebKit", 1194, 834, true);
} finally {
  server.kill("SIGTERM");
  server.stdout.destroy();
  server.stderr.destroy();
}
