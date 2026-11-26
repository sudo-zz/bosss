#!/usr/bin/env node
/**
 * 伯乐台数据构建脚本
 *
 * 读取：
 *   ~/.boss-cli/tracker.json                招聘台账（阶段、分数、事件）
 *   ~/.boss-cli/inspect-xinmeiti.json       新媒体岗巡检快照（资料 + 对话 + 头像）
 *   dashboard/xinmeiti/candidates-scored.json  新媒体岗评分
 *   dashboard/inbox-50/candidates-scored.json  AI 岗评分
 *   ~/.boss-cli/quota.json                  今日配额
 *
 * 产出：
 *   web/data.js       识才模块（直接复用评估库的 data.js）
 *   web/pipeline.js   寻才模块
 *
 * 用法：node web/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOME = os.homedir();
const BOSS_DIR = path.join(HOME, '.boss-cli');
const EVAL_DIR = (process.env.EVAL_DIR || '').trim();

const STAGES = [
  { key: 'new', label: '新线索', tone: 'gray' },
  { key: 'screened', label: '初筛通过', tone: 'blue' },
  { key: 'shortlisted', label: '进短名单', tone: 'blue' },
  { key: 'greeted', label: '已打招呼', tone: 'amber' },
  { key: 'replied', label: '已回复', tone: 'amber' },
  { key: 'interview', label: '已约面', tone: 'green' },
  { key: 'hold', label: '暂缓', tone: 'gray' },
  { key: 'rejected', label: '已淘汰', tone: 'red' },
];

const DIM_META = {
  agent: { label: 'Agent / RAG', max: 35 },
  stack: { label: '全栈工程', max: 25 },
  aiTools: { label: 'AI Coding', max: 15 },
  biz: { label: 'B 端业务', max: 15 },
  platform: { label: '平台运营', max: 30 },
  content: { label: '内容生产', max: 25 },
  ai: { label: 'AI 工具', max: 20 },
  data: { label: '数据复盘', max: 15 },
  base: { label: '硬性条件', max: 10 },
};

const POSITIONS = [
  {
    id: 'ai-dev',
    name: 'AI 应用开发工程师',
    short: 'AI 应用开发',
    salary: '15-18K',
    city: '上海 · 奉贤',
    mode: '现场面试',
    match: /ai|应用开发|算法|后端|全栈/i,
  },
  {
    id: 'xmt',
    name: '新媒体运营专员（AI 方向）',
    short: '新媒体运营',
    salary: '7-10K',
    city: '上海 · 奉贤',
    mode: '现场面试',
    match: /新媒体|运营|内容|文案/i,
  },
];

const readJson = (p, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const posOf = (job = '') => {
  for (const p of POSITIONS) if (p.match.test(job)) return p.id;
  return 'ai-dev';
};

const basenameOf = (p) => (p ? path.basename(String(p)) : '');

/** 「长沙理工大学（继续教育学院）· 水利水电工程 · 本科」+ 学历「本科」→ 去掉重复段 */
function dedupeTokens(text, drop = ['本科', '硕士', '大专', '博士']) {
  const parts = String(text).split('·').map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const kept = [];
  for (const p of parts) {
    if (drop.includes(p) && kept.length) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    kept.push(p);
  }
  return kept.join(' · ');
}

/* ---------- 素材与评估库 ---------- */
function linkAssets() {
  const links = [
    ...(EVAL_DIR ? [[path.join(HERE, 'assets'), path.join(EVAL_DIR, 'assets')], [path.join(HERE, 'pdfs'), path.join(EVAL_DIR, 'pdfs')]] : []),
    [path.join(HERE, 'avatars'), path.join(BOSS_DIR, 'avatars')],
  ];
  for (const [link, target] of links) {
    try {
      const st = fs.lstatSync(link);
      if (st.isSymbolicLink() || st.isDirectory()) continue;
    } catch {
      /* 不存在则创建 */
    }
    if (!fs.existsSync(target)) continue;
    try {
      fs.symlinkSync(target, link, 'dir');
      console.log(`  ↗ 链接 ${path.basename(link)} → ${target}`);
    } catch (e) {
      console.log(`  ! 无法链接 ${link}: ${e.message}`);
    }
  }
}

