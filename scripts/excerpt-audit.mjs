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
    const context=await b.newContext({viewport:{width,height:780},reducedMotion:"reduce",permissions:["clipboard-read","clipboard-write"]});
    try{
      await context.addInitScript(()=>{
        localStorage.setItem("echo:motion",JSON.stringify("reduced"));
        localStorage.setItem("echo:skin",JSON.stringify("editorial"));
        localStorage.setItem("echo:theme",JSON.stringify("light"));
      });
      const page=await context.newPage();
      await page.route("**/api/session",r=>r.fulfill({json:{user:null,configured:false}}));
      await page.route("**/api/status",r=>r.fulfill({json:{comments:false,login:false}}));
      await page.goto(base+"/feed",{waitUntil:"domcontentloaded"});
      await page.locator(".post-card-link").first().click();
      await page.waitForURL(/\/post\/[^/?]+$/,{timeout:15000});
      await page.locator(".reader-prose .article-block[data-type='paragraph']").first().waitFor({state:"visible",timeout:15000});
      const fab=page.getByRole("button",{name:"开启摘录段落模式"});
      await fab.click();
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
        !state.selectedText.trim() && !/excerpt-selected|selected/.test(state.className) &&
        !state.attrs["data-excerpt-selected"] && state.outlineStyle==="solid" && state.outline.includes("rgba(0, 0, 0, 0)"));
      await page.screenshot({path:dir+"/"+browser+"-"+width+"-tapped.png",animations:"disabled"});
      // Synthetic fixture for a long real DOM paragraph, then tap near its end.
      const long=page.locator(".reader-prose .article-block[data-type='paragraph']").last();
      const longText="摘录开头"+("甲".repeat(650))+"摘录结尾";
      await long.evaluate((el,text)=>{el.textContent=text;},longText);
      await long.scrollIntoViewIfNeeded();
      const box=await long.boundingBox();
      await page.mouse.click(box.x+Math.max(5,box.width-8),Math.min(box.y+box.height-5,760));
      await page.locator(".selection-toolbar").waitFor({state:"visible"});
      const actualLabel=await page.locator(".selection-toolbar-context span").innerText();
      const lastBlockId=await long.getAttribute("data-block-id");
      const captured=await page.evaluate(id=>{
        const toolbar=document.querySelector(".selection-toolbar-context span");
        return {label:toolbar?.textContent,clickAtLastParagraph:document.querySelector('[data-block-id="'+id+'"]')?.textContent?.slice(-14)};
      },lastBlockId);
      record(browser,width,"long paragraph click near tail",{
        label:actualLabel,endsWithTail:actualLabel.includes("摘录结尾"),captured
      },!actualLabel.includes("摘录结尾"));
      await page.screenshot({path:dir+"/"+browser+"-"+width+"-long.png",animations:"disabled"});
      // Scroll after intentional excerpt: unlike transient native selection, user
      // should be able to scroll while reviewing their chosen paragraph.
      await page.evaluate(()=>window.scrollBy(0,200));
      await page.waitForTimeout(180);
      const retained=await page.locator(".selection-toolbar").isVisible();
      record(browser,width,"excerpt survives scroll for action",{
        retained,hintVisible:await page.locator(".excerpt-mode-hint").isVisible()
      },!retained);
      // Re-select and check actual highlight persistence.
      await paragraph.scrollIntoViewIfNeeded();
      await paragraph.click();
      const markButton=page.locator(".selection-toolbar-actions button").filter({hasText:"划线"});
      if(await markButton.isVisible()){
        await markButton.click();
        await page.locator("mark.private-mark").first().waitFor();
        record(browser,width,"mark current excerpt persists",{
          marked:true,stored:await page.evaluate(()=>Object.keys(localStorage).filter(x=>x.startsWith("echo:marks:")).length)
        });
      }
      // UI overlay: while article text occupies the lower right, does the
      // always-on trigger intercept touches that visually belong to prose?
      await page.locator(".excerpt-mode-hint button").click();
      const overlapping=await page.evaluate(()=>{
        const fab=document.querySelector(".excerpt-fab"),paras=[...document.querySelectorAll(".reader-prose [data-block-id]")];
        if(!fab)return{visible:false};
        const f=fab.getBoundingClientRect(),x=f.left+f.width/2,y=f.top+f.height/2;
        const before=paras.filter(p=>{const r=p.getBoundingClientRect();return r.top<=y&&r.bottom>=y&&r.left<=x&&r.right>=x}).map(p=>p.dataset.blockId);
        return{visible:true,rect:{x:f.x,y:f.y,w:f.width,h:f.height},coveredBlocks:before,atTop:document.elementFromPoint(x,y)?.className};
      });
      record(browser,width,"floating trigger obscures prose or controls",overlapping,overlapping.coveredBlocks?.length>0);
      await page.screenshot({path:dir+"/"+browser+"-"+width+"-floating.png",animations:"disabled"});
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
