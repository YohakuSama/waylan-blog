/** Reproduce reader-state regressions without editing production content. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const origin="http://127.0.0.1:4181", dir="reader-audit-report";
await mkdir(dir,{recursive:true});
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","4181","--strictPort"],{stdio:["ignore","pipe","pipe"]});
let serverLog="";
for(const stream of [server.stdout,server.stderr])stream.on("data",chunk=>{serverLog=(serverLog+chunk).slice(-2500)});
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,150))}throw Error("Preview cannot start: "+serverLog)}
const observations=[];
async function run(engine,name,width){
  const browser=await engine.launch({headless:true});
  try{
    const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:"no-preference",hasTouch:width>1024&&width<=1366});
    try{
      await ctx.addInitScript(()=>{localStorage.setItem("echo:motion",JSON.stringify("full"));localStorage.setItem("echo:skin",JSON.stringify("editorial"));localStorage.setItem("echo:theme",JSON.stringify("light"))});
      const page=await ctx.newPage();
      const errors=[];page.on("pageerror",e=>errors.push(String(e)));
      await page.route("**/api/status",route=>route.fulfill({json:{comments:false,notifications:false}}));
      await page.route("**/api/session",route=>route.fulfill({json:{user:null}}));
      if (width <= 600) {
        await page.goto(origin+"/",{waitUntil:"domcontentloaded"});
        await page.locator(".hero-browse").waitFor();
        await page.evaluate(() => {
          window.__routeMotionAudit = [];
          const start = document.startViewTransition?.bind(document);
          if (!start) return;
          const capture = () => [...document.querySelectorAll(
            ".feed-item .feed-body h2, .feed-item .feed-media",
          )].map(el => getComputedStyle(el).viewTransitionName);
          document.startViewTransition = update => {
            const kind = document.documentElement.dataset.routeMotion || "";
            const before = capture();
            const modalOpen = !!document.querySelector("dialog.search-dialog[open]");
            return start(() => {
              const result = update();
              window.__routeMotionAudit.push({kind,before,after:capture(),modalOpen});
              return result;
            });
          };
        });
        const route = async (selector, expected) => {
          await page.locator(selector).first().click();
          await page.waitForURL(url => (url.pathname.replace(/\/$/,"") || "/") === expected);
          await page.waitForTimeout(440);
        };
        await route(".hero-browse","/feed");           // home → content
        await route('#site-nav a[href="/projects"]',"/projects");
        await route('#site-nav a[href="/feed"]',"/feed");
        await route('#site-nav a[href="/"]',"/");      // content → home
        await route('#site-nav a[href="/projects"]',"/projects"); // home → projects
        await route('#site-nav a[href="/"]',"/");
        await page.locator(".header-search").click();
        await page.locator('.search-dialog input[type="search"]').fill("D1");
        await page.locator(".search-dialog .search-option").first().click();
        await page.waitForURL(/\/post\/[^/]+/);
        await page.waitForTimeout(440);
        const audit = await page.evaluate(() => window.__routeMotionAudit);
        observations.push({browser:name,width,scenario:"collection motion paths and search-close ordering",audit});
        assert.deepEqual(audit, [],
          "No cross-route startViewTransition snapshots: avoid overlapped text/cover frames in iOS Safari");
        assert.equal(await page.locator("dialog.search-dialog[open]").count(), 0,
          "Search dialog must be fully dismissed before the article is shown");
        assert.ok(await page.locator(".reader-prose").count() > 0,
          "Search result must still navigate successfully without native View Transitions");
        await page.screenshot({path:dir+"/"+name+"-"+width+"-search-to-article.png",animations:"disabled"});
      }
      await page.goto(origin+"/feed/",{waitUntil:"domcontentloaded"});
      await page.locator(".post-card-link").first().click();
      await page.waitForURL(/\/post\/[^/?]+$/,{timeout:12000});
      const first=new URL(page.url()).pathname;
      const neighbor=page.locator('.article-neighbors a[href^="/post/"]').first();
      const secondHref=await neighbor.getAttribute("href");
      assert.ok(secondHref&&secondHref!==first, "Need a different neighbor post");
      await neighbor.click();
      await page.waitForURL(url=>url.pathname===secondHref,{timeout:12000});
      await page.locator(".reader-prose").waitFor();
      const historyBefore=await page.evaluate(()=>history.length);
      await page.locator(".reader-topbar > button").first().click();
      await page.waitForTimeout(400);
      const returned=new URL(page.url()).pathname;
      const canonical=returned.replace(/\/$/,"");
      observations.push({browser:name,width,scenario:"feed → article A → neighbor article B → button 返回列表",first,second:secondHref,returned,canonical,historyBefore,expected:"/feed",defect:canonical!=="/feed"});
      await page.screenshot({path:dir+"/"+name+"-"+width+"-return.png",animations:"disabled"});

      // Use a genuine client-side article navigation; WebKit can stall a
      // second document-level navigation during a just-finished View Transition.
      // Settings remain available on browsing pages; an immersive article
      // intentionally replaces the global header with a single reader row.
      await page.waitForTimeout(650);
      await page.getByRole("button",{name:"阅读设置",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"阅读设置",exact:true});
      await dialog.waitFor({state:"visible"});
      const radio=dialog.locator('.segmented input[value="dark"]');
      await radio.check();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      const sampled=await page.evaluate(()=>{const box=document.querySelector(".settings-dialog .segmented");const labels=[...box.querySelectorAll("label")];return {chosen:labels.findIndex(el=>el.classList.contains("selected")),thumb: getComputedStyle(box,"::before").transform,colors:labels.map(el=>getComputedStyle(el).color),motion:document.documentElement.dataset.motion}});
      await page.waitForTimeout(80);
      const intermediate=await page.evaluate(()=>{const box=document.querySelector(".settings-dialog .segmented");return {thumb:getComputedStyle(box,"::before").transform,colors:[...box.querySelectorAll("label")].map(el=>getComputedStyle(el).color)}});
      await page.screenshot({path:dir+"/"+name+"-"+width+"-theme-mid.png"});
      await page.waitForTimeout(750);
      const settled=await page.evaluate(()=>{const box=document.querySelector(".settings-dialog .segmented");return {theme:document.documentElement.dataset.theme,thumb:getComputedStyle(box,"::before").transform,thumbContent:getComputedStyle(box,"::before").content,labels:[...box.querySelectorAll("label")].map(el=>({text:el.textContent,selected:el.classList.contains("selected"),background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})),activeBackground:getComputedStyle(box.querySelector("label.selected")).backgroundColor}});
      await page.screenshot({path:dir+"/"+name+"-"+width+"-theme-settled.png"});
      observations.push({browser:name,width,scenario:"article reading → reading settings → light-to-dark theme segment",sampled,intermediate,settled});
      assert.equal(settled.thumbContent,"none", "the selected background must stay attached to its label, not lag behind on a separate animated thumb");
      assert.notEqual(settled.activeBackground,"rgba(0, 0, 0, 0)", "selected label must show a real background");
      // End-to-end TOC regression: the original report was a jump from
      // "水合一致性" into the later "稳定的标识" section. DOM-only
      // title/ID checks cannot catch a bad physical scroll landing.
      await page.goto(origin+"/post/a-room-on-the-internet/",{waitUntil:"domcontentloaded"});
      await page.locator('.reader-prose [data-block-id="h-hydration"]').waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const isReaderHeaderShown=await page.locator(".site-header").isVisible();
      if(width<=1024) {
        assert.equal(isReaderHeaderShown,true,"phone/tablet readers must preserve the Waylan logo masthead");
        assert.equal(await page.locator(".site-header-reader .brand-wordmark").isVisible(),true,
          "editorial Waylan logo was lost in immersive reading");
        assert.equal(await page.locator(".site-header-reader #site-nav").isVisible(),false,
          "mobile article must not duplicate the full destination row");
        const compact=await page.evaluate(()=>{
          const bar=document.querySelector(".reader-topbar");
          return {position:getComputedStyle(bar).position,top:getComputedStyle(bar).top,
            controls:bar.querySelectorAll(".reader-controls button").length,
            height:bar.getBoundingClientRect().height};
        });
        assert.equal(compact.position,"sticky");
        assert.equal(compact.top,"56px");
        assert.ok(compact.height<=60,"reader row is taller than 60px: "+JSON.stringify(compact));
        // Start at the top and use user-like wheel scrolling; a single
        // programmatic scrollTo can be a no-op when history restores position.
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.waitForFunction(()=>window.scrollY<10);
        await page.mouse.move(100,420);
        await page.mouse.wheel(0,320);
        await page.mouse.wheel(0,320);
        try {
          await page.waitForFunction(()=>document.querySelector(".reader-topbar.reader-topbar-hidden"),null,{timeout:6000});
        } catch {
          const state=await page.evaluate(()=>({y:window.scrollY,match:matchMedia("(max-width: 1024px)").matches,
            hidden:document.querySelector(".reader-topbar")?.className,
            selection:window.getSelection()?.toString()?.slice(0,20),
            dialog:!!document.querySelector("dialog[open]"),
            mainHeight:document.documentElement.scrollHeight}));
          throw Error("Reader controls did not hide after downward scrolling: "+JSON.stringify(state));
        }
        // The animated row must disappear BEHIND the pinned masthead, not
        // float away and leave a disconnected progress stripe.
        await page.waitForTimeout(280);
        const tucked=await page.evaluate(()=>{
          const logo=document.querySelector(".site-header-reader").getBoundingClientRect();
          const tools=document.querySelector(".reader-topbar").getBoundingClientRect();
          const progress=document.querySelector(".reading-progress").getBoundingClientRect();
          return {logoTop:logo.top,logoBottom:logo.bottom,toolsBottom:tools.bottom,progressTop:progress.top};
        });
        assert.ok(Math.abs(tucked.logoTop)<=2,"logo masthead must remain pinned: "+JSON.stringify(tucked));
        assert.ok(tucked.toolsBottom<=tucked.logoBottom+3,
          "reader tool row must slide under the logo, not linger over text: "+JSON.stringify(tucked));
        assert.ok(Math.abs(tucked.progressTop-(tucked.logoBottom-2))<=3,
          "reading progress should be attached to the masthead border: "+JSON.stringify(tucked));
        // Upward content movement must reveal the row. WebKit's synthetic
        // desktop mouse wheel can be swallowed under a touch emulation, so
        // drive the actual document scroll position for this direction.
        await page.evaluate(()=>window.scrollBy(0,-130));
        await page.waitForFunction(()=>!document.querySelector(".reader-topbar.reader-topbar-hidden"),null,{timeout:6000});
        await page.evaluate(()=>window.scrollTo(0,0));
        observations.push({browser:name,width,scenario:"Waylan masthead remains while tools slide behind it and return on upward scroll",compact});
      } else {
        assert.ok(isReaderHeaderShown,"desktop keeps its browsing header");
      }
      if(width<=1040) await page.locator(".mobile-toc").click();
      await page.locator('.reader-toc nav a[href="#h-hydration"]').click();
      await page.waitForTimeout(120);
      const tocPosition=await page.evaluate(()=>{
        const hydration=document.getElementById("h-hydration");
        const stable=document.getElementById("h-ids");
        const top=hydration.getBoundingClientRect().top;
        const expected=parseFloat(getComputedStyle(hydration).scrollMarginTop)||0;
        return {top,expected,stableTop:stable.getBoundingClientRect().top,
          focused:document.activeElement?.id,active:document.querySelector(".reader-toc nav a.active")?.textContent?.trim()};
      });
      observations.push({browser:name,width,scenario:"TOC 水合一致性 jumps to its own heading",tocPosition});
      assert.ok(Math.abs(tocPosition.top-tocPosition.expected)<22,
        `TOC landed at ${tocPosition.top}px instead of ${tocPosition.expected}px: ${JSON.stringify(tocPosition)}`);
      assert.ok(tocPosition.stableTop>tocPosition.top+100,
        "TOC jumped to 稳定的标识 instead of 水合一致性");
      assert.equal(tocPosition.focused,"h-hydration");
      assert.equal(tocPosition.active,"水合一致性");
      await page.screenshot({path:dir+"/"+name+"-"+width+"-toc-hydration.png",animations:"disabled"});
      await page.evaluate(()=>window.scrollTo(0,0));
      // Model iPhone Safari's visible viewport shrinking under browser chrome
      // while a native fixed dialog remains anchored to the layout viewport.
      if (width <= 1366) {
        await page.getByRole("button",{name:"开启摘录段落模式"}).click();
        await page.locator('.reader-prose .article-block[data-type="paragraph"]').first().click();
        await page.locator(".selection-toolbar").waitFor({state:"visible"});
        // Real WebKit tap on unused article space must dismiss the blog tray.
        // Native selection handles are separate OS gestures, not document taps.
        await page.locator(".article-heading").click({position:{x:8,y:8}});
        await page.locator(".selection-toolbar").waitFor({state:"hidden"});
        observations.push({browser:name,width,scenario:"tap empty article space dismisses excerpt toolbar",ok:true});
        await page.locator('.reader-prose .article-block[data-type="paragraph"]').first().click();
        await page.locator(".selection-toolbar-actions button").filter({hasText:"划线"}).click();
        await page.getByRole("button",{name:"退出摘录模式"}).click();
        await page.locator("mark.private-mark").first().click();
        const thread = page.locator(".discussion-dialog.thread-dialog[open]");
        await thread.waitFor({state:"visible"});
        await page.waitForTimeout(420);
        await page.evaluate(() => {
          const viewport = window.visualViewport;
          if (!viewport) throw Error("visualViewport missing in WebKit");
          const height = Math.round(window.innerHeight * 0.69);
          Object.defineProperty(viewport,"height",{configurable:true,value:height});
          Object.defineProperty(viewport,"offsetTop",{configurable:true,value:0});
          viewport.dispatchEvent(new Event("resize"));
        });
        const quoteToggle = thread.locator(".quote-toggle");
        if (await quoteToggle.count()) {
          await quoteToggle.click();
          assert.equal(await quoteToggle.getAttribute("aria-expanded"), "true");
          await quoteToggle.click();
          assert.equal(await quoteToggle.getAttribute("aria-expanded"), "false");
        }
        // A bottom-anchored sheet must keep its action visible when the quote
        // expands or Safari's browser controls move, without centering it.
        await page.waitForFunction(() => {
          const dialog = document.querySelector(".discussion-dialog.thread-dialog[open]");
          const viewport = window.visualViewport;
          return dialog && viewport && Math.abs(dialog.getBoundingClientRect().bottom -
            (viewport.offsetTop + viewport.height - 8)) <= 3;
        });
        const geometry = await page.evaluate(() => {
          const dialog = document.querySelector(".discussion-dialog.thread-dialog[open]");
          const body = dialog.querySelector(".discussion-panel-body");
          const action = dialog.querySelector(".panel-comment-entry");
          const footer = dialog.querySelector(".thread-dialog-footer");
          const beforeScroll = action.getBoundingClientRect().top;
          body.scrollTop = body.scrollHeight;
          const actionStable = Math.abs(beforeScroll - action.getBoundingClientRect().top) < 2;
          const visibleBottom = window.visualViewport.offsetTop + window.visualViewport.height;
          // Regression: a light surface behind a light primary-button label
          // made the mobile "发表评论" action effectively invisible.
          const style = getComputedStyle(action);
          const rgb = value => (value.match(/[0-9.]+/g) || []).slice(0,3).map(Number);
          const luminance = value => rgb(value).reduce((sum, channel, index) => {
            const normalized = channel / 255;
            const linear = normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055)/1.055, 2.4);
            return sum + linear * [0.2126, 0.7152, 0.0722][index];
          }, 0);
          const fg = luminance(style.color), bg = luminance(style.backgroundColor);
          const actionContrast = (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
          return {visibleBottom,visualTop:window.visualViewport.offsetTop,
            dialogTop:dialog.getBoundingClientRect().top,
            dialogBottom:dialog.getBoundingClientRect().bottom,
            actionBottom:action.getBoundingClientRect().bottom,actionContrast,
            actionLabel:action.textContent?.trim(),actionStable,
            footerOutsideScrollableBody:!body.contains(footer) && footer.contains(action),
            inlineTop:dialog.style.top, inlineBottom:dialog.style.bottom,
            marginBlock:dialog.style.marginBlock,
            dialogHeight:dialog.offsetHeight,
            dialogWidth:dialog.getBoundingClientRect().width,
            threadBottomStyle:getComputedStyle(dialog).bottom,
            bodyScrollHeight:body.scrollHeight,bodyHeight:body.clientHeight};
        });
        observations.push({browser:name,width,scenario:"Safari thread sheet avoids obscured browser chrome",geometry});
        assert.ok(geometry.footerOutsideScrollableBody && geometry.actionStable,
          "The thread action must be outside the scrolling excerpt: " + JSON.stringify(geometry));
        assert.ok(geometry.dialogTop >= geometry.visualTop - 3,
          "Thread dialog crosses Safari top chrome: " + JSON.stringify(geometry));
        assert.ok(geometry.dialogWidth <= (width >= 768 ? 640 : width - 30) + 2,
          "Thread dialog touches the viewport edge: " + JSON.stringify(geometry));
        assert.ok(geometry.inlineTop === "auto" && Number.parseFloat(geometry.inlineBottom) >= 8 &&
          Number.parseFloat(geometry.marginBlock) === 0,
          "Thread must be docked to the visible bottom: " + JSON.stringify(geometry));
        assert.ok(Math.abs(geometry.dialogBottom - (geometry.visibleBottom - 8)) <= 3,
          "Thread sheet must remain 8px above Safari chrome: " + JSON.stringify(geometry));
        assert.ok(geometry.dialogBottom <= geometry.visibleBottom + 3,
          "Thread dialog extends under mobile browser chrome: " + JSON.stringify(geometry));
        assert.ok(geometry.actionBottom <= geometry.visibleBottom + 3,
          "Thread action cannot be scrolled into the visible viewport: " + JSON.stringify(geometry));
        assert.ok(geometry.actionLabel?.length > 0 && geometry.actionContrast >= 4.5,
          "Thread action has invisible or low-contrast text: " + JSON.stringify(geometry));
        // Safari's toolbars can move the visual viewport after opening.
        // Keep the same bottom gap instead of recentering the sheet.
        await page.evaluate(() => {
          const viewport = window.visualViewport;
          Object.defineProperty(viewport, "offsetTop", {configurable:true,value:36});
          viewport.dispatchEvent(new Event("scroll"));
        });
        await page.waitForFunction(() => {
          const dialog = document.querySelector(".discussion-dialog.thread-dialog[open]");
          return dialog && Math.abs(dialog.getBoundingClientRect().bottom -
            (36 + window.visualViewport.height - 8)) <= 3;
        });
        observations.push({browser:name,width,scenario:"bottom sheet follows Safari toolbar offset",ok:true});
        await page.screenshot({path:dir+"/"+name+"-"+width+"-thread-viewport.png",animations:"disabled"});
      } else {
        // Desktop regression: select an actual paragraph, save it and open
        // the thread. This was formerly a centered or side-mounted panel.
        const target=page.locator('.reader-prose .article-block[data-type="paragraph"]').first();
        await target.scrollIntoViewIfNeeded();
        await target.evaluate(el=>{
          const p=el.querySelector("p")||el;
          const selection=window.getSelection(),range=document.createRange();
          range.selectNodeContents(p);
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
        });
        await page.locator(".selection-toolbar").waitFor({state:"visible"});
        await page.locator(".selection-toolbar-actions button").filter({hasText:"划线"}).click();
        await page.locator("mark.private-mark").first().click();
        const thread=page.locator("dialog.discussion-dialog.thread-dialog[open]");
        await thread.waitFor({state:"visible"});
        await page.waitForTimeout(420);
        const desktop=await thread.evaluate(dialog=>{
          const rect=dialog.getBoundingClientRect(),style=getComputedStyle(dialog);
          return {bottom:rect.bottom,viewport:window.innerHeight,motion:style.getPropertyValue("--dialog-motion").trim(),
            top:dialog.style.top,bottomInline:dialog.style.bottom,action:!!dialog.querySelector(".panel-comment-entry")};
        });
        assert.equal(desktop.motion,"sheet","desktop comments must slide up from the bottom");
        assert.equal(desktop.top,"auto","desktop must not use viewport centering");
        assert.ok(Math.abs(desktop.viewport-desktop.bottom-8)<=3,
          "desktop paragraph sheet must stay at bottom: "+JSON.stringify(desktop));
        assert.ok(desktop.action,"desktop discussion action is missing");
        await thread.locator(".panel-comment-entry").click();
        const composer=page.locator("dialog.discussion-dialog.composer-dialog[open]");
        await composer.waitFor({state:"visible"});
        assert.equal(await composer.evaluate(el=>getComputedStyle(el).getPropertyValue("--dialog-motion").trim()),
          "sheet","desktop composition must use the same bottom-up motion");
        observations.push({browser:name,width,scenario:"desktop paragraph and composer both open as bottom sheets",desktop});
        await page.screenshot({path:dir+"/"+name+"-"+width+"-desktop-thread-and-composer.png",animations:"disabled"});
      }
      assert.deepEqual(errors,[], "runtime errors");
    }finally{await ctx.close()}
  }finally{await browser.close()}
}
try{
  await ready();
  await run(chromium,"chromium",1440);
  await run(webkit,"webkit",390);
  await run(webkit,"webkit",820);
  await run(webkit,"webkit",1024);
  await run(webkit,"webkit",1194);
  console.log("Reader audit observations:",JSON.stringify(observations));
  assert.ok(observations.filter(x=>x.scenario.includes("返回列表")).every(x=>!x.defect),
    "RETURN_LIST_MISMATCH: 返回列表 must return to content list, not previous article");
}finally{
  await writeFile(dir+"/observations.json",JSON.stringify(observations,null,2));
  server.kill("SIGTERM");server.stdout.destroy();server.stderr.destroy();
}
