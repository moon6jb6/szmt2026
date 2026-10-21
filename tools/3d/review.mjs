/**
 * 3D 场景 / GLB 加载 专项复测工具
 *
 * 用法：node tools/3d/review.mjs <suite> [选项]
 *   suite:
 *     fallback  断网 / 404 / 损坏 GLB / 慢网卸载 下的回退行为
 *     cycles    反复开关 3D 20 次 + WEBGL_lose_context 恢复
 *     perf      1600×1000 / 390×844 / 4× CPU 降频 / DPR 上限 / resize
 *     deploy    dev / preview / 子目录 三种部署下 GLB 是否 200
 *     all       依次跑全部
 *   选项：
 *     --url <url>     默认 http://127.0.0.1:4173/
 *     --scene <id>    默认 v1-25（warehouse-ext 切片，唯一用 GLB 的）
 *     --cycles <n>    默认 20
 *
 * 产出：tools/3d/shots/review/*.png + tools/3d/shots/review/review-<suite>.json
 * 退出码：任一断言失败 → 1
 */

import { chromium } from 'playwright'
import { mkdir, writeFile, cp, stat, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const shots = path.join(here, 'shots/review')
await mkdir(shots, { recursive: true })

const argv = process.argv.slice(2)
const suite = argv[0] ?? 'all'
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const url = opt('url', 'http://127.0.0.1:4173/')
const sceneId = opt('scene', 'v1-25')
const cycles = Number(opt('cycles', 20))

const SAVE_KEY = 'names-ledger-v1'
const makeSave = (id) => ({
  sceneId: id,
  ledger: { roster: 1, letters: 0, flag: 0, photo: 0, testimony: 0, message: 0 },
  flags: [],
  pendingOutcome: null,
  pendingNext: null,
  picked: {},
  ending: null,
  startedAt: Date.now() - 60000,
  finishedAt: null,
})

const shot = async (page, name) => {
  const file = path.join(shots, name)
  await page.screenshot({ path: file })
  return `tools/3d/shots/review/${name}`
}

/** 进场景（注入存档 → 继续上次） */
async function enterScene(page, id) {
  await enterSceneAt(page, url, id)
}

async function enterSceneAt(page, target, id) {
  await page.goto(target, { waitUntil: 'networkidle' })
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: SAVE_KEY, value: makeSave(id) },
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
  await page.getByRole('button', { name: '继续上次' }).click()
  await page.waitForTimeout(2100)
}

/** 点「3D 视角」并等首帧（页面内打点，避免 CDP 往返误差） */
async function enter3D(page, { timeout = 20000 } = {}) {
  const t0 = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('3D 视角'))
    if (!button) return -1
    button.click()
    return performance.now()
  })
  if (t0 < 0) throw new Error('没有找到「3D 视角」按钮')
  await page.waitForFunction(
    () => {
      const host = document.querySelector('.scene3d')
      return host && Number(host.dataset.ready ?? 0) > 0
    },
    null,
    { timeout },
  )
  const stats = await page.evaluate(() => {
    const host = document.querySelector('.scene3d')
    return {
      ready: Number(host.dataset.ready ?? 0),
      mounted: Number(host.dataset.mounted ?? 0),
      glb: host.dataset.glb ?? null,
      gl: host.dataset.gl ?? null,
      canvases: document.querySelectorAll('canvas').length,
    }
  })
  return {
    firstFrameMs: Math.round(stats.ready - t0),
    chunkMs: Math.round(stats.mounted - t0),
    glInitMs: Math.round(stats.ready - stats.mounted),
    ...stats,
  }
}

async function exit3D(page) {
  await page.getByRole('button', { name: '回到 2.5D' }).click()
  await page.waitForTimeout(700)
  return page.evaluate(() => ({
    scene3d: document.querySelectorAll('.scene3d').length,
    canvases: document.querySelectorAll('canvas').length,
  }))
}

/**
 * 带重试的「进场景 → 点 3D」：dev 模式下第一次点 3D 会触发 vite 依赖预构建（three），
 * 在飞的模块请求被 abort → 页面自动重载，所以第一次多半失败，重载后第二次才成功。
 * 这里把这件事如实记下来（attempts / reloaded），而不是假装一次过。
 */
