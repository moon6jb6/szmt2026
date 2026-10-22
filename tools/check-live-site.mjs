import { chromium } from 'playwright'
const url='https://moon6jb6.github.io/szmt2026/'
const browser=await chromium.launch({channel:'chrome'})
const page=await browser.newPage({viewport:{width:1280,height:800}})
const fails=[],errors=[]
page.on('response',r=>{if(r.status()>=400)fails.push(`${r.status()} ${r.url()}`)})
page.on('pageerror',e=>errors.push(String(e)))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
let gotoErr=''
try{ await page.goto(url,{waitUntil:'networkidle',timeout:45000}); await page.waitForTimeout(1500) }catch(e){ gotoErr=e.message }
const info=await page.evaluate(()=>({title:document.title, h1:(document.querySelector('h1')||{}).textContent||'', buttons:[...document.querySelectorAll('button')].slice(0,12).map(b=>b.textContent.trim()), rootChildren:(document.querySelector('#root')||{}).children?.length||0})).catch(()=>({}))
console.log(JSON.stringify({url,gotoErr,info,fails:fails.slice(0,6),errors:errors.slice(0,4)},null,2))
await browser.close()
