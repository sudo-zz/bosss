#!/usr/bin/env node
/**
 * 招聘助手 · 本地只读展示服务（纯静态展示 + 自动监听刷新 + 安全检查更新）
 *
 * 设计理念：
 *   - 专配 WorkBuddy / 千问办公 / 豆包工作 等带浏览器分屏的桌面 Agent 使用
 *   - 网页本身只做「只读展示、筛选、统计、内嵌 PDF 跳页查看、Boss 在线简历本地查看」
 *   - 所有 Boss / Safari 操作由外部 Agent 通过 `boss` CLI 完成并写入 `~/.boss-cli/`
 *   - 服务通过 fs.watch + SSE (/api/events) 实时监听 `~/.boss-cli/` 变化，浏览器自动无感刷新
 *   - 新机器无本地数据时默认初始化为空（0 人），不预装任何候选人隐私数据
 *   - 只监听 127.0.0.1，不对外暴露
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
} from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RESTART_EXIT_CODE,
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdateStatus,
  installUpdateFromBase64,
  markRestartRequested,
  readAppVersionInfo,
  saveUpdateConfig,
} from '../../scripts/updater.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DIST = path.join(ROOT, 'desk', 'dist')
const BOSS_HOME = path.join(homedir(), '.boss-cli')
const RESUME_PDF_DIR = path.join(BOSS_HOME, 'resumes', 'pdf')
const RESUME_ONLINE_DIR = path.join(BOSS_HOME, 'resumes', 'online')
const RESUME_SCREENSHOT_DIR = path.join(BOSS_HOME, '.cache', 'resume-screenshots')
const RESUME_CACHE_DIR = path.join(BOSS_HOME, '.cache', 'resumes')
const SOURCING_DIR = path.join(BOSS_HOME, 'sourcing')
const LOCAL_EVAL_DIR = path.join(BOSS_HOME, 'eval')
const AVATAR_DIRS = [path.join(BOSS_HOME, 'avatars'), path.join(ROOT, 'web', 'avatars')]
const EVAL_ASSET_DIRS = [path.join(LOCAL_EVAL_DIR, 'assets'), path.join(ROOT, 'web', 'assets')]
const EVAL_PDF_DIRS = [
  RESUME_PDF_DIR,
  path.join(LOCAL_EVAL_DIR, 'pdfs'),
  path.join(ROOT, 'web', 'pdfs'),
  ...(process.env.EVAL_DIR ? [path.join(process.env.EVAL_DIR, 'pdfs')] : []),
]
const PORT = Number(process.env.DESK_PORT || 7788)

// 确保本机空目录结构存在（不写入任何样例候选人）
for (const dir of [BOSS_HOME, RESUME_PDF_DIR, RESUME_ONLINE_DIR, SOURCING_DIR, LOCAL_EVAL_DIR]) {
  mkdirSync(dir, { recursive: true })
}

/* ------------------------------------------------------------------ 常量与工具 */

const STAGE_META = [
  { key: 'new', label: '新线索', tone: 'gray' },
  { key: 'screened', label: '初筛通过', tone: 'blue' },
  { key: 'shortlisted', label: '进短名单', tone: 'blue' },
  { key: 'greeted', label: '已打招呼', tone: 'amber' },
  { key: 'replied', label: '已回复', tone: 'amber' },
  { key: 'interview', label: '已约面', tone: 'green' },
  { key: 'hold', label: '暂缓', tone: 'gray' },
  { key: 'rejected', label: '已淘汰', tone: 'red' },
]
const ALLOWED_STAGES = new Set(STAGE_META.map((s) => s.key))

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