async function enterSceneAnd3D(page, target, id, { attempts = 3, base = target } = {}) {
  const log = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await enterSceneAt(page, base, id)
    const hasToggle = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
    if (!hasToggle) {
      log.push({ attempt, hasToggle })
      continue
    }
    const t0 = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('3D 视角'))
      button.click()
      return performance.now()
    })
    let ok = true
    try {
      await page.waitForFunction(
        () => {
          const host = document.querySelector('.scene3d')
          return host && Number(host.dataset.ready ?? 0) > 0
        },
        null,
        { timeout: 15000 },
      )
    } catch {
      ok = false
    }
    const alive = await page.evaluate(() => Boolean(document.querySelector('.app-shell')))
    log.push({ attempt, hasToggle, ok, appAlive: alive })
    if (ok) {
      const s = await page.evaluate(() => {
        const host = document.querySelector('.scene3d')
        return { ready: Number(host.dataset.ready ?? 0), glb: host.dataset.glb ?? null }
      })
      await page.waitForTimeout(1200)
      const stats = await readStats(page)
      return { attempts: attempt, log, firstFrameMs: Math.round(s.ready - t0), glb: s.glb, stats }
    }
    // 等页面自己重载完（vite 依赖预构建会强制 reload）
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(800)
  }
  return { attempts: attempts, log, failed: true }
}

const measureFps = (page, ms) =>
  page.evaluate(
    (span) =>
      new Promise((done) => {
        let frames = 0
        const started = performance.now()
        const selfSamples = []
        const sampler = setInterval(() => {
          const host = document.querySelector('.scene3d')
          if (host?.dataset.fps) selfSamples.push(Number(host.dataset.fps))
        }, 100)
        const tick = () => {
          frames += 1
          const elapsed = performance.now() - started
          if (elapsed < span) requestAnimationFrame(tick)
          else {
            clearInterval(sampler)
            done({
              fps: Number((frames / (elapsed / 1000)).toFixed(1)),
              selfReported: selfSamples.length ? Number((selfSamples.reduce((a, b) => a + b, 0) / selfSamples.length).toFixed(1)) : null,
              selfMin: selfSamples.length ? Math.min(...selfSamples) : null,
              selfMax: selfSamples.length ? Math.max(...selfSamples) : null,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )

const readStats = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('.scene3d')
    if (!host) return null
    const canvas = host.querySelector('canvas')
    return {
      fps: Number(host.dataset.fps ?? 0),
      calls: Number(host.dataset.calls ?? 0),
      tris: Number(host.dataset.tris ?? 0),
      glb: host.dataset.glb ?? null,
      gl: host.dataset.gl ?? null,
      variant: host.dataset.variant ?? null,
      dpr: window.devicePixelRatio || 1,
      buffer: canvas ? { width: canvas.width, height: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight } : null,
      canvases: document.querySelectorAll('canvas').length,
      heapMB: performance.memory ? Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)) : null,
    }
  })

const attach = (page, errors, net) => {
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // Chrome 对任何 4xx/5xx 都会自己打一条 "Failed to load resource"：
    // 那不是应用报错，是被测场景本身（404 实验）的预期产物，单独归类
    if (text.startsWith('Failed to load resource')) net.push(`[console-net] ${text.slice(0, 200)}`)
    else errors.push(`[console] ${text.slice(0, 300)}`)
  })
  page.on('requestfailed', (r) => net.push(`FAILED ${r.url().replace(url, '/')} :: ${r.failure()?.errorText ?? ''}`))
  page.on('response', (r) => {
    if (r.url().includes('.glb') || r.status() >= 400) net.push(`${r.status()} ${r.url().replace(url, '/')}`)
  })
}

const results = {}
const failures = []
const assert = (ok, message) => {
  if (!ok) failures.push(message)
  return ok
}

// ---------------------------------------------------------------- suites

