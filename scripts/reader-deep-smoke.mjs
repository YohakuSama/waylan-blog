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
      observations.push({browser:name,width,scenario:"feed → article A → neighbor article B → button 返回列表",first,second:secondHref,returned,historyBefore,expected:"/feed",defect:returned!=="/feed"});
      await page.screenshot({path:dir+"/"+name+"-"+width+"-return.png",animations:"disabled"});

      await page.goto(origin+"/post/a-room-on-the-internet/",{waitUntil:"domcontentloaded"});
      await page.getByRole("button",{name:"阅读设置",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"阅读设置",exact:true});
      await dialog.waitFor({state:"visible"});
      const radio=dialog.locator('.segmented input[value="dark"]');
      await radio.check();
      const sampled=await page.evaluate(()=>{const box=document.querySelector(".settings-dialog .segmented");const labels=[...box.querySelectorAll("label")];return {chosen:labels.findIndex(el=>el.classList.contains("selected")),thumb: getComputedStyle(box,"::before").transform,colors:labels.map(el=>getComputedStyle(el).color),motion:document.documentElement.dataset.motion}});
      await page.waitForTimeout(80);
      const intermediate=await page.evaluate(()=>{const box=document.querySelector(".settings-dialog .segmented");return {thumb:getComputedStyle(box,"::before").transform,colors:[...box.querySelectorAll("label")].map(el=>getComputedStyle(el).color)}});
      await page.screenshot({path:dir+"/"+name+"-"+width+"-theme-mid.png"});
      await page.waitForTimeout(400);
      const settled=await page.evaluate(()=>{const box=document.querySelector(".settings-dialog .segmented");return {thumb:getComputedStyle(box,"::before").transform,colors:[...box.querySelectorAll("label")].map(el=>getComputedStyle(el).color)}});
      observations.push({browser:name,width,scenario:"article reading → reading settings → light-to-dark theme segment",sampled,intermediate,settled});
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
