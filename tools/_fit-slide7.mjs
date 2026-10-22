import { chromium } from 'playwright'
import path from 'node:path'
const url='http://127.0.0.1:4173/'; const OUT='D:/提交/截图素材'
const LEDGER='names-ledger-v1', UNLOCK='names-endings-v1'
const ALL=['roster','letters','flag','photo','testimony','message','archive','relics','wordofmouth']
const base={ledger:{roster:2,letters:2,flag:2,photo:2,testimony:2,message:2},flags:[],pendingOutcome:null,pendingNext:null,picked:{},ending:null,startedAt:Date.now()-3600000,finishedAt:null}
const browser=await chromium.launch({channel:'chrome'})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2})
async function make(id){await page.goto(url,{waitUntil:'networkidle'});await page.evaluate(({k,v,u,e})=>{localStorage.setItem(k,JSON.stringify(v));localStorage.setItem(u,JSON.stringify(e))},{k:LEDGER,v:{...base,sceneId:id},u:UNLOCK,e:ALL});await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(500);await page.getByRole('button',{name:'继续上次'}).click();await page.waitForTimeout(2400);for(let i=0;i<6;i++){const b=page.getByRole('button',{name:/继续读/});if(!(await b.isVisible().catch(()=>false)))break;await b.click();await page.waitForTimeout(600)}}
for (const [id,zoom,scroll,tag] of [['v0-03',0.68,0,'a'],['v0-03',0.68,120,'b'],['v0-02',0.68,0,'c'],['v0-02',0.68,120,'d']]){
  await make(id)
  await page.addStyleTag({content:`.stage-content { zoom: ${zoom}; }`})
  await page.waitForTimeout(600)
  await page.evaluate((s)=>{const el=document.querySelector('.stage-content');if(el)el.scrollTop=s},scroll)
  await page.waitForTimeout(500)
  await page.screenshot({path:path.join(OUT,`slide7-fit-${tag}.png`)})
  console.log('shot',tag)
}
await browser.close()