async function suiteFallback(browser) {
  const out = {}

  // 1) GLB 404：静默回退，地面+灯光还在
  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    await page.route('**/models/warehouse-ext.glb', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }),
    )
    const enter = await enter3D(page)
    await page.waitForTimeout(1200)
    const stats = await readStats(page)
    out.notFound404 = {
      enter,
      stats,
      errors,
      net,
      shot: await shot(page, 'fallback-404.png'),
      // 回退有效的判据：画布还在、还能出帧、状态是 failed、应用层面没有报错
      pass: assert(stats && stats.fps > 0, '404: 没有出帧') && assert(stats?.glb === 'failed', '404: data-glb 不是 failed') && assert(errors.length === 0, `404: 有应用报错 ${errors[0] ?? ''}`),
    }
    console.log('fallback 404:', JSON.stringify(out.notFound404.pass), 'glb=', stats?.glb, 'fps=', stats?.fps, 'net=', net.length)
    await page.close()
  }

  // 2) 损坏 GLB：返回 200 但内容不是 glTF
  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    await page.route('**/models/warehouse-ext.glb', (route) =>
      route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.alloc(4096, 0x41) }),
    )
    const enter = await enter3D(page)
    await page.waitForTimeout(1500)
    const stats = await readStats(page)
    out.corrupted = {
      enter,
      stats,
      errors,
      shot: await shot(page, 'fallback-corrupt.png'),
      pass:
        assert(stats && stats.fps > 0, 'corrupt: 没有出帧') &&
        assert(stats?.glb === 'failed', `corrupt: data-glb=${stats?.glb}`) &&
        assert(errors.length === 0, `corrupt: 有报错 ${errors[0] ?? ''}`),
    }
    console.log('fallback corrupt:', JSON.stringify(out.corrupted.pass), 'glb=', stats?.glb, 'fps=', stats?.fps, 'errors=', errors.length)
    await page.close()
  }

  // 3) 断网（setOffline）两段：
  //    3a 冷启动（lazy chunk 没缓存过）→ 这是最危险的一路，整页可能崩掉
  //    3b 已经成功进过一次 3D（chunk 在浏览器缓存里）→ GLB 拿不到，应静默回退灯光地面
  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    await page.context().setOffline(true)
    let enter = null
    let enterError = null
    try {
      enter = await enter3D(page, { timeout: 12000 })
    } catch (error) {
      enterError = String(error).slice(0, 200)
    }
    await page.waitForTimeout(1200)
    const stats = await readStats(page)
    const alive = await page.evaluate(() => ({
      appShell: Boolean(document.querySelector('.app-shell')),
      sceneBody: Boolean(document.querySelector('.scene-body')),
      bodyText: document.body.innerText.slice(0, 60),
      scene3d: document.querySelectorAll('.scene3d').length,
    }))
    out.offlineCold = {
      enter,
      enterError,
      stats,
      alive,
      errors,
      net,
      shot: await shot(page, 'fallback-offline.png'),
      // 冷启动断网的判据：① 不白屏（正文还在）② 若 3D 挂上了，GLB 必须静默失败
      pass: assert(alive.sceneBody && alive.appShell, `offline(cold): 整页崩了 ${JSON.stringify(alive)}`),
      glbPass: stats ? assert(stats.glb === 'failed', `offline(cold): data-glb=${stats.glb}`) : null,
    }
    console.log('fallback offline(cold): page-alive=', alive.appShell && alive.sceneBody, 'errors=', errors.length ? errors[0] : 'none')
    await page.context().setOffline(false)
    await page.close()
  }

  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    // 先在线打开一次：让 lazy chunk 进浏览器缓存
    const warm = await enter3D(page)
    await exit3D(page)
    await page.context().setOffline(true)
    const enter = await enter3D(page, { timeout: 15000 })
    await page.waitForTimeout(1600)
    const stats = await readStats(page)
    const alive = await page.evaluate(() => ({
      appShell: Boolean(document.querySelector('.app-shell')),
      sceneBody: Boolean(document.querySelector('.scene-body')),
      scene3d: document.querySelectorAll('.scene3d').length,
    }))
    out.offlineWarm = {
      warmFirstFrameMs: warm.firstFrameMs,
      enter,
      stats,
      alive,
      errors,
      net,
      shot: await shot(page, 'fallback-offline-warm.png'),
      // 已经成功加载过一次之后断网：three 的 Cache 或浏览器缓存命中 → ready 也算通过，
      // 命中不了则必须静默回退到灯光地面（failed）且照常出帧
      outcome: stats?.glb === 'ready' ? 'cache-hit' : stats?.glb === 'failed' ? 'silent-fallback' : `unexpected:${stats?.glb}`,
      pass:
        assert(alive.appShell && alive.sceneBody, `offline(warm): 整页崩了 ${JSON.stringify(alive)}`) &&
        assert(stats?.glb === 'ready' || stats?.glb === 'failed', `offline(warm): data-glb=${stats?.glb}`) &&
        assert(stats.fps > 0, 'offline(warm): 回退画面没有出帧') &&
        assert(errors.length === 0, `offline(warm): 有报错 ${errors[0] ?? ''}`),
    }
    console.log('fallback offline(warm): glb=', stats?.glb, 'fps=', stats?.fps, 'errors=', errors.length ? errors[0] : 'none')
    await page.context().setOffline(false)
    await page.close()
  }

  // 4) 慢网 + 立刻切走：加载回来的 GLB 必须被释放，不能崩
  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    await page.route('**/models/warehouse-ext.glb', async (route) => {
      await new Promise((done) => setTimeout(done, 3500))
      await route.continue().catch(() => {})
    })
    const t0 = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('3D 视角'))
      button?.click()
      return performance.now()
    })
    await page.waitForFunction(() => {
      const host = document.querySelector('.scene3d')
      return host && Number(host.dataset.ready ?? 0) > 0
    }, null, { timeout: 15000 })
    // 300 ms 后就切回 2.5D：此刻 GLB 还在飞
    await page.waitForTimeout(300)
    const beforeExit = await page.evaluate(() => document.querySelector('.scene3d')?.dataset.glb ?? null)
    // 加载中的画面：证明「慢网期间不是空白，而是灯光地面」
    const loadingShot = await shot(page, 'loading-glb-pending.png')
    const afterExit = await exit3D(page)
    await page.waitForTimeout(4500) // 等那条慢请求回来
    const after = await page.evaluate(() => ({
      scene3d: document.querySelectorAll('.scene3d').length,
      canvases: document.querySelectorAll('canvas').length,
      bodyText: document.body.innerText.slice(0, 40),
    }))
    out.slowAbort = {
      clickToFirstFrame: Math.round((await page.evaluate(() => performance.now())) - t0),
      glbAtExit: beforeExit,
      afterExit,
      after,
      errors,
      net,
      shots: [loadingShot, await shot(page, 'fallback-slow-abort.png')],
      pass:
        assert(beforeExit === 'loading', `slow: 切走时 data-glb=${beforeExit}（预期 loading）`) &&
        assert(after.scene3d === 0, 'slow: .scene3d 没清掉') &&
        assert(errors.length === 0, `slow: 有报错 ${errors[0] ?? ''}`),
    }
    console.log('fallback slow-abort:', JSON.stringify(out.slowAbort.pass), 'glbAtExit=', beforeExit)
    await page.close()
  }

  // 5) 3D 开着 + GLB 还在飞的时候切场景：App 的换场 effect 会把 view3d 关掉，
  //    Scene3D 必须干净卸载，晚到的 GLB 必须自释放
  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    const baseline = await page.evaluate(() => document.querySelectorAll('canvas').length)
    await page.route('**/models/warehouse-ext.glb', async (route) => {
      await new Promise((done) => setTimeout(done, 3000))
      await route.continue().catch(() => {})
    })
    const enter = await enter3D(page)
    const before = await page.evaluate(() => ({
      scene: document.querySelector('.scene')?.dataset.scene ?? null,
      glb: document.querySelector('.scene3d')?.dataset.glb ?? null,
      canvases: document.querySelectorAll('canvas').length,
    }))
    // 换场前装一个 MutationObserver：记录 .scene3d 的每一次插入/移除，
    // 用来验证「App 的 view3d 复位 effect 会不会先多挂一次 3D」
    await page.evaluate(() => {
      window.__mut = []
      const snapshot = () => ({
        t: Math.round(performance.now()),
        scene: document.querySelector('.scene')?.dataset.scene ?? null,
        scene3d: document.querySelectorAll('.scene3d').length,
        canvases: document.querySelectorAll('canvas').length,
      })
      window.__mut.push({ kind: 'start', ...snapshot() })
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const touched = [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('.scene3d, canvas') || node.querySelector?.('.scene3d, canvas')),
          )
          if (touched) window.__mut.push({ kind: 'scene3d', ...snapshot() })
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      window.__mutObserver = observer
    })
    // 选一个选项 → 继续 → 换场（App 会在换场后把 view3d 复位）
    let switched = null
    try {
      await page.locator('.choice').first().click()
      await page.waitForTimeout(700)
      await page.locator('.continue').click()
      await page.waitForFunction(
        (id) => {
          const node = document.querySelector('.scene')
          return node && node.dataset.scene !== id
        },
        before.scene,
        { timeout: 15000 },
      )
      switched = await page.evaluate(() => document.querySelector('.scene')?.dataset.scene ?? null)
    } catch (error) {
      switched = `switch-failed: ${String(error).slice(0, 120)}`
    }
    await page.waitForTimeout(1200)
    const mutations = await page.evaluate(() => {
      window.__mutObserver?.disconnect()
      return window.__mut
    })
    const afterSwitch = await page.evaluate(() => ({
      scene: document.querySelector('.scene')?.dataset.scene ?? null,
      scene3d: document.querySelectorAll('.scene3d').length,
      canvases: document.querySelectorAll('canvas').length,
      sceneBody: Boolean(document.querySelector('.scene-body')),
      toggle: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('3D 视角')),
    }))
    await page.waitForTimeout(3500) // 等那条延迟的 GLB 落地
    const later = await page.evaluate(() => ({
      scene3d: document.querySelectorAll('.scene3d').length,
      canvases: document.querySelectorAll('canvas').length,
      sceneBody: Boolean(document.querySelector('.scene-body')),
    }))
    out.sceneSwitch = {
      baseline,
      enter,
      before,
      switched,
      afterSwitch,
      later,
      mutations,
      errors,
      net,
      shot: await shot(page, 'switch-scene.png'),
      pass:
        assert(typeof switched === 'string' && switched !== sceneId && !switched.startsWith('switch-failed'), `切场没成功：${switched}`) &&
        assert(afterSwitch.scene3d === 0, '切场后 .scene3d 残留') &&
        assert(afterSwitch.canvases === baseline, `切场后 canvas ${afterSwitch.canvases} ≠ 基线 ${baseline}`) &&
        assert(later.scene3d === 0 && later.canvases === baseline, '晚到的 GLB 又挂回了场景') &&
        assert(errors.length === 0, `切场过程有报错 ${errors[0] ?? ''}`),
    }
    console.log('scene-switch:', JSON.stringify({ switched, afterSwitch, later }), 'pass=', out.sceneSwitch.pass)
    await page.close()
  }

  return out
}

