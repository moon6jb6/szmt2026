import { chromium } from 'playwright'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.resolve(fileURLToPath(new URL('../../docs/deliverables/', import.meta.url)))

const files = (await readdir(dir)).filter((name) => name.endsWith('.html'))
if (files.length === 0) {
  console.log('no html found in', dir)
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()

for (const file of files) {
  const htmlPath = path.join(dir, file)
  const pdfPath = htmlPath.replace(/\.html$/u, '.pdf')
  await page.goto(`file:///${htmlPath.replace(/\\/gu, '/')}`, { waitUntil: 'networkidle' })
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#8a8275;text-align:center;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '20mm', bottom: '18mm', left: '17mm', right: '17mm' },
  })
  console.log('pdf', path.basename(pdfPath))
}

await browser.close()