function syncEvaluationData() {
  const src = EVAL_DIR ? path.join(EVAL_DIR, 'data.js') : '';
  const localFile = path.join(HERE, 'data.js');
  const readFrom = src && fs.existsSync(src) ? src : fs.existsSync(localFile) ? localFile : null;
  if (!readFrom) {
    console.log('  ! 本地暂无面试评估库数据（初始为空）');
    return null;
  }
  if (readFrom === src) {
    fs.copyFileSync(src, localFile);
  }
  const raw = fs.readFileSync(readFrom, 'utf8');
  const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  console.log(`  ✓ 面试评估数据 ${data.candidates.length} 人（${(raw.length / 1024).toFixed(0)}KB）`);
  return data;
}

/* ---------- 配额 ---------- */
function readQuota() {
  const fallbackLimits = { greet: 20, send: 40, preview: 30, deep_search_match: 20 };
  const raw = readJson(path.join(BOSS_DIR, 'quota.json'), { counts: {}, date: '' });
  try {
    const out = execFileSync(process.execPath, [path.join(REPO, 'dist/cli/index.js'), 'quota', '--json'], {
      cwd: REPO,
      timeout: 20000,
      encoding: 'utf8',
    });
    const j = JSON.parse(out);
    const quotas = {};
    for (const [k, v] of Object.entries(j.quotas || {})) {
      if (typeof v === 'object' && v && 'used' in v) quotas[k] = { used: v.used, limit: v.limit };
    }
    return {
      date: j.date || raw.date || '',
      mode: j.writeDefaultMode || 'dry-run',
      intervalSec: j.minWriteIntervalSec ?? 10,
      quotas: Object.keys(quotas).length ? quotas : fallbackLimits,
    };
  } catch {
    const quotas = {};
    for (const [k, limit] of Object.entries(fallbackLimits)) {
      quotas[k] = { used: (raw.counts || {})[k] || 0, limit };
    }
    return { date: raw.date || '', mode: 'dry-run', intervalSec: 10, quotas };
  }
}

/* ---------- 候选人合并 ---------- */
function normSummary(summary = '') {
  // 「22岁 / 2年 / 大专｜上海 · 实施顾问 4-6K」
  const [left = '', right = ''] = String(summary).split('｜');
  const parts = left.split('/').map((s) => s.trim()).filter(Boolean);
  const [city = '', roleSalary = ''] = right.split('·').map((s) => s.trim());
  return {
    age: parts[0] || '',
    exp: parts[1] || '',
    edu: parts[2] || '',
    city,
    salary: roleSalary,
    roleText: roleSalary,
  };
}

function normalizeSource(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'featured' || v === 'selected' || v === 'jingxuan' || v === '精选') return 'featured';
  if (v === 'recommend' || v === '推荐') return 'recommend';
  return 'message';
}