async function suiteCycles(browser) {
  const errors = []
  const net = []
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  attach(page, errors, net)
  await enterScene(page, sceneId)
  const baseline = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    heapMB: performance.memory ? Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)) : null,
  }))

  const trail = []
  for (let i = 0; i < cycles; i += 1) {
    const enter = await enter3D(page)
    await page.waitForTimeout(450)
    const inside = await readStats(page)
    const exit = await exit3D(page)
    trail.push({
      i,
      firstFrameMs: enter.firstFrameMs,
      glb: inside?.glb ?? null,
      fps: inside?.fps ?? 0,
      calls: inside?.calls ?? 0,
      tris: inside?.tris ?? 0,
      canvasesIn3D: inside?.canvases ?? null,
      canvasesAfterExit: exit.canvases,
      heapMB: inside?.heapMB ?? null,
    })
  }
  const finalState = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    scene3d: document.querySelectorAll('.scene3d').length,
    heapMB: performance.memory ? Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)) : null,
    bodyText: Boolean(document.querySelector('.scene-body')),
  }))

  // WEBGL_lose_context：丢了之后必须安全回退，恢复了必须自己接上
  const enterLast = await enter3D(page)
  const lost = await page.evaluate(async () => {
    const canvas = document.querySelector('.scene3d canvas')
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
    if (!gl) return { ok: false, reason: 'no-context' }
    const ext = gl.getExtension('WEBGL_lose_context')
    if (!ext) return { ok: false, reason: 'no-extension' }
    window.__loseExt = ext
    ext.loseContext()
    await new Promise((done) => setTimeout(done, 600))
    const host = document.querySelector('.scene3d')
    return {
      ok: true,
      dataGl: host?.dataset.gl ?? null,
      canvasVisibility: canvas.style.visibility,
      fpsAfterLoss: host?.dataset.fps ?? null,
    }
  })
  const lostShot = await shot(page, 'context-lost.png')
  const restored = await page.evaluate(async () => {
    const ext = window.__loseExt
    if (!ext) return { ok: false }
    ext.restoreContext()
    await new Promise((done) => setTimeout(done, 1600))
    const host = document.querySelector('.scene3d')
    return {
      ok: true,
      dataGl: host?.dataset.gl ?? null,
      fps: Number(host?.dataset.fps ?? 0),
      canvasVisibility: document.querySelector('.scene3d canvas')?.style.visibility ?? null,
      canvases: document.querySelectorAll('canvas').length,
    }
  })
  const restoredShot = await shot(page, 'context-restored.png')

  const heapGrowth = finalState.heapMB !== null && baseline.heapMB !== null ? Number((finalState.heapMB - baseline.heapMB).toFixed(1)) : null
  return {
    baseline,
    cycles,
    trail,
    finalState,
    cycleAssertions: {
      canvasLeak: assert(finalState.canvases === baseline.canvases, `开关 ${cycles} 次后 canvas 数 ${finalState.canvases} ≠ 基线 ${baseline.canvases}`),
      scene3dLeak: assert(finalState.scene3d === 0, `.scene3d 残留 ${finalState.scene3d}`),
      bodyAlive: assert(finalState.bodyText, '开关后正文消失'),
      noErrors: assert(errors.length === 0, `开关过程有报错：${errors[0] ?? ''}`),
    },
    heapGrowthMB: heapGrowth,
    contextLoss: {
      enter: enterLast,
      lost,
      restored,
      shots: [lostShot, restoredShot],
      pass:
        assert(lost.ok && lost.dataGl === 'lost', `lose_context 后 data-gl=${lost.dataGl}`) &&
        assert(lost.canvasVisibility === 'hidden', `lose_context 后 canvas visibility=${lost.canvasVisibility}`) &&
        assert(restored.ok && restored.dataGl === 'restored', `restore 后 data-gl=${restored.dataGl}`) &&
        assert(restored.fps > 0, `restore 后没有出帧（fps=${restored.fps}）`),
    },
    errors,
    net,
  }
}

