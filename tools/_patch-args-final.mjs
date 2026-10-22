import fs from 'node:fs'
const f='tools/package.mjs'
let s=fs.readFileSync(f,'utf8')
if(!s.includes("case '--final':")){
  s=s.replace("case '--quiet': o.quiet = true; break;", "case '--quiet': o.quiet = true; break;\n      case '--final': o.final = true; break;\n      case '--no-screenshots': o.noScreenshots = true; break;")
  fs.writeFileSync(f,s,'utf8'); console.log('patched parseArgs')
} else console.log('already')
