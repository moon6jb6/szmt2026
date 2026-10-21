/**
 * 打印无头 Chrome 的 WebGL 后端信息（报告要写清「真 GPU」还是 SwiftShader 软光栅）
 * 用法：node tools/3d/gpu-info.mjs [url]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
await page.goto(url)
const info = await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!gl) return { webgl: false }
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    webgl: true,
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    glVersion: gl.getParameter(gl.VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}×${screen.height}`,
    ua: navigator.userAgent,
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
