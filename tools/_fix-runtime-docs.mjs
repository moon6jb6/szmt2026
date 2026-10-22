import fs from 'node:fs'
const edits = [
  ['docs/deliverables/运行说明.md', [['550 文件 / 23.47 MB', '550 文件 / 24.58 MB']]],
  ['docs/deliverables/作品介绍.md', [['| 构建产物 | 单页静态站点，可直接静态托管或本地打开 |', '| 构建产物 | 单页静态站点，可静态托管；本地查看需用 HTTP 服务打开（直接双击 `index.html` 会白屏，见《运行说明》§〇） |']]],
  ['D:/提交/作品简介与运行环境.md', [
    ['桌面浏览器 Chrome 102+ / Edge 102+，或任意静态文件服务器（例如 npx serve）；无需安装、无需联网、无后端。', '桌面浏览器 Chrome 102+ / Edge 102+，必须通过本地 HTTP 服务打开（例如 python -m http.server 8080，然后访问 http://127.0.0.1:8080/）；不能直接双击 index.html，file:// 打开会白屏。无需安装、无需联网、无后端。'],
    ['Chrome/Edge 102+ 或本地静态服务器；无需安装、断网可跑；', 'Chrome/Edge 102+；需用本地 HTTP 服务打开（不能双击 index.html）；无需安装、断网可跑；'],
  ]],
  ['D:/提交/作品简介与运行环境.txt', [
    ['桌面浏览器 Chrome 102+ / Edge 102+，或任意静态文件服务器（例如 npx serve）；无需安装、无需联网、无后端。', '桌面浏览器 Chrome 102+ / Edge 102+，必须通过本地 HTTP 服务打开（例如 python -m http.server 8080，然后访问 http://127.0.0.1:8080/）；不能直接双击 index.html，file:// 打开会白屏。无需安装、无需联网、无后端。'],
  ]],
]
for (const [file, pairs] of edits) {
  let s = fs.readFileSync(file, 'utf8')
  for (const [a, b] of pairs) {
    if (!s.includes(a)) console.log('MISS', file, a.slice(0, 30))
    s = s.split(a).join(b)
  }
  fs.writeFileSync(file, s, 'utf8')
  console.log('edited', file)
}
// README 快速开始前加评审打开方式
let r = fs.readFileSync('README.md', 'utf8')
if (!r.includes('评审/交付包打开方式')) {
  r = r.replace('## 快速开始\n', '## 评审/交付包打开方式\n\n解压交付包后，**不能直接双击** `01_作品及成果文件/index.html`（浏览器会以 file:// 拦截 ES Module，页面白屏）。进入该目录执行：\n\n```bash\npython -m http.server 8080\n```\n\n浏览器打开 http://127.0.0.1:8080/ 。详见 `04_运行或使用说明/运行说明.pdf` 的「先看这里」。\n\n## 快速开始\n')
  fs.writeFileSync('README.md', r, 'utf8')
  console.log('README added quick-start block')
}
