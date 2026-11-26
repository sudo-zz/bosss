#!/usr/bin/env node
/**
 * 招聘助手 · 本地服务
 *
 * - 无账号系统：本机单实例直接使用，台账与数据默认共用
 * - 数据接口：读取 web/pipeline.json 与评估库，写操作走 boss CLI（参数数组，不拼 shell）
 * - AI 助手：SSE 流式。有 OPENAI_API_KEY / DEEPSEEK_API_KEY 时走真实模型，否则用本地数据助手
 *
 * 只监听 127.0.0.1，不对外暴露。
 */
import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  RESTART_EXIT_CODE,
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdateStatus,
  installUpdateFromBase64,
  markRestartRequested,
  saveUpdateConfig,
} from '../../packages/dsh-plugin-boss-recruiter/lib/updater.js'

const execFileAsync = promisify(execFile)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DIST = path.join(ROOT, 'desk', 'dist')
const EVAL_ASSETS = path.join(ROOT, 'web', 'assets')
const BOSS_HOME = path.join(homedir(), '.boss-cli')
const RESUME_PDF_DIR = path.join(BOSS_HOME, 'resumes', 'pdf')
const RESUME_ONLINE_DIR = path.join(BOSS_HOME, 'resumes', 'online')
const RESUME_SCREENSHOT_DIR = path.join(BOSS_HOME, '.cache', 'resume-screenshots')
const RESUME_CACHE_DIR = path.join(BOSS_HOME, '.cache', 'resumes')
const EVAL_PDF_DIRS = [
  path.join(ROOT, 'web', 'pdfs'),
  ...(process.env.EVAL_DIR ? [path.join(process.env.EVAL_DIR, 'pdfs')] : []),
]
const SEED_DIR = path.join(ROOT, 'data')
const AVATAR_DIRS = [path.join(BOSS_HOME, 'avatars'), path.join(ROOT, 'web', 'avatars')]
const PORT = Number(process.env.DESK_PORT || 7788)

mkdirSync(BOSS_HOME, { recursive: true })
mkdirSync(RESUME_PDF_DIR, { recursive: true })
mkdirSync(RESUME_ONLINE_DIR, { recursive: true })
mkdirSync(path.join(BOSS_HOME, 'sourcing'), { recursive: true })

/* 新机器首次运行：把仓库 data/ 里的台账、巡检快照恢复进 ~/.boss-cli（不覆盖已有文件） */
function seedBossHome() {
  if (!existsSync(SEED_DIR)) return
  const files = [
    ['tracker.json', 'tracker.json'],
    ['inspect-xinmeiti.json', 'inspect-xinmeiti.json'],
    ['quota.json', 'quota.json'],
  ]
  for (const [from, to] of files) {
    const src = path.join(SEED_DIR, from)
    const dest = path.join(BOSS_HOME, to)
    if (existsSync(src) && !existsSync(dest)) {
      copyFileSync(src, dest)
      console.log(`  ↺ 恢复数据 ${to}`)
    }
  }
  const jdSeed = path.join(SEED_DIR, 'jd')
  if (existsSync(jdSeed)) {
    mkdirSync(path.join(BOSS_HOME, 'jd'), { recursive: true })
    for (const name of readdirSync(jdSeed)) {
      const dest = path.join(BOSS_HOME, 'jd', name)
      if (!existsSync(dest)) copyFileSync(path.join(jdSeed, name), dest)
    }
  }
}

seedBossHome()

/* ------------------------------------------------------------------ 数据 */

let cache = { at: 0, pipeline: null, evalData: null }

