/** Non-destructive excerpt interaction audit; measures actual UI+selection behavior. */
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {chromium,webkit} from "playwright";
const base="http://127.0.0.1:4183",dir="excerpt-audit-report";
await mkdir(dir,{recursive:true});
const preview=spawn(process.execPath,["node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","4183","--strictPort"],{stdio:["ignore","pipe","pipe"]});
let log="";for(const stream of [preview.stdout,preview.stderr])stream.on("data",x=>log=(log+x).slice(-1500));
async function ready(){for(let i=0;i<110;i++){try{if((await fetch(base)).ok)return}catch{}await new Promise(r=>setTimeout(r,150))}throw Error("Preview failed: "+log)}
const all=[],problems=[];
function record(browser,width,caseName,details,failed=false){
 const item={browser,width,case:caseName,failed,...details};all.push(item);
 if(failed)problems.push(item);
 console.log("EXCERPT_AUDIT",JSON.stringify(item));
}
async function run(engine,browser,width){
  const b=await engine.launch({headless:true});
  try{
    const context=await b.newContext({viewport:{width,height:780},reducedMotion:"reduce"});
    try{
      await context.addInitScript(()=>{
        localStorage.setItem("echo:motion",JSON.stringify("reduced"));
        localStorage.setItem("echo:skin",JSON.stringify("editorial"));
        localStorage.setItem("echo:theme",JSON.stringify("light"));
        Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.__qaCopiedText=text;}}});
        Object.defineProperty(navigator,"share",{configurable:true,value:undefined});
      });
      const page=await context.newPage();
      await page.route("**/api/session",r=>r.fulfill({json:{user:null,configured:false}}));
      await page.route("**/api/status",r=>r.fulfill({json:{comments:false,login:false}}));
      await page.goto(base+"/feed",{waitUntil:"domcontentloaded"});
      await page.locator(".post-card-link").first().click();
      await page.waitForURL(/\/post\/[^/?]+$/,{timeout:15000});
      await page.locator(".reader-prose .article-block[data-type='paragraph']").first().waitFor({state:"visible",timeout:15000});
      // The new article may still be inside a View Transition; avoid clicking
      // through an outgoing snapshot instead of the hydrated reader.
      await page.waitForTimeout(650);
      const fab=page.getByRole("button",{name:"开启摘录段落模式"});
      await fab.click();
      await page.getByRole("button",{name:"退出摘录模式"}).waitFor({state:"visible"});
      assert.equal(await fab.count(),0,"mode toggle should expose its active label");
      const paragraph=page.locator(".reader-prose .article-block[data-type='paragraph']").first();
      await paragraph.click();
      await page.locator(".selection-toolbar").waitFor({state:"visible",timeout:10000});
      const state=await paragraph.evaluate(el=>{
        const computed=getComputedStyle(el), selection=window.getSelection();
        return {
          className:el.className,attrs:Object.fromEntries([...el.attributes].map(a=>[a.name,a.value])),
          selectedText:selection?.toString()||"",outline:computed.outlineColor,
          outlineStyle:computed.outlineStyle,background:computed.backgroundColor,
          highlightedChildren:el.querySelectorAll("mark").length
        };
      });
      record(browser,width,"excerpt visual selection after tap",state,
        state.attrs["data-excerpt-selected"] !== "true" ||
        state.outline.includes("rgba(0, 0, 0, 0)") ||
        state.outlineStyle === "none");
      await page.screenshot({path:dir+"/"+browser+"-"+width+"-tapped.png",animations:"disabled"});
      // Check every excerpt toolbar side effect independently, without an
      // actual GitHub login or publishing any comment.
      await page.locator(".selection-toolbar-actions button").filter({hasText:"分享"}).click();
      const shareResult=await page.evaluate(()=>window.__qaCopiedText||"");
      record(browser,width,"share copies the chosen quote and its article URL",{
        shareHasURL:shareResult.includes("/post/"),hasExcerpt:shareResult.includes("这个博客")
      },!shareResult.includes("/post/")||!shareResult.includes("这个博客"));
      await page.locator(".selection-toolbar-actions button").filter({hasText:"评论"}).click();
      const commentDialog=page.locator("dialog.discussion-dialog[open]");
      await commentDialog.waitFor({state:"visible"});
      const quote=await commentDialog.locator(".panel-original blockquote").innerText();
      record(browser,width,"comment opens one matching quoted composer",{
        dialogs:await page.locator("dialog[open]").count(),quote:quote.slice(0,45)
      },!quote.includes("这个博客")||(await page.locator("dialog[open]").count())!==1);
      await commentDialog.locator('.dialog-header button[aria-label="关闭"]').click();
      await commentDialog.waitFor({state:"hidden"});
      // Synthetic fixture for a long real DOM paragraph, then tap near its end.
      const long=page.locator(".reader-prose .article-block[data-type='paragraph']").last();
      const longText="摘录开头"+("甲".repeat(650))+"摘录结尾";
      await long.evaluate((el,text)=>{el.textContent=text;},longText);
      await long.evaluate(el=>{el.scrollIntoView({block:"end"});window.scrollBy(0,160);});
      await page.waitForTimeout(90);
      const box=await long.boundingBox();
      assert.ok(box,"long DOM fixture needs a bounding box");
      const x=box.x+Math.max(12,Math.min(box.width/2,box.width-12)), y=Math.max(40,Math.min(box.y+box.height-15,575));
      const realTarget=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest("[data-block-id]")?.getAttribute("data-block-id"),[x,y]);
      assert.equal(realTarget,await long.getAttribute("data-block-id"),"test must click target paragraph, not the floating toolbar");
      await page.mouse.click(x,y);
      await page.locator(".selection-toolbar").waitFor({state:"visible",timeout:8000});
      const actualLabel=await page.locator(".selection-toolbar-context span").innerText();
      await page.locator(".selection-toolbar-actions button").filter({hasText:"复制"}).click();
      const copiedText=await page.evaluate(()=>window.__qaCopiedText||"");
      const lastBlockId=await long.getAttribute("data-block-id");
      const captured=await page.evaluate(id=>{
        const toolbar=document.querySelector(".selection-toolbar-context span");
        return {label:toolbar?.textContent,clickAtLastParagraph:document.querySelector('[data-block-id="'+id+'"]')?.textContent?.slice(-14)};
      },lastBlockId);
      record(browser,width,"long paragraph click near tail",{
        label:actualLabel,copiedEnd:copiedText.slice(-20),endsWithTail:copiedText.endsWith("摘录结尾"),captured
      },!copiedText.endsWith("摘录结尾"));
      await page.screenshot({path:dir+"/"+browser+"-"+width+"-long.png",animations:"disabled"});
      // Scroll after intentional excerpt: unlike transient native selection, user
      // should be able to scroll while reviewing their chosen paragraph.
      await page.evaluate(()=>window.scrollBy(0,200));
      await page.waitForTimeout(180);
      const retained=await page.locator(".selection-toolbar").isVisible();
      record(browser,width,"excerpt survives scroll for action",{
        retained,modeActive:await page.getByRole("button",{name:"退出摘录模式"}).getAttribute("aria-pressed")
      },!retained);
      // The first tap away from an active quote now deliberately dismisses
      // that selection and the tray together. Start a different excerpt with
      // an explicit close, then prove its highlight is actually persisted.
      await page.getByRole("button",{name:"关闭摘录工具栏"}).click();
      await page.locator(".selection-toolbar").waitFor({state:"hidden"});
      await paragraph.scrollIntoViewIfNeeded();
      await paragraph.click();
      const markButton=page.locator(".selection-toolbar-actions button").filter({hasText:"划线"});
      await markButton.waitFor({state:"visible"});
      await markButton.click();
      await page.locator("mark.private-mark").first().waitFor({state:"visible"});
      record(browser,width,"mark current excerpt persists",{
        marked:true,stored:await page.evaluate(()=>Object.keys(localStorage).filter(x=>x.startsWith("echo:marks:")).length)
      });
      // Re-tapping existing highlighted text in excerpt mode should select it,
      // not trigger the normal-mode historical discussion panel.
      await page.locator("mark.private-mark").first().click();
      await page.waitForTimeout(80);
      const unintendedDialog=await page.locator("dialog.thread-dialog[open]").count();
      const canReselect=await page.locator(".selection-toolbar").isVisible();
      record(browser,width,"retapping a saved mark in excerpt mode",{
        canReselect,unintendedDialog:unintendedDialog>0
      },!canReselect||unintendedDialog>0);
      if(unintendedDialog)await page.locator("dialog.thread-dialog[open] button[aria-label='关闭']").first().click();
      if(canReselect)await page.getByRole("button",{name:"关闭摘录工具栏"}).click();
      // Excerpt now shares the ordinary reader controls and must not create
      // a second sticky strip or a floating overlay.
      await page.getByRole("button",{name:"退出摘录模式"}).click();
      const controls=await page.evaluate(()=>{
        const toggle=document.querySelector(".excerpt-toggle");
        const bar=document.querySelector(".reader-topbar");
        const site=document.querySelector(".site-header");
        const rect=toggle?.getBoundingClientRect(), head=site?.getBoundingClientRect();
        return {
          inReaderControls:!!toggle?.closest(".reader-topbar .reader-controls"),
          extraStrip:!!document.querySelector(".excerpt-access"),
          active:toggle?.getAttribute("aria-pressed"),
          toggleTop:rect?.top,headerBottom:head?.bottom,
          style:bar?getComputedStyle(bar).position:null
        };
      });
      record(browser,width,"excerpt lives in the shared reader tool row",controls,
        !controls.inReaderControls||controls.extraStrip||controls.active!=="false"||controls.style!=="sticky");
      await page.screenshot({path:dir+"/"+browser+"-"+width+"-reader-tools.png",animations:"disabled"});
    }finally{await context.close()}
  }finally{await b.close()}
}
try{
 await ready();
 for(const [engine,name,width] of [[chromium,"chromium",390],[webkit,"webkit",390],[chromium,"chromium",768]])
   await run(engine,name,width);
}finally{
 await writeFile(dir+"/observations.json",JSON.stringify({all,problems},null,2));
 preview.kill("SIGTERM");preview.stdout.destroy();preview.stderr.destroy();
}
assert.equal(problems.length,0,"EXCERPT_BEHAVIOR_REGRESSIONS: "+JSON.stringify(problems.map(p=>({browser:p.browser,width:p.width,case:p.case}))));
