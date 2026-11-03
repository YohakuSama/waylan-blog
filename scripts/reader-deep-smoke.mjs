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
    const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:"no-preference"});
    try{
      await ctx.addInitScript(()=>{localStorage.setItem("echo:motion",JSON.stringify("full"));localStorage.setItem("echo:skin",JSON.stringify("editorial"));localStorage.setItem("echo:theme",JSON.stringify("light"))});
      const page=await ctx.newPage();
      const errors=[];page.on("pageerror",e=>errors.push(String(e)));
      await page.route("**/api/status",route=>route.fulfill({json:{comments:false,notifications:false}}));
      await page.route("**/api/session",route=>route.fulfill({json:{user:null}}));
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
      await page.locator(".post-card-link").first().click();
      await page.waitForURL(/\/post\/[^/?]+$/,{timeout:12000});
      // Let any prior page View Transition settle before measuring a new widget.
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
      // Model iPhone Safari's visible viewport shrinking under browser chrome
      // while a native fixed dialog remains anchored to the layout viewport.
      if (width <= 600) {
        await page.getByRole("button",{name:"开启摘录段落模式"}).click();
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
        const geometry = await page.evaluate(() => {
          const dialog = document.querySelector(".discussion-dialog.thread-dialog[open]");
          const body = dialog.querySelector(".discussion-panel-body");
          body.scrollTop = body.scrollHeight;
          const action = dialog.querySelector(".panel-comment-entry");
          const visibleBottom = window.visualViewport.offsetTop + window.visualViewport.height;
          return {visibleBottom,dialogBottom:dialog.getBoundingClientRect().bottom,
            actionBottom:action.getBoundingClientRect().bottom,
            threadBottomStyle:getComputedStyle(dialog).bottom,
            bodyScrollHeight:body.scrollHeight,bodyHeight:body.clientHeight};
        });
        observations.push({browser:name,width,scenario:"Safari thread sheet avoids obscured browser chrome",geometry});
        assert.ok(geometry.dialogBottom <= geometry.visibleBottom + 3,
          "Thread dialog extends under mobile browser chrome: " + JSON.stringify(geometry));
        assert.ok(geometry.actionBottom <= geometry.visibleBottom + 3,
          "Thread action cannot be scrolled into the visible viewport: " + JSON.stringify(geometry));
        await page.screenshot({path:dir+"/"+name+"-"+width+"-thread-viewport.png",animations:"disabled"});
      }
      assert.deepEqual(errors,[], "runtime errors");
    }finally{await ctx.close()}
  }finally{await browser.close()}
}
try{
  await ready();
  await run(chromium,"chromium",1440);
  await run(webkit,"webkit",390);
  console.log("Reader audit observations:",JSON.stringify(observations));
  assert.ok(observations.filter(x=>x.scenario.includes("返回列表")).every(x=>!x.defect),
    "RETURN_LIST_MISMATCH: 返回列表 must return to content list, not previous article");
}finally{
  await writeFile(dir+"/observations.json",JSON.stringify(observations,null,2));
  server.kill("SIGTERM");server.stdout.destroy();server.stderr.destroy();
}
