import fs from 'node:fs'
const f='tools/package.mjs'
let s=fs.readFileSync(f,'utf8')
if(!s.includes('if (!EXCLUDE_HANDOFF) {')){
  s=s.replace(/  blockers\.push\('02_作品展示视频[^\r\n]*\r?\n  blockers\.push\('报名与承诺书[^\r\n]*/, "  if (!EXCLUDE_HANDOFF) {\n    blockers.push('02_作品展示视频 为空（评审视频未录制）');\n    blockers.push('报名与承诺书（线下办理）为空（线下环节未完成）');\n  }")
  fs.writeFileSync(f,s,'utf8')
  console.log('patched', s.includes('if (!EXCLUDE_HANDOFF) {'))
} else console.log('already')
