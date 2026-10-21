import { chromium } from 'playwright'
import { readdir, mkdir, copyFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.resolve(fileURLToPath(new URL('../../docs/deliverables/', import.meta.url)))
const tmpDir = path.join(dir, '_pdf_tmp')
await mkdir(tmpDir, { recursive: true })

const files = (await readdir(dir)).filter((name) => name.endsWith('.html'))
if (files.length === 0) {
  console.log('no html found in', dir)
  process.exit(1)
}

/** 目标 PDF 可能被阅读器/OneDrive 锁定：先写临时文件，再带重试替换 */
async function replaceWithRetry(from, to) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await copyFile(from, to)
      await unlink(from).catch(() => {})
      return true
    } catch (error) {
      if (attempt === 7) {
        console.warn(`[warn] 无法替换 ${path.basename(to)}（可能被占用）：${error.code ?? error.message}`)
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  return false
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()

const failed = []
for (const file of files) {
  const htmlPath = path.join(dir, file)
  const pdfName = file.replace(/\.html$/u, '.pdf')
  const pdfTmp = path.join(tmpDir, pdfName)
  const pdfPath = path.join(dir, pdfName)
  await page.goto(`file:///${htmlPath.replace(/\\/gu, '/')}`, { waitUntil: 'networkidle' })
  await page.pdf({
    path: pdfTmp,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#8a8275;text-align:center;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '20mm', bottom: '18mm', left: '17mm', right: '17mm' },
  })
  const ok = await replaceWithRetry(pdfTmp, pdfPath)
  console.log(ok ? 'pdf' : 'pdf(待替换)', pdfName)
  if (!ok) failed.push(pdfName)
}

await browser.close()
if (failed.length > 0) {
  console.log(`\n${failed.length} 个 PDF 因占用未替换，新版本在 _pdf_tmp/：${failed.join('、')}`)
}
