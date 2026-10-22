import fs from 'node:fs'
const file='tools/package.mjs'
let s=fs.readFileSync(file,'utf8')
if(!s.includes("if (NO_SCREENSHOTS) return { count: 0")){
  s=s.replace(/function checkScreenshots\(files\) \{\r?\n  const list/, "function checkScreenshots(files) {\n  if (NO_SCREENSHOTS) return { count: 0, expected: 0, ok: true, bytes: 0, names: [] }\n  const list")
  fs.writeFileSync(file,s,'utf8'); console.log('patched checkScreenshots')
} else console.log('already')
