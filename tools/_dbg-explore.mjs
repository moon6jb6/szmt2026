import { chromium } from 'playwright'
const url='http://127.0.0.1:4173/'
const state={sceneId:'v1-25',ledger:{roster:1,letters:1,flag:1,photo:0,testimony:0,message:0},flags:[],pendingOutcome:null,pendingNext:null,picked:{},ending:null,startedAt:Date.now()-60000,finishedAt:null}
const b=await chromium.launch({channel:'chrome'});const p=await b.newPage({viewport:{width:1440,height:900}})
await p.goto(url,{waitUntil:'networkidle'});await p.evaluate(v=>localStorage.setItem('names-ledger-v1',JSON.stringify(v)),state);await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(500)
await p.getByRole('button',{name:'继续上次'}).click();await p.waitForTimeout(2400)
const btns=await p.evaluate(()=>[...document.querySelectorAll('button')].map(el=>({text:(el.textContent||'').trim().slice(0,12), cls:el.className, label:el.getAttribute('aria-label'), rect:el.getBoundingClientRect().top})))
console.log('buttons before:',JSON.stringify(btns,null,1).slice(0,1200))
await p.getByRole('button',{name:'场景探索'}).click();await p.waitForTimeout(1500)
const info=await p.evaluate(()=>({hotspots:document.querySelectorAll('.scene-hotspots').length, anySig:document.querySelectorAll('[class*="hotspot"]').length, imgs:[...document.querySelectorAll('img')].map(i=>i.src.slice(-40)), buttons:[...document.querySelectorAll('button')].map(el=>({t:(el.textContent||'').trim().slice(0,10),c:el.className})).slice(0,8)}))
console.log('after explore:',JSON.stringify(info,null,1))
await b.close()
