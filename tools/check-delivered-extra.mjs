import { chromium } from 'playwright'
const base = process.argv[2]
const LEDGER_KEY='names-ledger-v1', UNLOCK_KEY='names-endings-v1'
const ALL=['roster','letters','flag','photo','testimony','message','archive','relics','wordofmouth']
const state={ledger:{roster:2,letters:2,flag:2,photo:2,testimony:2,message:2},flags:[],pendingOutcome:null,pendingNext:null,picked:{},ending:null,startedAt:Date.now()-3600000,finishedAt:null,sceneId:'v1-25'}
const browser=await chromium.launch({channel:'chrome'})
const page=await browser.newPage({viewport:{width:1440,height:900}})
const hits=[]
page.on('response',r=>{ if(/warehouse-ext\.glb|scene-bg\/|\.ogg/.test(r.url())) hits.push([r.status(), r.url().split('/').slice(-2).join('/')]) })
const errors=[]; page.on('pageerror',e=>errors.push(String(e))); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.goto(base,{waitUntil:'networkidle'})
await page.evaluate(({k,v,u,e})=>{localStorage.setItem(k,JSON.stringify(v));localStorage.setItem(u,JSON.stringify(e))},{k:LEDGER_KEY,v:state,u:UNLOCK_KEY,e:ALL})
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(600)
await page.getByRole('button',{name:'继续上次'}).click(); await page.waitForTimeout(2600)
// 史料 chip 点开 + Esc 关闭
const chip=page.locator('.source-row button').first()
let chipOk=false, panelOk=false
if(await chip.isVisible().catch(()=>false)){ chipOk=true; await chip.click(); await page.waitForTimeout(800); panelOk=await page.locator('.source-panel, [class*=source-panel], .source-detail').count()>0; await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
// 3D + GLB
const t=page.getByRole('button',{name:'3D 视角'}).first()
let threeOk=false
if(await t.isVisible().catch(()=>false)){ await t.click(); await page.waitForTimeout(4000); threeOk=await page.locator('canvas').count()>0 }
const glb=hits.filter(h=>/glb/.test(h[1]))
const bg=hits.filter(h=>/scene-bg/.test(h[1]))
const audio=hits.filter(h=>/\.ogg/.test(h[1]))
console.log(JSON.stringify({chipOk,panelOk,threeOk,glb,bg:bg.slice(0,3),audio:audio.slice(0,2),allStatuses:[...new Set(hits.map(h=>h[0]))],errors},null,2))
await browser.close()
