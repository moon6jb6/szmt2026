import { chromium } from 'playwright'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 文档 PDF 渲染：docs/deliverables/*.md → 同名 PDF（A4）。
 * 旧 docgen 脚本在外部文件删除事故中丢失，这里用 Playwright + 自写极简 Markdown 渲染重建。
 * 用法：node tools/docgen/render-docs.mjs [只渲染某个文件名]
 */
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const DIR = path.join(ROOT, 'docs', 'deliverables')

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text) {
  let s = esc(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  return s
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const code = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i += 1
      continue
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr/>')
      i += 1
      continue
    }
    if (/^\s*\|/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i].trim())
        i += 1
      }
      const cells = rows.map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      const body = cells.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)))
      const head = body.shift() ?? []
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>')
      for (const row of body) out.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
      out.push('</tbody></table>')
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i += 1
      }
      out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>')
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i += 1
      }
      out.push('<ol>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ol>')
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${quote.map((t) => `<p>${inline(t)}</p>`).join('')}</blockquote>`)
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    // 段落：连续非空行合并
    const para = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s|\s*\||\s*[-*]\s+|\s*\d+[.)]\s+|>\s?|```)/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push(`<p>${para.map((t) => inline(t)).join('<br/>')}</p>`)
  }
  return out.join('\n')
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "SimSun", "Songti SC", "Noto Serif CJK SC", serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.55; }
h1 { font-size: 19pt; text-align: center; margin: 4pt 0 8pt; }
h2 { font-size: 14pt; margin: 16pt 0 6pt; border-bottom: 1px solid #c8a063; padding-bottom: 3pt; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; }
h4 { font-size: 11pt; margin: 10pt 0 4pt; }
p { margin: 4pt 0; text-align: justify; }
blockquote { margin: 6pt 0; padding: 4pt 10pt; border-left: 2px solid #a32b2b; background: #faf6ee; color: #3b332a; }
blockquote p { margin: 2pt 0; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9.5pt; }
th, td { border: 1px solid #b9ac97; padding: 4pt 5pt; vertical-align: top; word-break: break-word; }
th { background: #efe7d8; font-weight: 700; }
ul, ol { margin: 4pt 0 6pt; padding-left: 18pt; }
li { margin: 2pt 0; }
code { font-family: Consolas, monospace; font-size: 9pt; background: #f2ede2; padding: 0 2pt; }
pre { background: #f5f0e6; border: 1px solid #ddd2bd; padding: 6pt; font-size: 8.5pt; white-space: pre-wrap; }
hr { border: 0; border-top: 1px solid #d8cdb8; margin: 10pt 0; }
a { color: #7a3a2a; text-decoration: none; }
`

const only = process.argv[2]
const files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && (!only || f.includes(only)))
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()

for (const file of files) {
  const md = await readFile(path.join(DIR, file), 'utf8')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(file)}</title><style>${CSS}</style></head><body>${mdToHtml(md)}</body></html>`
  const htmlPath = path.join(DIR, file.replace(/\.md$/, '.html'))
  await writeFile(htmlPath, html, 'utf8')
  await page.setContent(html, { waitUntil: 'load' })
  const pdfPath = path.join(DIR, file.replace(/\.md$/, '.pdf'))
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } })
  console.log('pdf', path.basename(pdfPath))
}

await browser.close()
