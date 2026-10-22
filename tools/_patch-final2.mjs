import fs from 'node:fs'
const f='tools/package.mjs'
let s=fs.readFileSync(f,'utf8')
let changed=[]
// 1) DIR_SPEC 的 --final 过滤也去掉 screenshots
if(!s.includes("d.p.endsWith('/screenshots')\n")) { /* noop */ }
if(!s.includes("if (DIR_SPEC[i].p.startsWith('02_作品展示视频') || DIR_SPEC[i].p.startsWith('报名与承诺书') || DIR_SPEC[i].p.endsWith('/screenshots'))")){
  s=s.replace(/if \(DIR_SPEC\[i\]\.p\.startsWith\('02_作品展示视频'\) \|\| DIR_SPEC\[i\]\.p\.startsWith\('报名与承诺书'\)\) \{/, "if (DIR_SPEC[i].p.startsWith('02_作品展示视频') || DIR_SPEC[i].p.startsWith('报名与承诺书') || DIR_SPEC[i].p.endsWith('/screenshots')) {")
  changed.push('dir')
}
// 2) ENTRY_SPEC 的 --final 过滤也去掉 screenshots
if(!s.includes("to.startsWith('报名与承诺书') || to.includes('screenshots')")){
  s=s.replace(/if \(to\.startsWith\('02_作品展示视频'\) \|\| to\.startsWith\('报名与承诺书'\)\) ENTRY_SPEC\.splice\(i, 1\)/, "if (to.startsWith('02_作品展示视频') || to.startsWith('报名与承诺书') || to.includes('screenshots')) ENTRY_SPEC.splice(i, 1)")
  changed.push('entry')
}
// 3) placeholderFiles：--final 时不给占位文件
if(!s.includes('if (EXCLUDE_HANDOFF) return []')){
  s=s.replace(/\r?\n  return \[\r?\n    \{ to: '02_作品展示视频\/占位说明\.txt'/, "\n\n  if (EXCLUDE_HANDOFF) return []\n  return [\n    { to: '02_作品展示视频/占位说明.txt'")
  changed.push('placeholder')
}
fs.writeFileSync(f,s,'utf8')
console.log('changed:', changed)
