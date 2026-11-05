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
      await page.locator(".reader-back").first().click();
      await page.waitForURL(url=>url.pathname===first,{timeout:12000});
      const returned=new URL(page.url()).pathname;
      const canonical=returned.replace(/\/$/,"");
      observations.push({browser:name,width,scenario:"feed → article A → neighbor article B → 返回上一页（回到 A）",first,second:secondHref,returned,canonical,historyBefore,expected:first,defect:canonical!==first});
      await page.screenshot({path:dir+"/"+name+"-"+width+"-return.png",animations:"disabled"});

      // A compact modal must fit its image and heading, without a tall blank
      // block below the image on iOS Safari.
      const zoomCover=page.locator('.article-cover-image img[role="button"]').first();
      if(await zoomCover.count()){
        await zoomCover.click();
        const zoomDialog=page.locator("dialog.image-dialog[open]");
        await zoomDialog.waitFor();
        await zoomDialog.locator("img").evaluate(img=>img.decode().catch(()=>{}));
        // Wait for the modal entrance transform before measuring its layout.
        await page.waitForTimeout(550);
        const metrics=await zoomDialog.evaluate(dialog=>{
          const outer=dialog.getBoundingClientRect();
          const image=dialog.querySelector("img").getBoundingClientRect();
          const header=dialog.querySelector(".dialog-header").getBoundingClientRect();
          const caption=getComputedStyle(dialog,"::after");
          const footerHeight=caption.display==="none"?0:(parseFloat(caption.height)||0)+
            (parseFloat(caption.paddingTop)||0)+(parseFloat(caption.paddingBottom)||0)+
            (parseFloat(caption.borderTopWidth)||0);
          return {outerHeight:outer.height,headerHeight:header.height,imageHeight:image.height,
            footerHeight,blank:outer.bottom-image.bottom-footerHeight,
            centerOffset:Math.abs(outer.top+outer.height/2-innerHeight/2)};
        });
        observations.push({browser:name,width,scenario:"image zoom is content-sized",metrics});
        assert.ok(Math.abs(metrics.blank)<20,
          "IMAGE_DIALOG_BLANK: image viewer must not leave empty space below image: "+JSON.stringify(metrics));
        assert.ok(metrics.centerOffset<30,
          "IMAGE_DIALOG_CENTER: zoom dialog must be vertically centered: "+JSON.stringify(metrics));
        await page.keyboard.press("Escape");
        await zoomDialog.waitFor({state:"hidden"});
      }
      // One more Back must restore the feed, proving every hop retains its origin.
      await page.locator(".reader-back").first().click();
      await page.waitForURL(url=>(url.pathname.replace(/\/$/,"")||"/")==="/feed",{timeout:12000});
      observations.push({browser:name,width,scenario:"article A → 返回上一页（回到内容列表）",expected:"/feed",returned:new URL(page.url()).pathname,
        defect:(new URL(page.url()).pathname.replace(/\/$/,"")||"/")!=="/feed"});

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
      // Close the native settings dialog before the next navigation.
      // Navigating while a WebKit top-layer dialog is open can crash its renderer.
      await dialog.getByRole("button",{name:"关闭",exact:true}).click();
      await dialog.waitFor({state:"hidden"});
      // End-to-end TOC regression: the original report was a jump from
      // "水合一致性" into the later "稳定的标识" section. DOM-only
      // title/ID checks cannot catch a bad physical scroll landing.
      // Navigate through an actual list link instead of forcing a second
      // full document load in an already exercised WebKit page.
      const targetArticle=page.locator('.feed-list .post-card-link[href="/post/a-room-on-the-internet"]').first();
      if(!(await targetArticle.count())){
        const more=page.locator(".feed-layout button.load-more");
        assert.ok(await more.count(),"the canonical test article must be reachable from the feed");
        await more.click();
      }
      await targetArticle.click();
      await page.waitForURL(url=>url.pathname.replace(/\/$/,"")==="/post/a-room-on-the-internet",{timeout:12000});
      await page.locator('.reader-prose [data-block-id="h-hydration"]').waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const isReaderHeaderShown=await page.locator(".site-header").isVisible();
      assert.equal(isReaderHeaderShown,true,"Waylan brand masthead must remain visible on every device");
      assert.equal(await page.locator(".article-actions").isVisible(),true,
        "full article actions belong below the byline, not a fixed top row");
      assert.equal(await page.locator(".article-actions .article-action-save").count(),1,
        "there should be exactly one labeled save-current-post action");
      assert.equal(await page.locator(".reader-topbar").count(),0,
        "remove the redundant sticky reading toolbar");
      const actionsLayout=await page.locator(".article-actions").evaluate(el=>({
        position:getComputedStyle(el).position,buttons:el.querySelectorAll("button").length,
        text:el.textContent?.trim().slice(0,100)
      }));
      assert.notEqual(actionsLayout.position,"sticky","inline actions must scroll with the article");
      if(width<=1024) {
        assert.equal(await page.locator(".site-header-reader .brand-wordmark").isVisible(),true,
          "Waylan wordmark disappeared during reading");
        assert.equal(await page.locator(".site-header-reader #site-nav").isVisible(),false,
          "article must not duplicate destination navigation");
        assert.equal(await page.locator(".site-header-reader .header-tools .shelf-trigger").isVisible(),true,
          "reading list should remain directly visible");
        assert.equal(await page.locator(".site-header-reader .header-tools .notification-trigger").isVisible(),true,
          "notifications should remain directly visible");
        await page.locator(".site-header-reader .header-tools .settings-button").click();
      } else {
        await page.locator(".settings-button").click();
      }
      const readingSettings=page.getByRole("dialog",{name:"阅读设置",exact:true});
      await readingSettings.waitFor({state:"visible"});
      await readingSettings.locator('.reader-font-choices label:has(input[value="20"])').click();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector(".reader-prose"))
        .getPropertyValue("--reader-font").trim()==="20px");
      const actualFont=await page.locator(".reader-prose").evaluate(el=>getComputedStyle(el).fontSize);
      assert.equal(actualFont,width<=700?"18px":"20px",
        "reader settings must update the article while preserving the deliberate -2px phone adjustment");
      await readingSettings.locator('button[aria-label="关闭"]').click();
      await readingSettings.waitFor({state:"hidden"});
      await page.evaluate(()=>{
        const inline=document.querySelector(".article-actions").getBoundingClientRect();
        window.scrollBy(0,Math.max(550,inline.bottom+220));
      });
      assert.equal(await page.locator(".reader-floating-tools, .reader-floating-trigger, .reader-floating-panel").count(),0,
        "no moving reader controls may cover the article while scrolling");
      await page.evaluate(()=>window.scrollTo(0,0));
      observations.push({browser:name,width,scenario:"quiet inline actions and responsive font settings",actionsLayout});
      if(width<=1040) await page.locator(".article-action-toc").click();
      await page.locator('.reader-toc nav a[href="#h-hydration"]').click();
      // The scroll target is synchronous, but the active section is updated by
      // the scroll observer on a subsequent animation frame.
      await page.waitForFunction(() =>
        document.querySelector('.reader-toc nav a.active')?.getAttribute("href")==="#h-hydration",
        null, {timeout:5000});
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
        if(width<=1040) await page.locator(".article-action-toc").click();
        await page.getByRole("button",{name:"开启摘录段落模式"}).click();
        await page.locator('.reader-prose .article-block[data-type="paragraph"]').first().click();
        await page.locator(".selection-toolbar").waitFor({state:"visible"});
        // Real WebKit tap on unused article space must dismiss the blog tray.
        // Native selection handles are separate OS gestures, not document taps.
        await page.locator(".article-heading h1").click({position:{x:8,y:8}});
        await page.locator(".selection-toolbar").waitFor({state:"hidden"});
        observations.push({browser:name,width,scenario:"tap empty article space dismisses excerpt toolbar",ok:true});
        await page.locator('.reader-prose .article-block[data-type="paragraph"]').first().click();
        await page.locator(".selection-toolbar-actions button").filter({hasText:"划线"}).click();
        if(width<=1040) await page.locator(".article-action-toc").click();
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
  assert.ok(observations.filter(x=>x.scenario.includes("返回上一页")).every(x=>!x.defect),
    "RETURN_ORIGIN_MISMATCH: reader Back must follow each previous app page");
}finally{
  await writeFile(dir+"/observations.json",JSON.stringify(observations,null,2));
  server.kill("SIGTERM");server.stdout.destroy();server.stderr.destroy();
}