function safeReadJson(filePath, fallback = null) {
  if (!filePath || !existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
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

function formatNow() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function safeJoin(base, relative) {
  const cleanRel = String(relative || '').replace(/^\/+/, '')
  const resolvedBase = path.resolve(base)
  const target = path.resolve(resolvedBase, cleanRel)
  if (target === resolvedBase || target.startsWith(resolvedBase + path.sep)) return target
  return null
}

function json(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function readJsonBody(req, maxBytes = 45 * 1024 * 1024) {
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

/* ------------------------------------------------------------------ 本地简历扫描 */

function scanLocalResumeMaps() {
  const pdfByName = new Map()
  const onlineByName = new Map()

  if (existsSync(RESUME_PDF_DIR)) {
    const files = readdirSync(RESUME_PDF_DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => ({ f, mtime: statSync(path.join(RESUME_PDF_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
    for (const { f } of files) {
      const base = f.replace(/\.pdf$/i, '')
      const key = base.replace(/-\d{10,}$/, '').trim()
      if (key) {
        pdfByName.set(key, f)
        pdfByName.set(safeFileBase(key), f)
      }
    }
  }

  if (existsSync(RESUME_ONLINE_DIR)) {
    for (const f of readdirSync(RESUME_ONLINE_DIR)) {
      if (!f.toLowerCase().endsWith('.json')) continue
      const key = f.replace(/\.json$/i, '').trim()
      if (key) {
        onlineByName.set(key, f)
        onlineByName.set(safeFileBase(key), f)
      }
    }
  }
  return { pdfByName, onlineByName }
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

/* ------------------------------------------------------------------ 数据聚合（支持空初始化 + 实时读取 ~/.boss-cli） */

function readSourcingSnapshots() {
  if (!existsSync(SOURCING_DIR)) return []
  const out = []
  for (const file of readdirSync(SOURCING_DIR)) {
    if (!file.endsWith('.json')) continue
    const snap = safeReadJson(path.join(SOURCING_DIR, file))
    if (!snap || !Array.isArray(snap.candidates)) continue
    const tab = normalizeSource(snap.tab)
    for (const c of snap.candidates) {
      if (!c?.name) continue
      out.push({
        ...c,
        sourceTab: tab,
        job: snap.job || '默认岗位',
        fetchedAt: snap.fetchedAt || '',
      })
    }
  }
  return out
}

function readEvalData() {
  // 1) 优先读取标准用户目录 ~/.boss-cli/eval/data.json（供 WorkBuddy 等 Agent 直接写入）
  const userEvalJson = path.join(LOCAL_EVAL_DIR, 'data.json')
  if (existsSync(userEvalJson)) {
    const parsed = safeReadJson(userEvalJson)
    if (parsed && Array.isArray(parsed.candidates)) {
      return {
        meta: parsed.meta || { total: parsed.candidates.length },
        positions: Array.isArray(parsed.positions) ? parsed.positions : [],
        statusMeta: parsed.statusMeta,
        candidates: parsed.candidates,
      }
    }
  }
  // 2) 兼容本机已有 web/data.js（开发机本地保留的 152 份评估）
  const repoEvalJs = path.join(ROOT, 'web', 'data.js')
  if (existsSync(repoEvalJs)) {
    try {
      const text = readFileSync(repoEvalJs, 'utf8')
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      if (parsed && Array.isArray(parsed.candidates)) return parsed
    } catch {
      /* ignore */
    }
  }
  // 3) 全新电脑默认为空
  return { meta: { total: 0 }, positions: [], candidates: [] }
}

function readQuota() {
  const raw = safeReadJson(path.join(BOSS_HOME, 'quota.json'))
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const counts = raw && raw.date === todayKey && raw.counts ? raw.counts : {}
  const limits = { greet: 20, send: 40, preview: 30 }
  const quotas = {}
  for (const [k, limit] of Object.entries(limits)) {
    const used = Number(counts[k] || 0)
    quotas[k] = { used, limit }
  }
  return { date: todayKey, mode: 'agent-cli', quotas }
}

function synthesizePipelineFromBossHome(evalData) {
  const tracker = safeReadJson(path.join(BOSS_HOME, 'tracker.json'), { candidates: {} })
  const inspect = safeReadJson(path.join(BOSS_HOME, 'unread-inspect.json'), { candidates: [] })
  const sourcing = readSourcingSnapshots()
  const { pdfByName, onlineByName } = scanLocalResumeMaps()

  const inspectByName = new Map()
  for (const c of inspect?.candidates || []) {
    if (c?.name) inspectByName.set(String(c.name).trim(), c)
  }

  const evalByName = new Map()
  const evalPdfByName = new Map()
  for (const e of evalData?.candidates || []) {
    if (e?.name) {
      evalByName.set(e.name, e.id)
      if (e.pdf) evalPdfByName.set(e.name, e.pdf)
    }
  }

  const resolvePdf = (name, t) => {
    if (t?.resumePdfPath && existsSync(t.resumePdfPath)) return path.basename(t.resumePdfPath)
    return pdfByName.get(name) || pdfByName.get(safeFileBase(name)) || ''
  }
  const resolveOnline = (name, t) => {
    if (t?.onlineResumePath && existsSync(t.onlineResumePath)) return path.basename(t.onlineResumePath)
    return onlineByName.get(name) || onlineByName.get(safeFileBase(name)) || ''
  }

  const posMap = new Map()
  const candidates = []
  const seenKeys = new Set()

  const ensurePos = (job) => {
    const clean = String(job || '默认岗位').trim() || '默认岗位'
    const id = clean.toLowerCase().replace(/\s+/g, '-')
    if (!posMap.has(id)) {
      posMap.set(id, { id, name: clean, short: clean.slice(0, 10) })
    }
    return id
  }

  for (const t of Object.values(tracker?.candidates || {})) {
    const name = String(t.name || '').trim()
    if (!name) continue
    const ins = inspectByName.get(name)
    const job = t.job || ins?.job || '默认岗位'
    seenKeys.add(`${name}::${job}`)
    const posId = ensurePos(job)
    const avatarFile = ins?.avatarLocalPath ? path.basename(ins.avatarLocalPath) : ''
    const messages = Array.isArray(ins?.recentMessages) ? ins.recentMessages.slice(-8) : []
    candidates.push({
      id: t.id || `cand:${name}::${job}`,
      geekId: t.geekId || '',
      name,
      job,
      positionId: posId,
      stage: ALLOWED_STAGES.has(t.stage) ? t.stage : 'screened',
      inferredStage: '',
      score: typeof t.score === 'number' ? t.score : undefined,
      summary: t.summary || ins?.summary || '',
      reason: t.reason || '',
      avatar: avatarFile || undefined,
      hasResumeImage: Boolean(ins?.friendImageLocalPaths?.length),
      source: normalizeSource(t.source),
      activeStatus: t.activeStatus || '',
      canGreet: t.canGreet,
      hasViewed: Boolean(t.hasViewed || t.onlineResumePath || t.resumeTextPath),
      resumePdfFile: resolvePdf(name, t),
      evalPdfPath: evalPdfByName.get(name) || '',
      onlineResumeFile: resolveOnline(name, t),
      resumeScreenshotFile: t.resumeScreenshotPath ? path.basename(t.resumeScreenshotPath) : '',
      evalId: evalByName.get(name) || '',
      facts: {
        age: ins?.age || undefined,
        exp: ins?.experience || undefined,
        edu: ins?.education || undefined,
        city: ins?.city || undefined,
        salary: ins?.salary || undefined,
        latestWork: ins?.latestWork || undefined,
      },
      messages,
      lastText: ins?.lastMessage || messages.at(-1)?.text || '',
      lastTime: ins?.lastTime || t.activeStatus || '',
      unread: Number(ins?.unread || 0),
      updatedAt: t.updatedAt || new Date().toISOString(),
      history: Array.isArray(t.history) ? t.history : [],
    })
  }

  for (const [name, ins] of inspectByName.entries()) {
    const job = ins.job || '未读线索'
    if (seenKeys.has(`${name}::${job}`)) continue
    seenKeys.add(`${name}::${job}`)
    const posId = ensurePos(job)
    const avatarFile = ins.avatarLocalPath ? path.basename(ins.avatarLocalPath) : ''
    const messages = Array.isArray(ins.recentMessages) ? ins.recentMessages.slice(-8) : []
    candidates.push({
      id: `unread:${name}::${job}`,
      geekId: '',
      name,
      job,
      positionId: posId,
      stage: 'new',
      inferredStage: '',
      summary: ins.summary || ins.lastMessage || '',
      reason: '',
      avatar: avatarFile || undefined,
      hasResumeImage: Boolean(ins.friendImageLocalPaths?.length),
      source: 'message',
      resumePdfFile: resolvePdf(name, null),
      evalPdfPath: evalPdfByName.get(name) || '',
      onlineResumeFile: resolveOnline(name, null),
      evalId: evalByName.get(name) || '',
      facts: {
        age: ins.age || undefined,
        exp: ins.experience || undefined,
        edu: ins.education || undefined,
        city: ins.city || undefined,
        salary: ins.salary || undefined,
        latestWork: ins.latestWork || undefined,
      },
      messages,
      lastText: ins.lastMessage || messages.at(-1)?.text || '',
      lastTime: ins.lastTime || '',
      unread: Number(ins.unread || 0),
      updatedAt: ins.inspectedAt || new Date().toISOString(),
    })
  }

  for (const s of sourcing) {
    const name = String(s.name || '').trim()
    const job = s.job || '默认岗位'
    if (!name || seenKeys.has(`${name}::${job}`)) continue
    seenKeys.add(`${name}::${job}`)
    const posId = ensurePos(job)
    const summaryParts = [
      ...String(s.baseInfo || '').split('/').map((x) => x.trim()).filter(Boolean),
      s.expect || '',
      s.salary || '',
      s.experience ? String(s.experience).split('；')[0]?.trim() || '' : '',
    ].filter(Boolean)
    candidates.push({
      id: s.geekId ? `geek:${s.geekId}` : `sourcing:${s.sourceTab}:${name}::${job}`,
      geekId: s.geekId || '',
      name,
      job,
      positionId: posId,
      stage: s.canGreet === false ? 'greeted' : 'new',
      inferredStage: '',
      summary: summaryParts.join('｜'),
      reason: s.advantage || (s.highlights?.length ? `优势：${s.highlights.slice(0, 4).join('、')}` : ''),
      highlights: Array.isArray(s.highlights) ? s.highlights.slice(0, 4) : [],
      source: normalizeSource(s.sourceTab),
      activeStatus: s.activeStatus || '',
      canGreet: s.canGreet !== false,
      hasViewed: Boolean(s.hasViewed),
      resumePdfFile: resolvePdf(name, null),
      evalPdfPath: evalPdfByName.get(name) || '',
      onlineResumeFile: resolveOnline(name, null),
      evalId: evalByName.get(name) || '',
      facts: {},
      messages: [],
      lastTime: s.activeStatus || '',
      updatedAt: s.fetchedAt || new Date().toISOString(),
    })
  }

  // 把 ~/.boss-cli/resumes/pdf/ 里尚未录入 tracker 的独立 PDF 简历也按文件名自动展示出来
  for (const [candidateName, pdfFile] of pdfByName.entries()) {
    // 跳过 safeFileBase 重复键（仅处理未见过的候选人）
    const alreadyExists = candidates.some((c) => c.name === candidateName || safeFileBase(c.name) === candidateName)
    if (alreadyExists) continue
    const posId = ensurePos('本地简历')
    candidates.push({
      id: `pdf:${candidateName}`,
      name: candidateName,
      job: '本地简历',
      positionId: posId,
      stage: 'new',
      inferredStage: '',
      summary: '已导入本地 PDF 简历，等待评估',
      reason: '',
      source: 'message',
      resumePdfFile: pdfFile,
      onlineResumeFile: resolveOnline(candidateName, null),
      evalId: evalByName.get(candidateName) || '',
      facts: {},
      messages: [],
      updatedAt: new Date().toISOString(),
    })
  }

  const byStage = Object.fromEntries(STAGE_META.map((s) => [s.key, 0]))
  const byJob = {}
  const bySource = { message: 0, recommend: 0, featured: 0 }
  const byJobAndSource = {}
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  let todayNew = 0

  for (const c of candidates) {
    const src = normalizeSource(c.source)
    byStage[c.stage] = (byStage[c.stage] || 0) + 1
    byJob[c.positionId] = (byJob[c.positionId] || 0) + 1
    bySource[src] = (bySource[src] || 0) + 1
    if (!byJobAndSource[c.positionId]) byJobAndSource[c.positionId] = { message: 0, recommend: 0, featured: 0 }
    byJobAndSource[c.positionId][src] = (byJobAndSource[c.positionId][src] || 0) + 1
    if (c.updatedAt && new Date(c.updatedAt) >= startOfDay) todayNew += 1
  }

  return {
    meta: {
      product: '招聘助手',
      generatedAt: formatNow(),
      generatedAtISO: new Date().toISOString(),
      stageMeta: STAGE_META,
      positions: [...posMap.values()],
    },
    stats: {
      total: candidates.length,
      byStage,
      byJob,
      bySource,
      byJobAndSource,
      todayNew,
      awaitingReply: (byStage.greeted || 0) + (byStage.shortlisted || 0),
      quota: readQuota(),
    },
    candidates,
  }
}

function loadData() {
  const evalData = readEvalData()
  const pipelineFile = path.join(ROOT, 'web', 'pipeline.json')
  let pipeline = null
  if (existsSync(pipelineFile)) {
    const parsed = safeReadJson(pipelineFile)
    if (parsed && Array.isArray(parsed.candidates)) {
      // 实时补挂本地新放入的 PDF / 在线简历，无需每次重跑 build.mjs
      const { pdfByName, onlineByName } = scanLocalResumeMaps()
      for (const c of parsed.candidates) {
        if (!c.resumePdfFile) {
          c.resumePdfFile = pdfByName.get(c.name) || pdfByName.get(safeFileBase(c.name)) || ''
        }
        if (!c.onlineResumeFile) {
          c.onlineResumeFile = onlineByName.get(c.name) || onlineByName.get(safeFileBase(c.name)) || ''
        }
      }
      pipeline = parsed
    }
  }
  if (!pipeline) {
    pipeline = synthesizePipelineFromBossHome(evalData)
  }
  return { pipeline, evalData, quota: readQuota() }
}

/* ------------------------------------------------------------------ SSE 实时文件监听 */

const sseClients = new Set()
let notifyTimer = null

/** 前端构建指纹：index.html 与 assets 的最新修改时间 + 文件数，重建后必然变化 */
function distToken() {
  try {
    const indexFile = path.join(DIST, 'index.html')
    const assetsDir = path.join(DIST, 'assets')
    let newest = statSync(indexFile).mtimeMs
    const files = existsSync(assetsDir) ? readdirSync(assetsDir) : []
    for (const file of files) {
      try {
        newest = Math.max(newest, statSync(path.join(assetsDir, file)).mtimeMs)
      } catch {
        /* 构建过程中文件可能被替换，忽略 */
      }
    }
    return `${Math.round(newest)}-${files.length}`
  } catch {
    return '0'
  }
}

let lastDistToken = distToken()

function broadcastReload(reason = 'change') {
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => {
    const payload = `event: update\ndata: ${JSON.stringify({ at: Date.now(), reason })}\n\n`
    for (const res of sseClients) {
      if (!res.writableEnded) res.write(payload)
    }
  }, 350)
}

function setupWatchers() {
  const dirsToWatch = [
    BOSS_HOME,
    RESUME_PDF_DIR,
    RESUME_ONLINE_DIR,
    SOURCING_DIR,
    LOCAL_EVAL_DIR,
    ...(existsSync(path.join(ROOT, 'web')) ? [path.join(ROOT, 'web')] : []),
  ]
  for (const dir of dirsToWatch) {
    if (!existsSync(dir)) continue
    try {
      watch(dir, { persistent: false }, (_event, filename) => {
        if (filename && String(filename).startsWith('.')) return
        broadcastReload(`${path.basename(dir)}/${filename || ''}`)
      })
    } catch {
      /* 某些系统/虚拟文件系统可能不支持 watch，仍可手动刷新 */
    }
  }
}

setupWatchers()

// 前端重新构建后自动通知浏览器整页重载，避免用户手动刷新才看到新界面
setInterval(() => {
  const token = distToken()
  if (token !== lastDistToken) {
    lastDistToken = token
    broadcastReload('build')
  }
}, 1500).unref?.()

/* ------------------------------------------------------------------ HTTP 服务 */

function isLoopbackOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  const pathname = decodeURIComponent(url.pathname)

  if (req.method !== 'GET' && req.method !== 'HEAD' && !isLoopbackOrigin(req)) {
    return json(res, 403, { error: '仅允许本机访问' })
  }

  // 本地静态媒体（头像 / 评估简历页 / PDF 简历 / 在线简历截图）
  if (pathname.startsWith('/media/avatars/')) {
    const rel = pathname.slice('/media/avatars/'.length)
    for (const base of AVATAR_DIRS) {
      const file = safeJoin(base, rel)
      if (file && existsSync(file)) return serveFile(res, file)
    }
    return json(res, 404, { error: 'not found' })
  }
  if (pathname.startsWith('/media/eval/')) {
    const rel = pathname.slice('/media/eval/'.length)
    for (const base of EVAL_ASSET_DIRS) {
      const file = safeJoin(base, rel)
      if (file && existsSync(file)) return serveFile(res, file)
    }
    return json(res, 404, { error: 'not found' })
  }
  if (pathname.startsWith('/media/resumes/pdf/')) {
    const rel = pathname.slice('/media/resumes/pdf/'.length)
    for (const base of EVAL_PDF_DIRS) {
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

  // API 路由（只读展示 + SSE 监听 + 安全检查更新）
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/ping') {
      const { currentVersion } = readAppVersionInfo(ROOT)
      return json(res, 200, { ok: true, mode: 'static-desk', version: currentVersion })
    }

    if (pathname === '/api/data') {
      return json(res, 200, loadData())
    }

    // 前端构建指纹：desk/dist 重新构建后 token 变化，浏览器据此自动重载
    if (pathname === '/api/build') {
      return json(res, 200, { token: distToken() })
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)
      sseClients.add(res)
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n')
      }, 25_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        sseClients.delete(res)
      })
      return
    }

    if (pathname === '/api/resume/pdfs' && req.method === 'GET') {
      return json(res, 200, { files: listLocalPdfResumes() })
    }

    if (pathname === '/api/resume/online' && req.method === 'GET') {
      const candidateName = String(url.searchParams.get('name') || '').trim()
      const explicitFile = String(url.searchParams.get('file') || '').trim()
      if (!candidateName && !explicitFile) return json(res, 400, { error: '缺少候选人姓名或文件名' })
      return json(res, 200, readLocalOnlineResume(candidateName, explicitFile))
    }

    if (pathname === '/api/update/status' && req.method === 'GET') {
      return json(res, 200, getUpdateStatus(ROOT))
    }

    if (pathname === '/api/update/config' && req.method === 'POST') {
      const body = await readJsonBody(req)
      saveUpdateConfig({
        ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
        ...(body.githubRepo !== undefined ? { githubRepo: body.githubRepo } : {}),
        ...(body.githubToken !== undefined ? { githubToken: body.githubToken } : {}),
      })
      return json(res, 200, { ok: true, status: getUpdateStatus(ROOT) })
    }

    if (pathname === '/api/update/check' && req.method === 'POST') {
      const body = await readJsonBody(req)
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
      const body = await readJsonBody(req)
      try {
        const result = await downloadAndInstallUpdate(ROOT, body)
        return json(res, 200, result)
      } catch (error) {
        return json(res, 500, { error: error?.message || '下载或安装更新失败' })
      }
    }

    if (pathname === '/api/update/upload' && req.method === 'POST') {
      const body = await readJsonBody(req, 45 * 1024 * 1024)
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

    return json(res, 404, { error: 'not found' })
  }

  // 静态前端资源：desk/dist
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(DIST, 'index.html'))
  }
  const asset = safeJoin(DIST, pathname.slice(1))
  if (asset && existsSync(asset) && statSync(asset).isFile()) return serveFile(res, asset)
  return serveFile(res, path.join(DIST, 'index.html'))
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`
  console.log(`招聘助手 · ${url}`)
  console.log(`  本地数据目录：${BOSS_HOME}（实时监听变化自动刷新）`)
  if (process.argv.includes('--open')) {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
})
