import { chromium } from 'playwright'
const url='https://moon6jb6.github.io/szmt2026/'
const browser=await chromium.launch({channel:'chrome'})
const page=await browser.newPage({viewport:{width:1280,height:800}})
const fails=[],errors=[]
page.on('response',r=>{if(r.status()>=400)fails.push(`${r.status()} ${r.url()}`)})
page.on('pageerror',e=>errors.push(String(e)))
await page.goto(url,{waitUntil:'networkidle'})
const assets=await page.evaluate(()=>[...document.querySelectorAll('script[src],link[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href')))
const state={ledger:{roster:2,letters:2,flag:2,photo:2,testimony:2,message:2},flags:[],pendingOutcome:null,pendingNext:null,picked:{},ending:null,startedAt:Date.now()-3600000,finishedAt:null,sceneId:'v1-25'}
await page.evaluate(({k,v,u,e})=>{localStorage.setItem(k,JSON.stringify(v));localStorage.setItem(u,JSON.stringify(e))},{k:'names-ledger-v1',v:state,u:'names-endings-v1',e:['roster','letters','flag','photo','testimony','message','archive','relics','wordofmouth']})
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(600)
const resume=page.getByRole('button',{name:'继续上次'})
if(await resume.isVisible().catch(()=>false)){ await resume.click(); await page.waitForTimeout(2600) }
const features={pathname:await page.evaluate(()=>location.pathname),explore:await page.getByRole('button',{name:'场景探索'}).isVisible().catch(()=>false),toggle3d:await page.getByRole('button',{name:'3D 视角'}).isVisible().catch(()=>false),beats:await page.locator('.beats').count(),scene:await page.locator('.scene').getAttribute('data-scene').catch(()=>null)}
console.log(JSON.stringify({assets,fails,errors:errors.slice(0,3),features},null,2))
await browser.close()