async function suitePerf(browser) {
  const out = {}
  const errors = []
  const net = []

  // 1600×1000 桌面
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    // 空转基线：不开 3D 时这台机器/这个无头浏览器能把 rAF 跑到多少，用来判断 3D 花了多少
    const baselineFps = await measureFps(page, 2000)
    const enter = await enter3D(page)
    await page.waitForTimeout(1200)
    const fps = await measureFps(page, 3000)
    const stats = await readStats(page)
    out.desktop1600 = { baselineFps, enter, fps, stats, shot: await shot(page, 'perf-1600x1000.png') }

    // resize：宽度变了缓冲区要跟着变
    await page.setViewportSize({ width: 1000, height: 720 })
    await page.waitForTimeout(700)
    const afterResize = await readStats(page)
    out.resize = {
      from: stats?.buffer ?? null,
      to: afterResize?.buffer ?? null,
      pass: assert(
        afterResize?.buffer && Math.abs(afterResize.buffer.width - 1000) <= 2 && Math.abs(afterResize.buffer.height - 720) <= 2,
        `resize 后缓冲区 ${afterResize?.buffer?.width}×${afterResize?.buffer?.height}，预期 1000×720`,
      ),
    }
    // 窗口缩到 <700：App 会自动退出 3D
    await page.setViewportSize({ width: 680, height: 720 })
    await page.waitForTimeout(900)
    out.shrinkBelow700 = {
      scene3d: await page.evaluate(() => document.querySelectorAll('.scene3d').length),
      canvases: await page.evaluate(() => document.querySelectorAll('canvas').length),
    }
    out.shrinkBelow700.pass = assert(out.shrinkBelow700.scene3d === 0, '窗口缩到 680px 后 3D 没有自动卸载')
    await page.close()
  }

  // 窄窗（700—1000px 仍允许 3D）：看 64 m 立面还能不能把铁门留住
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    await enter3D(page)
    await settleGlb(page)
    await page.waitForTimeout(800)
    out.narrow900 = {
      stats: await readStats(page),
      shot: await shot(page, 'perf-900x1000.png'),
    }
    await page.close()
  }

  // 390×844 手机：按设计不出 3D 按钮，量 2.5D
  {    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    const toggle = await page.getByRole('button', { name: '3D 视角' }).isVisible().catch(() => false)
    const fps = await measureFps(page, 2500)
    out.mobile390 = {
      toggleVisible: toggle,
      fps,
      canvases: await page.evaluate(() => document.querySelectorAll('canvas').length),
      dpr: await page.evaluate(() => window.devicePixelRatio),
      shot: await shot(page, 'perf-390x844.png'),
      pass: assert(toggle === false, '390px 宽仍显示 3D 按钮'),
    }
    await page.close()
  }

  // 4× CPU 降频（低端机模拟）
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
    attach(page, errors, net)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await enterScene(page, sceneId)
    const enter = await enter3D(page, { timeout: 40000 })
    await page.waitForTimeout(1200)
    const fps = await measureFps(page, 3000)
    const stats = await readStats(page)
    out.cpu4x = {
      enter,
      fps,
      stats,
      shot: await shot(page, 'perf-cpu4x.png'),
      usable: fps.fps >= 24,
      pass: assert(fps.fps >= 24, `4× 降频下 fps=${fps.fps} < 24`),
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await page.close()
  }

  // DPR 上限：deviceScaleFactor=3 → 缓冲区最多 2×
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 3 })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    await enter3D(page)
    await page.waitForTimeout(700)
    const buffer = await page.evaluate(() => {
      const canvas = document.querySelector('.scene3d canvas')
      return canvas ? { width: canvas.width, height: canvas.height, cssW: canvas.clientWidth, dpr: window.devicePixelRatio } : null
    })
    out.dprCap = { buffer, ratio: buffer ? Number((buffer.width / buffer.cssW).toFixed(3)) : null }
    out.dprCap.pass = assert(out.dprCap.ratio !== null && out.dprCap.ratio <= 2.001, `DPR 上限失效：缓冲区 ${out.dprCap.ratio}×`)
    await page.close()
  }

  return { ...out, errors, net }
}