function readPipeline() {
  const file = path.join(ROOT, 'web', 'pipeline.json')
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readEval() {
  const file = path.join(ROOT, 'web', 'data.js')
  const text = readFileSync(file, 'utf8')
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
}

async function rebuildPipeline() {
  await execFileAsync(process.execPath, [path.join(ROOT, 'web', 'build.mjs')], {
    cwd: ROOT,
    timeout: 180_000,
  })
  return loadData(true)
}

function loadData(force = false) {
  if (!force && cache.pipeline && Date.now() - cache.at < 5000) return cache
  cache = { at: Date.now(), pipeline: readPipeline(), evalData: readEval() }
  return cache
}

function readQuota() {
  const file = path.join(BOSS_HOME, 'quota.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function bossCli(args) {
  return execFileAsync(process.execPath, [path.join(ROOT, 'dist', 'cli', 'index.js'), ...args], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
  })
}

/* ------------------------------------------------------------------ AI */

const LOCAL_STAGES = [
  '正在读取本地台账',
  '按阶段与匹配分排序',
  '整理下一步动作',
]

function stageLabel(key, pipeline) {
  return pipeline.meta.stageMeta.find((s) => s.key === key)?.label || key
}

function topCandidates(pipeline, limit = 5) {
  return [...pipeline.candidates]
    .filter((c) => typeof c.score === 'number')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

let doctorCache = { at: 0, value: null }

function currentModelInfo() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY
  if (!apiKey) return { modelMode: 'local', modelName: '本地台账引擎' }
  const model = process.env.DESK_MODEL || (process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o-mini')
  return { modelMode: 'llm', modelName: model }
}

async function checkSafariDoctor(force = false) {
  if (!force && doctorCache.value && Date.now() - doctorCache.at < 20_000) {
    return doctorCache.value
  }
  const modelInfo = currentModelInfo()
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(ROOT, 'dist', 'cli', 'index.js'), 'doctor', '--json'],
      { cwd: ROOT, maxBuffer: 2 * 1024 * 1024, timeout: 12_000 },
    )
    const parsed = JSON.parse(stdout)
    const value = {
      ok: Boolean(parsed.safariRunning && parsed.jsAppleEventsEnabled && parsed.loggedInShell),
      safariRunning: Boolean(parsed.safariRunning),
      jsAppleEventsEnabled: Boolean(parsed.jsAppleEventsEnabled),
      loggedInShell: Boolean(parsed.loggedInShell),
      tabTitle: parsed.bossTab?.title || '',
      message: parsed.manualInterventionMessage || (parsed.loggedInShell ? '本机 Safari 已就绪' : '请先在 Safari 登录 Boss 直聘'),
      ...modelInfo,
      checkedAt: new Date().toISOString(),
    }
    doctorCache = { at: Date.now(), value }
    return value
  } catch (error) {
    const value = {
      ok: false,
      safariRunning: false,
      jsAppleEventsEnabled: false,
      loggedInShell: false,
      message: error.message || 'Safari 状态检测失败',
      ...modelInfo,
      checkedAt: new Date().toISOString(),
    }
    doctorCache = { at: Date.now(), value }
    return value
  }
}

function localCandidateAnswer(question, ctx) {
  const lines = []
  lines.push(`【候选人速评】${ctx.name}${typeof ctx.score === 'number' ? `（${ctx.score} 分）` : ''}｜${ctx.job || '岗位未标'}｜${ctx.stage || ''}`)
  const factParts = [ctx.facts?.age, ctx.facts?.exp, ctx.facts?.edu, ctx.facts?.city, ctx.facts?.salary].filter(Boolean)
  if (factParts.length) lines.push(`基础画像：${factParts.join(' · ')}`)
  if (ctx.summary) lines.push(`摘要：${ctx.summary}`)
  if (ctx.highlights?.length) {
    lines.push('亮点证据：')
    for (const h of ctx.highlights.slice(0, 4)) lines.push(`· ${h}`)
  }
  if (ctx.risks?.length) {
    lines.push('需优先核实风险：')
    for (const r of ctx.risks.slice(0, 3)) lines.push(`· ${r}`)
  }
  if (/面试题|追问|深挖/.test(question)) {
    lines.push('建议面试追问：')
    if (ctx.questions?.length) {
      ctx.questions.slice(0, 4).forEach((q, idx) => lines.push(`${idx + 1}. ${q}`))
    } else {
      lines.push('1. 请讲一个你从 0 到 1 负责的线上项目，架构选型和你在其中的独立代码边界是什么？')
      lines.push('2. 遇到线上报错、模型幻觉或效果不达预期时，你是如何定位并量化验证修复效果的？')
      lines.push('3. 确认通勤与现场面试安排（奉贤区南上海科创中心）及期望薪资底线。')
    }
  } else {
    lines.push('下一步建议：如确认可来奉贤现场技术面试，直接点左侧「发消息」使用标准要简历模板推进。')
  }
  return lines.join('\n')
}

