import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { ai3d } from 'tencentcloud-sdk-nodejs/tencentcloud/services/ai3d/index.js'

const root = new URL('../../public/generated/', import.meta.url)
const jobs = new Map()
const port = Number(process.env.WORLDGEN_PORT || 8787)

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': 'http://127.0.0.1:5173' })
  response.end(JSON.stringify(body))
}

function client() {
  const secretId = process.env.TENCENTCLOUD_SECRET_ID
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY
  if (!secretId || !secretKey) throw new Error('未配置腾讯云密钥：请将 .env.example 复制为 .env 后在本机填写。')
  return new ai3d.v20250513.Client({ credential: { secretId, secretKey }, region: process.env.TENCENTCLOUD_REGION || 'ap-guangzhou' })
}

function normalizePrompt(prompt) {
  const forbidden = /尸体|血腥|人体实验|受害者特写|现代广告|文字|标语|军衔|真实人物对白/gu
  const clean = prompt.replace(forbidden, '').trim()
  if (!clean) throw new Error('提示词未保留可生成的表现层内容。')
  return clean
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function writeManifest(id, record) {
  const folder = join(root.pathname, id)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'provenance.json'), JSON.stringify(record, null, 2))
}

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  try {
    if (request.method === 'POST' && request.url === '/local-generation/jobs') {
      const input = await readBody(request)
      if (!input.sceneId || !input.prompt || !Array.isArray(input.factIds)) throw new Error('sceneId、prompt、factIds 为必填项。')
      const prompt = normalizePrompt(input.prompt)
      const cacheKey = createHash('sha256').update(JSON.stringify({ model: input.model || '3.1', prompt, factIds: input.factIds })).digest('hex').slice(0, 16)
      const id = `${input.sceneId}-${cacheKey}`
      const record = jobs.get(id)
      if (record) return send(response, 200, record)
      const service = client()
      const submitted = await service.SubmitHunyuanTo3DProJob({ Model: input.model || '3.1', Prompt: prompt, GenerateType: 'LowPoly', ResultFormat: 'GLB' })
      if (!submitted.JobId) throw new Error(`腾讯云未返回任务 ID（RequestId: ${submitted.RequestId || 'unknown'}）。`)
      const next = { id, cacheKey, sceneId: input.sceneId, factIds: input.factIds, prompt, model: input.model || '3.1', jobId: submitted.JobId, status: 'WAIT', requestId: submitted.RequestId, createdAt: new Date().toISOString() }
      jobs.set(id, next); await writeManifest(id, next); return send(response, 202, next)
    }
    const match = request.url?.match(/^\/local-generation\/jobs\/([\w-]+)$/u)
    if (request.method === 'GET' && match) {
      const record = jobs.get(match[1]); if (!record) return send(response, 404, { error: '未找到本次本地会话任务。' })
      if (record.status === 'DONE' || record.status === 'FAIL') return send(response, 200, record)
      const status = await client().QueryHunyuanTo3DProJob({ JobId: record.jobId })
      Object.assign(record, { status: status.Status || 'RUN', errorCode: status.ErrorCode, errorMessage: status.ErrorMessage, resultFiles: status.ResultFile3Ds, creditConsumed: status.ResultCreditConsumed, checkedAt: new Date().toISOString() })
      await writeManifest(record.id, record); return send(response, 200, record)
    }
    send(response, 404, { error: '未找到接口。' })
  } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : '未知错误' }) }
}).listen(port, '127.0.0.1', () => console.log(`Worldgen bridge: http://127.0.0.1:${port}`))