/**
 * 等 GLB 从 loading 变成 ready/failed —— 首帧比 GLB 早到是设计如此（先出灯光地面），
 * 所以读完首帧还必须单独等一次加载态，否则会读到一半状态。
 */
async function settleGlb(page, timeout = 15000) {
  try {
    await page.waitForFunction(
      () => {
        const host = document.querySelector('.scene3d')
        if (!host) return true
        const status = host.dataset.glb
        return status !== undefined && status !== 'loading'
      },
      null,
      { timeout, polling: 200 },
    )
  } catch {
    /* 超时就算了，让上层断言去报 */
  }
  return page.evaluate(() => document.querySelector('.scene3d')?.dataset.glb ?? null)
}

/** 找一个空闲端口 */
const freePort = () =>
  new Promise((done) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })

async function waitHttp(target, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(target)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  return false
}

async function suiteDeploy(browser) {
  const out = { dist: {}, servers: {} }

  // dist 里有没有 GLB，且与 public 里那份字节一致
  const distGlb = path.join(root, 'dist/models/warehouse-ext.glb')
  const pubGlb = path.join(root, 'public/models/warehouse-ext.glb')
  try {
    const [d, p] = await Promise.all([readFile(distGlb), readFile(pubGlb)])
    out.dist.glb = { bytes: d.length, sameAsPublic: Buffer.compare(d, p) === 0 }
  } catch (error) {
    out.dist.glb = { error: String(error).slice(0, 160) }
  }
  out.dist.glbCopied = assert(out.dist.glb.bytes > 0 && out.dist.glb.sameAsPublic, 'dist/models/warehouse-ext.glb 缺失或与 public 不一致')

  // 1) preview（就是 --url 指向的服务器）
  {
    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    await enterScene(page, sceneId)
    const enter = await enter3D(page)
    await settleGlb(page)
    const stats = await readStats(page)
    const status = await fetch(new URL('models/warehouse-ext.glb', url)).then((r) => r.status)
    out.servers.preview = { url, glbStatus: status, enter, stats: { calls: stats?.calls, tris: stats?.tris, glb: stats?.glb }, errors }
    out.servers.preview.pass = assert(status === 200 && stats?.glb === 'ready', `preview: GLB ${status} / data-glb=${stats?.glb}`)
    await page.close()
  }

  // 2) dev server（vite，未打包，路径走 /models/...）
  {
    const port = await freePort()
    const dev = spawn(`npx vite --port ${port} --strictPort --host 127.0.0.1`, { cwd: root, stdio: 'ignore', shell: true })
    const devUrl = `http://127.0.0.1:${port}/`
    const ready = await waitHttp(devUrl, 45000)
    const errors = []
    const net = []
    let page = null
    if (ready) {
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      attach(page, errors, net)
      const attempt = await enterSceneAnd3D(page, devUrl, sceneId, { attempts: 3, base: devUrl })
      await settleGlb(page)
      const status = await fetch(`${devUrl}models/warehouse-ext.glb`).then((r) => r.status)
      out.servers.dev = {
        url: devUrl,
        glbStatus: status,
        attempts: attempt.attempts,
        attemptsLog: attempt.log,
        firstFrameMs: attempt.firstFrameMs ?? null,
        stats: { calls: attempt.stats?.calls, tris: attempt.stats?.tris, glb: attempt.stats?.glb },
        errors,
        net,
      }
      out.servers.dev.pass = assert(
        status === 200 && attempt.stats?.glb === 'ready',
        `dev: GLB ${status} / data-glb=${attempt.stats?.glb}（试了 ${attempt.attempts} 次）`,
      )
      if (page) await page.close()
    } else {
      out.servers.dev = { url: devUrl, error: 'vite 没起来' }
      assert(false, 'dev server 没起来')
    }
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore' })
    else dev.kill()
  }

  // 3) 子目录部署：dist 拷进 <tmp>/pkg/01_作品及成果文件/，python http.server 起在 <tmp>
  {
    const tmp = path.join(os.tmpdir(), `dsh-3d-deploy-${process.pid}`)
    const pkg = path.join(tmp, 'pkg', '01_作品及成果文件')
    await mkdir(pkg, { recursive: true })
    await cp(path.join(root, 'dist'), pkg, { recursive: true })
    // 子目录名带中文，正好顺带验证 URL 编码后的静态服务
    const subPath = '/pkg/01_作品及成果文件/'
    const subdir = await serveAndEnter(browser, tmp, subPath, sceneId)
    out.servers.subdir = subdir
    if (subdir.pass) assert(true, '')
  }

  return out
}