function localAnswer(question, pipeline, evalData, contextCandidate) {
  if (
    contextCandidate &&
    (/此人|这位|这个|面试题|追问|深挖|分析|话术/.test(question) || question.includes(contextCandidate.name))
  ) {
    return localCandidateAnswer(question, contextCandidate)
  }
  const q = question.toLowerCase()
  const byStage = pipeline.stats.byStage || {}
  const total = pipeline.stats.total
  const top = topCandidates(pipeline, 5)
  const lines = []

  const isFollowUp = /跟进|催|回复|没回|待回|消息/.test(question)
  const isInterview = /约面|面试|安排|现场/.test(question)
  const isXmt = /新媒体|内容|小红书|抖音/.test(question)
  const isAi = /ai|agent|rag|技术|开发/.test(q)
  const isCount = /多少|几个|人数|统计|阶段/.test(question)
  const isWho = /谁|哪些|推荐|合适|优先/.test(question)

  if (isCount) {
    lines.push(`当前在库 ${total} 人：新线索 ${byStage.new || 0}、初筛通过 ${byStage.screened || 0}、短名单 ${byStage.shortlisted || 0}、已打招呼 ${byStage.greeted || 0}、已回复 ${byStage.replied || 0}、已约面 ${byStage.interview || 0}。`)
    lines.push(`另有暂缓 ${byStage.hold || 0} 人、已淘汰 ${byStage.rejected || 0} 人。`)
  }

  if (isFollowUp) {
    const waiting = pipeline.candidates
      .filter((c) => ['greeted', 'replied'].includes(c.stage) || c.inferredStage === 'replied')
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 6)
    lines.push(waiting.length ? '建议今天先跟进这几位（最近有往来、还没定下一步）：' : '目前没有待跟进的人，打招呼的 4 位都还没回。')
    for (const c of waiting) {
      lines.push(`· ${c.name}｜${c.job}｜${stageLabel(c.stage, pipeline)}${c.lastTime ? `｜最后消息 ${c.lastTime}` : ''}`)
    }
  }

  if (isInterview) {
    const pool = pipeline.candidates
      .filter((c) => ['shortlisted', 'screened', 'replied'].includes(c.stage) && (c.score || 0) >= 60)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5)
    lines.push(pool.length ? '可以约面的人选（分数 + 阶段都够）：' : '暂时没有够线的人，先把短名单补齐。')
    for (const c of pool) {
      lines.push(`· ${c.name}｜${c.score} 分｜${c.facts?.salary || '薪资未标'}｜${c.facts?.city || ''}`)
    }
    lines.push('约面前确认两件事：能否到奉贤现场、期望薪资是否在区间内。')
  }

  if (isXmt) {
    const list = pipeline.candidates.filter((c) => c.positionId === 'xmt')
    const withAi = list.filter((c) => (c.dimensions?.ai || 0) > 0)
    lines.push(`新媒体运营在库 ${list.length} 人，其中 AI 工具维度有分的 ${withAi.length} 人，同时具备平台与 AI 信号的很少。`)
    const best = [...list].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4)
    for (const c of best) lines.push(`· ${c.name}｜${c.score} 分｜${c.facts?.salary || ''}`)
  }

  if (isAi) {
    const list = pipeline.candidates.filter((c) => c.positionId === 'ai-dev')
    lines.push(`AI 应用开发在库 ${list.length} 人，短名单 ${list.filter((c) => c.stage === 'shortlisted').length} 人。`)
    const best = [...list].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4)
    for (const c of best) lines.push(`· ${c.name}｜${c.score} 分｜${c.facts?.latestWork || ''}`)
  }

  if (!lines.length) {
    lines.push(`现在有 ${total} 位候选人在库，其中 ${byStage.new || 0} 位还没打招呼。`)
    lines.push('匹配分最高的几位：')
    for (const c of top) lines.push(`· ${c.name}（${c.score} 分，${c.job}）— ${c.summary || ''}`)
    if (evalData.candidates.length > 0) {
      lines.push(`面试评估库里还有 ${evalData.candidates.length} 份做过深度评估的简历，可以切到「面试评估」按面试分排序。`)
    }
    if (isWho) lines.push('如果只想动最值得的 3 个人：优先短名单里分数最高、且薪资在区间内的。')
  }

  lines.push('')
  lines.push('需要我直接起草打招呼话术，或把这批人拖到「进短名单」，说一声就行。')
  return lines.join('\n')
}