function safeFileBase(raw) {
  return (
    String(raw || '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'candidate'
  );
}

function scanLocalResumes() {
  const pdfDir = path.join(BOSS_DIR, 'resumes', 'pdf');
  const onlineDir = path.join(BOSS_DIR, 'resumes', 'online');
  const pdfByName = new Map();
  const onlineByName = new Map();

  if (fs.existsSync(pdfDir)) {
    const files = fs
      .readdirSync(pdfDir)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => ({ f, mtime: fs.statSync(path.join(pdfDir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    for (const { f: file } of files) {
      const base = file.replace(/\.pdf$/i, '');
      const key = base.replace(/-\d{10,}$/, '').trim();
      if (key) {
        pdfByName.set(key, file);
        pdfByName.set(safeFileBase(key), file);
      }
    }
  }
  if (fs.existsSync(onlineDir)) {
    for (const file of fs.readdirSync(onlineDir)) {
      if (!file.toLowerCase().endsWith('.json')) continue;
      const key = file.replace(/\.json$/i, '').trim();
      if (key) {
        onlineByName.set(key, file);
        onlineByName.set(safeFileBase(key), file);
      }
    }
  }
  return { pdfByName, onlineByName };
}

function loadSourcingSnapshots() {
  const dir = path.join(BOSS_DIR, 'sourcing');
  const items = [];
  if (!fs.existsSync(dir)) return items;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const snap = readJson(path.join(dir, file));
    if (!snap || !Array.isArray(snap.candidates)) continue;
    const tab = normalizeSource(snap.tab);
    for (const c of snap.candidates) {
      if (!c?.name) continue;
      items.push({ ...c, sourceTab: tab, job: snap.job || '默认岗位', fetchedAt: snap.fetchedAt || '' });
    }
  }
  return items;
}

function mergeCandidates({ tracker, scoredXmt, scoredAi, evalByName, evalPdfByName, sourcingItems, localResumes }) {
  const trackerByKey = new Map();
  const trackerByName = new Map();
  for (const t of Object.values(tracker.candidates || {})) {
    trackerByKey.set(`${t.name}::${t.job}`, t);
    if (!trackerByName.has(t.name)) trackerByName.set(t.name, t);
  }

  const rows = [];
  const usedTracker = new Set();

  const resolvePdfFile = (name, t) => {
    if (t?.resumePdfPath && fs.existsSync(t.resumePdfPath)) return path.basename(t.resumePdfPath);
    if (localResumes.pdfByName.has(name)) return localResumes.pdfByName.get(name);
    const safe = safeFileBase(name);
    if (localResumes.pdfByName.has(safe)) return localResumes.pdfByName.get(safe);
    return '';
  };

  const resolveOnlineFile = (name, t) => {
    if (t?.onlineResumePath && fs.existsSync(t.onlineResumePath)) return path.basename(t.onlineResumePath);
    if (localResumes.onlineByName.has(name)) return localResumes.onlineByName.get(name);
    const safe = safeFileBase(name);
    if (localResumes.onlineByName.has(safe)) return localResumes.onlineByName.get(safe);
    return '';
  };

  const pushFromScore = (c, job) => {
    const t = trackerByKey.get(`${c.name}::${job}`) || trackerByName.get(c.name);
    if (t) usedTracker.add(t.id);
    const facts = {
      age: c.ageStr || c.age || '',
      exp: c.expStr || '',
      edu: c.edu || '',
      city: c.expectCity || '',
      salary: c.salaryText || '',
      roleText: c.expectRoleSalary || '',
      latestWork: c.latestWork || '',
      school: dedupeTokens(c.school || ''),
    };
    rows.push({
      id: t?.id || `name:${c.name}::${job}`,
      geekId: t?.geekId || '',
      name: c.name,
      job,
      positionId: posOf(job),
      stage: t?.stage || 'new',
      inferredStage: inferStage(c.messages || [], t?.stage || 'new'),
      score: typeof t?.score === 'number' ? t.score : typeof c.score === 'number' ? c.score : null,
      tier: c.tier || '',
      tierLabel: c.tierLabel || '',
      summary: t?.summary || c.reason || '',
      reason: t?.reason || c.reason || '',
      facts,
      dimensions: c.dimensions || null,
      dimMeta: c.dimensions ? DIM_META : null,
      highlights: (c.highlights || []).slice(0, 4),
      risks: (c.risks || []).slice(0, 3),
      messages: (c.messages || []).slice(-8),
      lastText: lastFriendText(c.messages) || (c.msgText || '').slice(0, 60),
      lastTime: c.listTime || '',
      unread: c.unreadCount || 0,
      avatar: c.isDefaultAvatar ? '' : basenameOf(c.avatarFile || c.avatarLocalPath),
      hasResumeImage: (c.friendImageFiles || c.friendImageLocalPaths || []).length > 0,
      resumePdfFile: resolvePdfFile(c.name, t),
      evalPdfPath: evalPdfByName.get(c.name) || '',
      onlineResumeFile: resolveOnlineFile(c.name, t),
      resumeScreenshotFile: t?.resumeScreenshotPath ? basenameOf(t.resumeScreenshotPath) : '',
      activeStatus: t?.activeStatus || '',
      canGreet: t?.canGreet,
      hasViewed: Boolean(t?.hasViewed || t?.onlineResumePath || t?.resumeTextPath),
      links: c.links || [],
      source: 'message',
      evalId: evalByName.get(c.name) || '',
      createdAt: t?.createdAt || '',
      updatedAt: t?.updatedAt || '',
      history: t?.history || [],
    });
  };

  for (const c of scoredXmt) pushFromScore(c, '新媒体运营');
  for (const c of scoredAi) pushFromScore(c, 'ai应用开发工程师');

  const seen = new Set(rows.map((r) => `${r.name}::${r.job}`));
  for (const t of Object.values(tracker.candidates || {})) {
    if (usedTracker.has(t.id)) continue;
    const key = `${t.name}::${t.job}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: t.id,
      geekId: t.geekId || '',
      name: t.name,
      job: t.job,
      positionId: posOf(t.job),
      stage: t.stage || 'new',
      inferredStage: '',
      score: typeof t.score === 'number' ? t.score : null,
      tier: '',
      tierLabel: '',
      summary: t.summary || '',
      reason: t.reason || '',
      facts: normSummary(t.summary || ''),
      dimensions: null,
      dimMeta: null,
      highlights: [],
      risks: [],
      messages: [],
      lastText: t.summary || '',
      lastTime: '',
      unread: 0,
      avatar: '',
      hasResumeImage: false,
      resumePdfFile: resolvePdfFile(t.name, t),
      evalPdfPath: evalPdfByName.get(t.name) || '',
      onlineResumeFile: resolveOnlineFile(t.name, t),
      resumeScreenshotFile: t.resumeScreenshotPath ? basenameOf(t.resumeScreenshotPath) : '',
      activeStatus: t.activeStatus || '',
      canGreet: t.canGreet,
      hasViewed: Boolean(t.hasViewed || t.onlineResumePath || t.resumeTextPath),
      links: [],
      source: normalizeSource(t.source),
      evalId: evalByName.get(t.name) || '',
      createdAt: t.createdAt || '',
      updatedAt: t.updatedAt || '',
      history: t.history || [],
    });
  }

  // 合并推荐牛人 / 精选牛人快照中尚未进入 tracker 的候选人
  for (const s of sourcingItems) {
    const key = `${s.name}::${s.job}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = trackerByName.get(s.name);
    const summaryParts = [
      ...String(s.baseInfo || '').split('/').map((x) => x.trim()).filter(Boolean),
      s.expect || '',
      s.salary || '',
      s.experience ? String(s.experience).split('；')[0]?.trim() || '' : '',
    ].filter(Boolean);
    const summaryStr = summaryParts.join('｜');
    rows.push({
      id: s.geekId ? `geek:${s.geekId}` : `sourcing:${s.sourceTab}:${s.name}::${s.job}`,
      geekId: s.geekId || '',
      name: s.name,
      job: s.job,
      positionId: posOf(s.job),
      stage: s.trackedStage || (s.canGreet === false ? 'greeted' : 'new'),
      inferredStage: '',
      score: typeof s.trackedScore === 'number' ? s.trackedScore : null,
      tier: '',
      tierLabel: '',
      summary: summaryStr,
      reason: s.advantage || (s.highlights?.length ? `优势：${s.highlights.slice(0, 4).join('、')}` : ''),
      facts: normSummary(summaryStr),
      dimensions: null,
      dimMeta: null,
      highlights: (s.highlights || []).slice(0, 4),
      risks: [],
      messages: [],
      lastText: '',
      lastTime: s.activeStatus || '',
      unread: 0,
      avatar: '',
      hasResumeImage: false,
      resumePdfFile: resolvePdfFile(s.name, t),
      evalPdfPath: evalPdfByName.get(s.name) || '',
      onlineResumeFile: resolveOnlineFile(s.name, t),
      resumeScreenshotFile: t?.resumeScreenshotPath ? basenameOf(t.resumeScreenshotPath) : '',
      activeStatus: s.activeStatus || '',
      canGreet: s.canGreet !== false,
      hasViewed: Boolean(s.hasViewed || t?.onlineResumePath || t?.resumeTextPath),
      links: [],
      source: s.sourceTab,
      evalId: evalByName.get(s.name) || '',
      createdAt: s.fetchedAt || '',
      updatedAt: s.fetchedAt || '',
      history: t?.history || [],
    });
  }

  const stageRank = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
  rows.sort((a, b) => {
    const sa = stageRank[a.stage] ?? 99;
    const sb = stageRank[b.stage] ?? 99;
    if (sa !== sb) return sa - sb;
    return (b.score ?? -1) - (a.score ?? -1);
  });
  return rows;
}

function inferStage(messages = [], currentStage = 'new') {
  if (['hold', 'rejected', 'interview'].includes(currentStage)) return '';
  const last = messages[messages.length - 1];
  if (!last) return '';
  // 只有「我们此前发过消息」时，对方最后发言才算回复；否则那是他主动投递
  const hadOutbound = messages.slice(0, -1).some((m) => m.from === 'myself');
  if (last.from === 'myself' && currentStage !== 'replied') return 'greeted';
  if (last.from === 'friend' && hadOutbound && currentStage !== 'replied') return 'replied';
  return '';
}

function lastFriendText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.from === 'friend' && m.text) return String(m.text).replace(/\s+/g, ' ').slice(0, 60);
  }
  return '';
}

/* ---------- 统计 ---------- */
function buildStats(rows, quota) {
  const byStage = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  const byJob = Object.fromEntries(POSITIONS.map((p) => [p.id, 0]));
  const bySource = { message: 0, recommend: 0, featured: 0 };
  const byJobAndSource = {};
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let todayNew = 0;
  let withMessages = 0;
  let withScore = 0;
  for (const r of rows) {
    const src = normalizeSource(r.source);
    byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    byJob[r.positionId] = (byJob[r.positionId] || 0) + 1;
    bySource[src] = (bySource[src] || 0) + 1;
    if (!byJobAndSource[r.positionId]) byJobAndSource[r.positionId] = { message: 0, recommend: 0, featured: 0 };
    byJobAndSource[r.positionId][src] = (byJobAndSource[r.positionId][src] || 0) + 1;
    if (r.createdAt && new Date(r.createdAt) >= startOfDay) todayNew++;
    if (r.messages.length) withMessages++;
    if (typeof r.score === 'number') withScore++;
  }
  return {
    total: rows.length,
    byStage,
    byJob,
    bySource,
    byJobAndSource,
    todayNew,
    withMessages,
    withScore,
    awaitingReply: (byStage.greeted || 0) + (byStage.shortlisted || 0),
    quota,
  };
}

/* ---------- 主流程 ---------- */
console.log('招聘助手 · 数据构建');
console.log(`  仓库 ${REPO}`);
linkAssets();
const evalData = syncEvaluationData();

const tracker = readJson(path.join(BOSS_DIR, 'tracker.json'), { candidates: {} });
const scoredXmt = readJson(path.join(REPO, 'dashboard/xinmeiti/candidates-scored.json'), { candidates: [] }).candidates || [];
const scoredAi = readJson(path.join(REPO, 'dashboard/inbox-50/candidates-scored.json'), { candidates: [] }).candidates || [];
const sourcingItems = loadSourcingSnapshots();
const localResumes = scanLocalResumes();
const quota = readQuota();

console.log(
  `  台账 ${Object.keys(tracker.candidates || {}).length} 人 ｜ 新媒体评分 ${scoredXmt.length} ｜ AI 评分 ${scoredAi.length} ｜ 推荐/精选快照 ${sourcingItems.length}`,
);

const evalByName = new Map();
const evalPdfByName = new Map();
for (const c of (evalData && evalData.candidates) || []) {
  evalByName.set(c.name, c.id);
  if (c.pdf) evalPdfByName.set(c.name, c.pdf);
}
const rows = mergeCandidates({ tracker, scoredXmt, scoredAi, evalByName, evalPdfByName, sourcingItems, localResumes });
const linked = rows.filter((r) => r.evalId).length;
console.log(`  两边都有记录 ${linked} 人（可互相跳转）`);
const stats = buildStats(rows, quota);

const payload = {
  meta: {
    product: '招聘助手',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    generatedAtISO: new Date().toISOString(),
    stageMeta: STAGES,
    positions: POSITIONS.map(({ id, name, short, salary, city, mode }) => ({ id, name, short, salary, city, mode })),
    evalSource: EVAL_DIR,
    evalTotal: evalData ? evalData.candidates.length : 0,
  },
  stats,
  candidates: rows,
};

const js = `/* 由 web/build.mjs 生成，请勿手改；数据更新后重跑 node web/build.mjs */\nwindow.PIPELINE_DATA = ${JSON.stringify(payload, null, 2)};\n`;
fs.writeFileSync(path.join(HERE, 'pipeline.json'), JSON.stringify(payload), 'utf8');
console.log(`  ✓ 简历筛选数据 ${rows.length} 人（${(js.length / 1024).toFixed(0)}KB）`);
console.log(`    阶段：${STAGES.map((s) => `${s.label} ${stats.byStage[s.key] || 0}`).join(' · ')}`);
console.log(`    今日新增 ${stats.todayNew} ｜ 有对话 ${stats.withMessages} ｜ 有分数 ${stats.withScore}`);
console.log('完成。');