/**
 * 用 python http.server 把 tmp 目录起成静态站，再在 subPath 下走一遍「进场景 → 3D → GLB」。
 * 这台机器上 `C:\Program Files\python`（3.8.6）的 http.server 会在 socket.getfqdn() 上抛
 * UnicodeDecodeError（Windows 主机名解码问题），所以按 PYTHON → Anaconda 3.12 → PATH 顺序试。
 */
async function serveAndEnter(browser, tmp, subPath, id) {
  const candidates = [
    process.env.PYTHON,
    'C:\\Users\\26298\\Anaconda3\\envs\\spy\\python.exe',
    'C:\\Program Files\\python\\python.exe',
    'python3',
    'python',
  ].filter(Boolean)

  const tries = []
  for (const python of candidates) {
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const target = `${origin}${encodeURI(subPath)}`
    let serverErr = ''
    const server = spawn(python, ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: tmp, stdio: 'pipe' })
    server.stderr?.on('data', (chunk) => {
      serverErr += String(chunk)
    })
    const ready = await waitHttp(target, 8000)
    tries.push({ python, port, ready, serverErr: serverErr.slice(0, 160) })
    if (!ready) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      else server.kill()
      continue
    }

    const errors = []
    const net = []
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    attach(page, errors, net)
    const attempt = await enterSceneAnd3D(page, target, id, { attempts: 2, base: target })
    await settleGlb(page)
    const stats = await readStats(page)
    const glbUrl = new URL('models/warehouse-ext.glb', target).href
    const head = await fetch(glbUrl).then((r) => ({ status: r.status, bytes: Number(r.headers.get('content-length') ?? 0) }))
    const result = {
      python,
      url: target.replace(origin, ''),
      glbUrl: new URL(glbUrl).pathname,
      glbStatus: head.status,
      glbBytes: head.bytes,
      attempts: attempt.attempts,
      firstFrameMs: attempt.firstFrameMs ?? null,
      stats: { calls: stats?.calls, tris: stats?.tris, glb: stats?.glb },
      net,
      errors,
      shot: await shot(page, 'deploy-subdir.png'),
      tries,
    }
    result.pass =
      assert(head.status === 200 && head.bytes === 480860, `子目录: GLB ${head.status} / ${head.bytes} B`) &&
      assert(stats?.glb === 'ready', `子目录: data-glb=${stats?.glb}`) &&
      assert(errors.length === 0, `子目录: 有报错 ${errors[0] ?? ''}`)
    await page.close()
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
    else server.kill()
    return result
  }
  assert(false, `子目录: 没有可用的 python http.server（试过 ${tries.map((t) => t.python).join(', ')}）`)
  return { tries, pass: false }
}

// ---------------------------------------------------------------- 跑

const browser = await chromium.launch({ channel: 'chrome' })
const suites = suite === 'all' ? ['fallback', 'cycles', 'perf', 'deploy'] : [suite]
for (const name of suites) {
  const started = Date.now()
  console.log(`\n=== ${name} ===`)
  if (name === 'fallback') results.fallback = await suiteFallback(browser)
  if (name === 'cycles') results.cycles = await suiteCycles(browser)
  if (name === 'perf') results.perf = await suitePerf(browser)
  if (name === 'deploy') results.deploy = await suiteDeploy(browser)
  results[name].elapsedMs = Date.now() - started
}
await browser.close()

const report = {
  when: new Date().toISOString(),
  suite,
  url,
  sceneId,
  results,
  failures,
  pass: failures.length === 0,
}
const file = path.join(shots, `review-${suite}.json`)
await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\n${failures.length ? `未通过 ${failures.length} 项：` : '全部通过'}`)
for (const failure of failures) console.log(`  - ${failure}`)
console.log(`数据：${path.relative(root, file).replace(/\\/g, '/')}`)
process.exit(failures.length ? 1 : 0)