async function streamAssistant(req, res, body, pipeline, evalData) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : []
  const question = String(body.message || '').trim() || (images.length ? '请帮我分析这张图片中的内容。' : '')
  const history = Array.isArray(body.history) ? body.history.slice(-8) : []
  const contextCandidate = body.contextCandidate && typeof body.contextCandidate === 'object' ? body.contextCandidate : null
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY
  const baseUrl =
    process.env.OPENAI_BASE_URL ||
    (process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1')
  const model = process.env.DESK_MODEL || (process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o-mini')

  try {
    if (apiKey) {
      send('thinking', {
        steps: contextCandidate ? ['读取当前候选人档案', '对照岗位与台账', '生成针对性建议'] : ['理解问题', '读取招聘台账', '生成建议'],
      })
      let enrichedFocused = contextCandidate
      if (contextCandidate?.name) {
        const localOnline = readLocalOnlineResume(contextCandidate.name)
        if (localOnline.found && localOnline.text) {
          enrichedFocused = { ...contextCandidate, onlineResumeExcerpt: localOnline.text.slice(0, 3000) }
        }
      }
      const summary = {
        total: pipeline.stats.total,
        byStage: pipeline.stats.byStage,
        bySource: pipeline.stats.bySource,
        top: topCandidates(pipeline, 8).map((c) => ({
          name: c.name,
          job: c.job,
          source: normalizeSource(c.source),
          stage: c.stage,
          score: c.score,
          summary: c.summary,
        })),
        evalCount: evalData.candidates.length,
        ...(enrichedFocused ? { focusedCandidate: enrichedFocused } : {}),
      }
      const userContent = images.length
        ? [
            { type: 'text', text: question },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType || 'image/png'};base64,${img.data}` },
            })),
          ]
        : question
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.4,
          messages: [
            {
              role: 'system',
              content:
                '你是招聘助手，回答必须简短、具体、可执行，用中文，不用客套话。只依据给定数据，不要编造候选人。如提供了 focusedCandidate 或图片，请优先结合其内容给出判断与追问。',
            },
            { role: 'system', content: `当前台账摘要：${JSON.stringify(summary)}` },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userContent },
          ],
        }),
      })
      if (!upstream.ok || !upstream.body) throw new Error(`上游模型返回 ${upstream.status}`)
      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const chunk = JSON.parse(payload)
              const delta = chunk.choices?.[0]?.delta?.content
              if (delta) send('delta', { text: delta })
            } catch {
              /* ignore keep-alive */
            }
          }
        }
      }
    } else {
      for (const step of LOCAL_STAGES) {
        send('thinking', { steps: [step] })
        await sleep(280 + Math.random() * 180)
      }
      const answer = localAnswer(question, pipeline, evalData, contextCandidate)
      send('thinking', { steps: ['已完成'] })
      for (const chunk of chunkText(answer)) {
        send('delta', { text: chunk })
        await sleep(18 + Math.random() * 26)
      }
    }
    send('done', { ok: true })
  } catch (error) {
    send('error', { message: error.message || '生成失败' })
  } finally {
    res.end()
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function chunkText(text) {
  const out = []
  for (let i = 0; i < text.length; i += 2) out.push(text.slice(i, i + 2))
  return out
}

/* ------------------------------------------------------------------ HTTP */

function json(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readJson(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = []
    let total = 0
    req.on('data', (d) => {
      total += d.length
      if (total > maxBytes) {
        req.destroy()
        return
      }
      chunks.push(d)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function serveFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || ext === '.pdf' ? 'no-cache' : 'public, max-age=3600',
  }
  if (ext === '.pdf') {
    headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`
  }
  res.writeHead(200, headers)
  res.end(readFileSync(filePath))
}

function safeFileBase(raw) {
  return (
    String(raw || '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'candidate'
  )
}

function normalizeSource(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'featured' || v === 'selected' || v === 'jingxuan' || v === '精选') return 'featured'
  if (v === 'recommend' || v === '推荐') return 'recommend'
  return 'message'
}

function listLocalPdfResumes() {
  if (!existsSync(RESUME_PDF_DIR)) return []
  return readdirSync(RESUME_PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((filename) => {
      const full = path.join(RESUME_PDF_DIR, filename)
      const st = statSync(full)
      const candidateHint = filename.replace(/\.pdf$/i, '').replace(/-\d{10,}$/, '')
      return {
        filename,
        candidateHint,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        url: `/media/resumes/pdf/${encodeURIComponent(filename)}`,
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function readLocalOnlineResume(candidateName, explicitFile = '') {
  const safeName = safeFileBase(candidateName)
  const tryReadJsonFile = (filePath) => {
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return null
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'))
      const screenshotFile = data.screenshotPath ? path.basename(data.screenshotPath) : ''
      const hasShot = screenshotFile && existsSync(path.join(RESUME_SCREENSHOT_DIR, screenshotFile))
      return {
        found: true,
        candidate: data.candidate || candidateName,
        capturedAt: data.capturedAt || statSync(filePath).mtime.toISOString(),
        method: data.method || 'local',
        text: String(data.text || ''),
        screenshotFile: hasShot ? screenshotFile : undefined,
        screenshotUrl: hasShot ? `/media/resumes/screenshots/${encodeURIComponent(screenshotFile)}` : undefined,
        fileName: path.basename(filePath),
        filePath,
      }
    } catch {
      return null
    }
  }

  if (explicitFile && existsSync(RESUME_ONLINE_DIR)) {
    const target = safeJoin(RESUME_ONLINE_DIR, path.basename(explicitFile))
    const res = tryReadJsonFile(target)
    if (res) return res
  }

  if (candidateName && existsSync(RESUME_ONLINE_DIR)) {
    const direct = safeJoin(RESUME_ONLINE_DIR, `${safeName}.json`)
    const res = tryReadJsonFile(direct)
    if (res) return res
    for (const f of readdirSync(RESUME_ONLINE_DIR)) {
      if (!f.endsWith('.json')) continue
      const item = tryReadJsonFile(path.join(RESUME_ONLINE_DIR, f))
      if (item && String(item.candidate || '').trim() === String(candidateName).trim()) {
        return item
      }
    }
  }

  if (candidateName && existsSync(RESUME_CACHE_DIR)) {
    const matches = readdirSync(RESUME_CACHE_DIR)
      .filter((f) => f.endsWith('.txt') && (f.startsWith(`${safeName}-`) || f.includes(candidateName)))
      .map((f) => ({ f, mtime: statSync(path.join(RESUME_CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (matches.length > 0) {
      const full = path.join(RESUME_CACHE_DIR, matches[0].f)
      return {
        found: true,
        candidate: candidateName,
        capturedAt: new Date(matches[0].mtime).toISOString(),
        method: 'cache-txt',
        text: readFileSync(full, 'utf8'),
        fileName: matches[0].f,
        filePath: full,
      }
    }
  }

  return { found: false, candidate: candidateName || '' }
}

function tryParseJson(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const idx = Math.max(trimmed.lastIndexOf('\n{'), trimmed.lastIndexOf('\n['))
    if (idx >= 0) {
      try {
        return JSON.parse(trimmed.slice(idx + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function safeJoin(base, relative) {
  const target = path.resolve(base, relative)
  return target.startsWith(path.resolve(base)) ? target : null
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const pathname = decodeURIComponent(url.pathname)

  // 只接受本机来源，拒绝跨站写请求
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin
    if (origin) {
      try {
        const host = new URL(origin).hostname
        if (!['127.0.0.1', 'localhost'].includes(host)) {
          return json(res, 403, { error: '仅允许本机访问' })
        }
      } catch {
        return json(res, 403, { error: '非法来源' })
      }
    }
  }

  if (pathname.startsWith('/media/avatars/')) {
    const rel = pathname.replace('/media/avatars/', '')
    for (const base of AVATAR_DIRS) {
      const file = safeJoin(base, rel)
      if (file && existsSync(file)) return serveFile(res, file)
    }
    return json(res, 404, { error: 'not found' })
  }
  if (pathname.startsWith('/media/eval/')) {
    const file = safeJoin(EVAL_ASSETS, pathname.replace('/media/eval/', ''))
    return file ? serveFile(res, file) : json(res, 400, { error: 'bad path' })
  }
  if (pathname.startsWith('/media/resumes/pdf/')) {
    const rel = pathname.slice('/media/resumes/pdf/'.length)
    for (const base of [RESUME_PDF_DIR, ...EVAL_PDF_DIRS]) {
      const file = safeJoin(base, rel)
      if (file && existsSync(file) && statSync(file).isFile()) return serveFile(res, file)
    }
    return json(res, 404, { error: '本地未找到该 PDF 简历文件' })
  }
  if (pathname.startsWith('/media/resumes/screenshots/')) {
    const rel = pathname.slice('/media/resumes/screenshots/'.length)
    const file = safeJoin(RESUME_SCREENSHOT_DIR, rel)
    return file && existsSync(file) ? serveFile(res, file) : json(res, 404, { error: 'not found' })
  }

  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/ping') return json(res, 200, { ok: true })

    if (pathname === '/api/doctor') {
      const force = url.searchParams.get('refresh') === '1'
      const status = await checkSafariDoctor(force)
      return json(res, 200, status)
    }

    if (pathname === '/api/models') {
      const info = currentModelInfo()
      return json(res, 200, {
        runtime: 'standalone',
        current: info.modelMode === 'llm' ? { provider: 'env', model: info.modelName } : null,
        providers: [],
      })
    }

    if (pathname === '/api/data') {
      const force = url.searchParams.get('refresh') === '1'
      const data = loadData(force)
      return json(res, 200, {
        pipeline: data.pipeline,
        evalData: data.evalData,
        quota: readQuota(),
      })
    }

    if (pathname === '/api/refresh' && req.method === 'POST') {
      try {
        await execFileAsync(process.execPath, [path.join(ROOT, 'web', 'build.mjs')], {
          cwd: ROOT,
          timeout: 180_000,
        })
      } catch (error) {
        return json(res, 500, { error: `重建数据失败：${error.message}` })
      }
      const data = loadData(true)
      return json(res, 200, { pipeline: data.pipeline, quota: readQuota() })
    }

    if (pathname === '/api/stage' && req.method === 'POST') {
      const body = await readJson(req)
      const name = String(body.name || '').trim()
      const stage = String(body.stage || '').trim()
      const job = String(body.job || '').trim()
      const score = Number(body.score)
      if (!name || !stage) return json(res, 400, { error: '缺少姓名或阶段' })
      const allowed = ['new', 'screened', 'shortlisted', 'greeted', 'replied', 'interview', 'hold', 'rejected']
      if (!allowed.includes(stage)) return json(res, 400, { error: '未知阶段' })
      const args = ['tracker', 'upsert', '--name', name, '--job', job || '未标注', '--stage', stage]
      if (Number.isFinite(score)) args.push('--score', String(Math.round(score)))
      args.push('--summary', '页面调整阶段', '--reason', '招聘助手 · 简历筛选', '--json')
      try {
        await bossCli(args)
      } catch (error) {
        return json(res, 500, { error: `写入台账失败：${error.stderr || error.message}` })
      }
      try {
        const data = await rebuildPipeline()
        return json(res, 200, { ok: true, pipeline: data.pipeline, quota: readQuota() })
      } catch (error) {
        return json(res, 500, { error: `重建台账失败：${error.message}` })
      }
    }

    if (pathname === '/api/send' && req.method === 'POST') {
      const body = await readJson(req)
      const name = String(body.name || '').trim()
      const text = String(body.text || '').trim()
      if (!name || !text) return json(res, 400, { error: '缺少收件人或内容' })
      if (text.length > 800) return json(res, 400, { error: '消息超过 800 字' })
      const quota = readQuota()
      const sendQuota = quota?.quotas?.send
      if (sendQuota && sendQuota.used >= sendQuota.limit) {
        return json(res, 429, { error: '今日发送额度已用完' })
      }
      try {
        const { stdout } = await bossCli([
          'send', '--to', name, '--strict', '-t', text, '--confirm', '--json',
        ])
        const data = await rebuildPipeline()
        return json(res, 200, {
          ok: true,
          result: stdout.slice(-2000),
          quota: readQuota(),
          pipeline: data.pipeline,
        })
      } catch (error) {
        return json(res, 500, { error: `发送失败：${error.stderr || error.message}` })
      }
    }

    if (pathname === '/api/resume/pdfs' && req.method === 'GET') {
      return json(res, 200, { files: listLocalPdfResumes() })
    }

    if (pathname === '/api/resume/upload-pdf' && req.method === 'POST') {
      const body = await readJson(req, 30 * 1024 * 1024)
      const candidateName = String(body.name || '').trim()
      const jobVal = String(body.job || '').trim()
      const geekIdVal = String(body.geekId || '').trim()
      const sourceVal = body.source ? normalizeSource(body.source) : ''
      let rawBase64 = String(body.dataBase64 || '').trim()
      if (!candidateName || !rawBase64) {
        return json(res, 400, { error: '缺少候选人姓名或 PDF 文件数据' })
      }
      if (rawBase64.startsWith('data:')) {
        const m = /^data:[^;]+;base64,(.+)$/s.exec(rawBase64)
        if (m) rawBase64 = m[1]
      }
      const buf = Buffer.from(rawBase64.replace(/\s+/g, ''), 'base64')
      if (buf.length < 10 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return json(res, 400, { error: '上传文件不是有效的 PDF 格式（缺少 %PDF- 文件头）' })
      }
      if (buf.length > 25 * 1024 * 1024) {
        return json(res, 413, { error: 'PDF 文件超过 25MB 限制' })
      }
      mkdirSync(RESUME_PDF_DIR, { recursive: true })
      const pdfFile = `${safeFileBase(candidateName)}-${Date.now()}.pdf`
      const pdfAbsPath = path.join(RESUME_PDF_DIR, pdfFile)
      writeFileSync(pdfAbsPath, buf)
      const cliArgs = ['tracker', 'upsert', '--name', candidateName, '--resume-pdf', pdfAbsPath, '--json']
      if (jobVal) cliArgs.push('--job', jobVal)
      if (geekIdVal) cliArgs.push('--geek-id', geekIdVal)
      if (sourceVal) cliArgs.push('--source', sourceVal)
      try {
        await bossCli(cliArgs)
        await rebuildPipeline()
      } catch {
        /* PDF 已落盘 */
      }
      const data = loadData(true)
      return json(res, 200, {
        ok: true,
        pdfFile,
        pdfUrl: `/media/resumes/pdf/${encodeURIComponent(pdfFile)}`,
        pdfPath: pdfAbsPath,
        pipeline: data.pipeline,
      })
    }

    if (pathname === '/api/resume/online' && req.method === 'GET') {
      const candidateName = String(url.searchParams.get('name') || '').trim()
      const explicitFile = String(url.searchParams.get('file') || '').trim()
      if (!candidateName && !explicitFile) return json(res, 400, { error: '缺少候选人姓名或文件名' })
      return json(res, 200, readLocalOnlineResume(candidateName, explicitFile))
    }

    if (pathname === '/api/resume/fetch' && req.method === 'POST') {
      const body = await readJson(req)
      const candidateName = String(body.name || '').trim()
      const geekIdVal = String(body.geekId || '').trim()
      const jobVal = String(body.job || '').trim()
      const sourceVal = normalizeSource(body.source)
      const screenshot = Boolean(body.screenshot)
      if (!candidateName && !geekIdVal) return json(res, 400, { error: '缺少候选人姓名或 geekId' })
      const quota = readQuota()
      const previewQuota = quota?.quotas?.preview
      if (previewQuota && previewQuota.used >= previewQuota.limit) {
        return json(res, 429, { error: '今日在线简历查看额度已用完' })
      }
      try {
        let stdout = ''
        if (sourceVal === 'recommend' || sourceVal === 'featured') {
          const args = ['preview']
          if (candidateName) args.push(candidateName)
          if (geekIdVal) args.push('--geek-id', geekIdVal)
          args.push('--tab', sourceVal)
          if (jobVal) args.push('--job', jobVal)
          if (screenshot) args.push('--screenshot')
          args.push('--json')
          stdout = (await bossCli(args)).stdout
        } else {
          await bossCli(['chat', candidateName, '--strict', '--json'])
          const args = ['action', 'resume', '--json']
          if (screenshot) args.push('--screenshot')
          stdout = (await bossCli(args)).stdout
        }
        const parsed = tryParseJson(stdout)
        const data = await rebuildPipeline()
        const savedFile = parsed?.onlineResumePath ? path.basename(parsed.onlineResumePath) : ''
        const resume = readLocalOnlineResume(candidateName, savedFile)
        return json(res, 200, {
          ok: true,
          resume,
          raw: parsed,
          quota: readQuota(),
          pipeline: data.pipeline,
        })
      } catch (error) {
        return json(res, 500, { error: `从 Boss 读取在线简历失败：${error.stderr || error.message}` })
      }
    }

    if (pathname === '/api/sourcing/sync' && req.method === 'POST') {
      const body = await readJson(req)
      const rawTab = String(body.tab || '').trim().toLowerCase()
      if (rawTab !== 'recommend' && rawTab !== 'featured') {
        return json(res, 400, {
          error: '仅支持从「推荐牛人 (recommend)」或「精选牛人 (featured)」拉取，暂不包含「最新」。',
        })
      }
      const jobVal = String(body.job || '').trim()
      const limit = Math.max(1, Math.min(50, Number(body.limit) || 20))
      const cliArgs = ['recommend']
      if (jobVal && jobVal !== 'all') cliArgs.push(jobVal)
      cliArgs.push('--tab', rawTab, '--limit', String(limit), '--sync-tracker', '--json')
      if (body.skipViewed !== false) cliArgs.push('--skip-viewed')
      if (body.skipColleague !== false) cliArgs.push('--skip-colleague')
      try {
        const { stdout } = await bossCli(cliArgs)
        const parsed = tryParseJson(stdout)
        const data = await rebuildPipeline()
        return json(res, 200, {
          ok: true,
          tab: rawTab,
          job: parsed?.job || jobVal || '',
          count: Array.isArray(parsed?.candidates) ? parsed.candidates.length : 0,
          fetched: parsed,
          pipeline: data.pipeline,
          quota: readQuota(),
        })
      } catch (error) {
        return json(res, 500, {
          error: `拉取${rawTab === 'featured' ? '精选牛人' : '推荐牛人'}失败：${error.stderr || error.message}`,
        })
      }
    }

    if (pathname === '/api/greet' && req.method === 'POST') {
      const body = await readJson(req)
      const candidateName = String(body.name || '').trim()
      const geekIdVal = String(body.geekId || '').trim()
      const jobVal = String(body.job || '').trim()
      const rawTab = String(body.tab || '').trim().toLowerCase()
      if (!candidateName && !geekIdVal) return json(res, 400, { error: '缺少候选人姓名或 geekId' })
      const quota = readQuota()
      const greetQuota = quota?.quotas?.greet
      if (greetQuota && greetQuota.used >= greetQuota.limit) {
        return json(res, 429, { error: '今日打招呼额度已用完' })
      }
      const cliArgs = ['greet']
      if (candidateName) cliArgs.push(candidateName)
      if (geekIdVal) cliArgs.push('--geek-id', geekIdVal)
      if (jobVal) cliArgs.push('--job', jobVal)
      if (rawTab === 'recommend' || rawTab === 'featured') cliArgs.push('--tab', rawTab)
      cliArgs.push('--confirm', '--json')
      try {
        const { stdout } = await bossCli(cliArgs)
        const data = await rebuildPipeline()
        return json(res, 200, {
          ok: true,
          result: tryParseJson(stdout) || stdout.slice(-2000),
          quota: readQuota(),
          pipeline: data.pipeline,
        })
      } catch (error) {
        return json(res, 500, { error: `打招呼失败：${error.stderr || error.message}` })
      }
    }

    if (pathname === '/api/update/status' && req.method === 'GET') {
      return json(res, 200, getUpdateStatus(ROOT))
    }

    if (pathname === '/api/update/config' && req.method === 'POST') {
      const body = await readJson(req)
      saveUpdateConfig({
        ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
        ...(body.githubRepo !== undefined ? { githubRepo: body.githubRepo } : {}),
        ...(body.githubToken !== undefined ? { githubToken: body.githubToken } : {}),
      })
      return json(res, 200, { ok: true, status: getUpdateStatus(ROOT) })
    }

    if (pathname === '/api/update/check' && req.method === 'POST') {
      const body = await readJson(req)
      try {
        const result = await checkForUpdate(ROOT, body)
        return json(res, 200, result)
      } catch (error) {
        return json(res, error?.needAuth ? 401 : 502, {
          error: error?.message || '检查更新失败',
          needAuth: Boolean(error?.needAuth),
        })
      }
    }

    if (pathname === '/api/update/install' && req.method === 'POST') {
      const body = await readJson(req)
      try {
        const result = await downloadAndInstallUpdate(ROOT, body)
        return json(res, 200, result)
      } catch (error) {
        return json(res, 500, { error: error?.message || '下载或安装更新失败' })
      }
    }

    if (pathname === '/api/update/upload' && req.method === 'POST') {
      const body = await readJson(req, 45 * 1024 * 1024)
      try {
        const result = installUpdateFromBase64(ROOT, body)
        return json(res, 200, result)
      } catch (error) {
        return json(res, 400, { error: error?.message || '离线更新包安装失败' })
      }
    }

    if (pathname === '/api/update/restart' && req.method === 'POST') {
      markRestartRequested()
      json(res, 200, { ok: true, restarting: true })
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE)
      }, 250)
      return
    }

    if (pathname === '/api/assistant' && req.method === 'POST') {
      const body = await readJson(req)
      const data = loadData(false)
      return streamAssistant(req, res, body, data.pipeline, data.evalData)
    }

    return json(res, 404, { error: 'not found' })
  }

  // 静态资源：desk/dist
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(DIST, 'index.html'))
  }
  const asset = safeJoin(DIST, pathname.slice(1))
  if (asset && existsSync(asset) && statSync(asset).isFile()) return serveFile(res, asset)
  // SPA 回退
  return serveFile(res, path.join(DIST, 'index.html'))
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`
  console.log(`招聘助手 · ${url}`)
  console.log('  账号：无（本机直接使用，数据共用）')
  console.log(`  模型：${process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY ? '已配置，走真实模型' : '未配置密钥，使用本地数据助手'}`)
  if (process.argv.includes('--open')) {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
})
