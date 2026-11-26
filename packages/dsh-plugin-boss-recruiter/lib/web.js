import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  RESTART_EXIT_CODE,
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdateStatus,
  installUpdateFromBase64,
  markRestartRequested,
  saveUpdateConfig,
} from './updater.js';

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
};

const STAGE_META = [
  { key: 'new', label: '新线索', color: '#64748b' },
  { key: 'screened', label: '初筛通过', color: '#0284c7' },
  { key: 'shortlisted', label: '短名单', color: '#4f46e5' },
  { key: 'greeted', label: '已打招呼', color: '#d97706' },
  { key: 'replied', label: '已回复', color: '#0d9488' },
  { key: 'interview', label: '已约面', color: '#059669' },
  { key: 'hold', label: '暂缓', color: '#71717a' },
  { key: 'rejected', label: '已淘汰', color: '#e11d48' },
];

const ALLOWED_STAGES = new Set(STAGE_META.map((s) => s.key));

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function normalizeIncomingImages(rawImages) {
  if (!Array.isArray(rawImages)) return [];
  const out = [];
  for (const item of rawImages.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    let mediaType = String(item.mediaType || '').trim().toLowerCase();
    let data = String(item.data || '').trim();
    if (data.startsWith('data:')) {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(data);
      if (m) {
        mediaType = m[1].toLowerCase();
        data = m[2].replace(/\s+/g, '');
      }
    }
    if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
    if (!ALLOWED_IMAGE_MIMES.has(mediaType) || !data) continue;
    out.push({
      mediaType,
      data,
      ...(item.name ? { name: String(item.name).slice(0, 120) } : {}),
    });
  }
  return out;
}

function safeJoin(base, rel) {
  const cleanRel = String(rel || '').replace(/^\/+/, '');
  const resolvedBase = path.resolve(base);
  const target = path.resolve(resolvedBase, cleanRel);
  if (target === resolvedBase || target.startsWith(resolvedBase + path.sep)) return target;
  return null;
}

function serveFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || ext === '.pdf' ? 'no-cache' : 'public, max-age=3600',
  };
  if (ext === '.pdf') {
    headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`;
  }
  res.writeHead(200, headers);
  res.end(readFileSync(filePath));
}

function safeFileBase(raw) {
  return (
    String(raw || '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'candidate'
  );
}

function normalizeSource(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'featured' || v === 'selected' || v === 'jingxuan' || v === '精选') return 'featured';
  if (v === 'recommend' || v === '推荐') return 'recommend';
  return 'message';
}

function scanLocalResumeMaps(repoPaths) {
  const pdfByName = new Map();
  const onlineByName = new Map();
  if (existsSync(repoPaths.resumePdfDir)) {
    const files = readdirSync(repoPaths.resumePdfDir)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => ({ f, mtime: statSync(path.join(repoPaths.resumePdfDir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    for (const { f } of files) {
      const base = f.replace(/\.pdf$/i, '');
      const key = base.replace(/-\d{10,}$/, '').trim();
      if (key) {
        pdfByName.set(key, f);
        pdfByName.set(safeFileBase(key), f);
      }
    }
  }
  if (existsSync(repoPaths.resumeOnlineDir)) {
    for (const f of readdirSync(repoPaths.resumeOnlineDir)) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const key = f.replace(/\.json$/i, '').trim();
      if (key) {
        onlineByName.set(key, f);
        onlineByName.set(safeFileBase(key), f);
      }
    }
  }
  return { pdfByName, onlineByName };
}

function listLocalPdfResumes(repoPaths, prefix) {
  if (!existsSync(repoPaths.resumePdfDir)) return [];
  return readdirSync(repoPaths.resumePdfDir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((filename) => {
      const full = path.join(repoPaths.resumePdfDir, filename);
      const st = statSync(full);
      const candidateHint = filename.replace(/\.pdf$/i, '').replace(/-\d{10,}$/, '');
      return {
        filename,
        candidateHint,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        url: `${prefix}/media/resumes/pdf/${encodeURIComponent(filename)}`,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readLocalOnlineResume(repoPaths, prefix, candidateName, explicitFile = '') {
  const onlineDir = repoPaths.resumeOnlineDir;
  const screenshotDir = repoPaths.resumeScreenshotDir;
  const safeName = safeFileBase(candidateName);

  const tryReadJsonFile = (filePath) => {
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return null;
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      const screenshotFile = data.screenshotPath ? path.basename(data.screenshotPath) : '';
      const hasShot = screenshotFile && existsSync(path.join(screenshotDir, screenshotFile));
      return {
        found: true,
        candidate: data.candidate || candidateName,
        capturedAt: data.capturedAt || statSync(filePath).mtime.toISOString(),
        method: data.method || 'local',
        text: String(data.text || ''),
        screenshotFile: hasShot ? screenshotFile : undefined,
        screenshotUrl: hasShot ? `${prefix}/media/resumes/screenshots/${encodeURIComponent(screenshotFile)}` : undefined,
        fileName: path.basename(filePath),
        filePath,
      };
    } catch {
      return null;
    }
  };

  if (explicitFile && existsSync(onlineDir)) {
    const target = safeJoin(onlineDir, path.basename(explicitFile));
    const res = tryReadJsonFile(target);
    if (res) return res;
  }

  if (candidateName && existsSync(onlineDir)) {
    const direct = safeJoin(onlineDir, `${safeName}.json`);
    const res = tryReadJsonFile(direct);
    if (res) return res;
    for (const f of readdirSync(onlineDir)) {
      if (!f.endsWith('.json')) continue;
      const item = tryReadJsonFile(path.join(onlineDir, f));
      if (item && String(item.candidate || '').trim() === String(candidateName).trim()) {
        return item;
      }
    }
  }

  // Fallback to legacy ~/.boss-cli/.cache/resumes/*.txt
  if (candidateName && existsSync(repoPaths.resumeCacheDir)) {
    const matches = readdirSync(repoPaths.resumeCacheDir)
      .filter((f) => f.endsWith('.txt') && (f.startsWith(`${safeName}-`) || f.includes(candidateName)))
      .map((f) => ({ f, mtime: statSync(path.join(repoPaths.resumeCacheDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (matches.length > 0) {
      const full = path.join(repoPaths.resumeCacheDir, matches[0].f);
      return {
        found: true,
        candidate: candidateName,
        capturedAt: new Date(matches[0].mtime).toISOString(),
        method: 'cache-txt',
        text: readFileSync(full, 'utf8'),
        fileName: matches[0].f,
        filePath: full,
      };
    }
  }

  return { found: false, candidate: candidateName || '' };
}

function isLoopbackOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Dynamically synthesize a clean Pipeline object straight from ~/.boss-cli/tracker.json
 * and ~/.boss-cli/unread-inspect.json when a fresh installation has no repo web/pipeline.json yet.
 */
function synthesizePipeline(svc) {
  const repoPaths = svc.resolveRepoPaths();
  const tracker = svc.readTracker();
  const inspect = svc.readUnreadInspect();
  const sourcing = typeof svc.readSourcingSnapshots === 'function' ? svc.readSourcingSnapshots() : [];
  const { pdfByName, onlineByName } = scanLocalResumeMaps(repoPaths);
  const inspectByName = new Map();
  if (Array.isArray(inspect?.candidates)) {
    for (const c of inspect.candidates) {
      if (c?.name) inspectByName.set(String(c.name).trim(), c);
    }
  }

  const resolvePdf = (name, t) => {
    if (t?.resumePdfPath) return path.basename(t.resumePdfPath);
    return pdfByName.get(name) || pdfByName.get(safeFileBase(name)) || '';
  };
  const resolveOnline = (name, t) => {
    if (t?.onlineResumePath) return path.basename(t.onlineResumePath);
    return onlineByName.get(name) || onlineByName.get(safeFileBase(name)) || '';
  };

  const posMap = new Map();
  const candidates = [];
  const seenKeys = new Set();

  for (const t of Object.values(tracker.candidates || {})) {
    const name = String(t.name || '未命名').trim();
    const ins = inspectByName.get(name);
    const job = t.job || ins?.job || '默认岗位';
    seenKeys.add(`${name}::${job}`);
    const posId = job.toLowerCase().replace(/\s+/g, '-');
    if (!posMap.has(posId)) {
      posMap.set(posId, { id: posId, name: job, short: job.slice(0, 8), count: 0 });
    }
    posMap.get(posId).count += 1;
    const avatarFile = ins?.avatarLocalPath ? path.basename(ins.avatarLocalPath) : undefined;
    const src = normalizeSource(t.source);
    candidates.push({
      id: t.id || `cand:${name}`,
      name,
      geekId: t.geekId || '',
      job,
      positionId: posId,
      stage: ALLOWED_STAGES.has(t.stage) ? t.stage : 'screened',
      inferredStage: '',
      score: typeof t.score === 'number' ? t.score : undefined,
      summary: t.summary || '',
      reason: t.reason || '',
      notes: t.notes || '',
      avatar: avatarFile,
      source: src,
      activeStatus: t.activeStatus || '',
      canGreet: t.canGreet,
      hasViewed: Boolean(t.hasViewed || t.onlineResumePath || t.resumeTextPath),
      resumePdfFile: resolvePdf(name, t),
      onlineResumeFile: resolveOnline(name, t),
      resumeScreenshotFile: t.resumeScreenshotPath ? path.basename(t.resumeScreenshotPath) : '',
      facts: {
        age: ins?.age || undefined,
        exp: ins?.experience || undefined,
        edu: ins?.education || undefined,
        city: ins?.city || undefined,
        salary: ins?.salary || undefined,
        latestWork: ins?.latestWork || undefined,
      },
      messages: Array.isArray(ins?.recentMessages) ? ins.recentMessages.slice(-8) : [],
      lastText: ins?.lastMessage || (Array.isArray(ins?.recentMessages) ? ins.recentMessages.at(-1)?.text : '') || '',
      unread: Number(ins?.unread || 0),
      lastTime: ins?.lastTime || t.activeStatus || undefined,
      updatedAt: t.updatedAt || new Date().toISOString(),
    });
  }

  // Also include newly inspected unread candidates not yet in tracker
  for (const [name, ins] of inspectByName.entries()) {
    const job = ins.job || '未读线索';
    if (seenKeys.has(`${name}::${job}`)) continue;
    seenKeys.add(`${name}::${job}`);
    const posId = job.toLowerCase().replace(/\s+/g, '-');
    if (!posMap.has(posId)) {
      posMap.set(posId, { id: posId, name: job, short: job.slice(0, 8), count: 0 });
    }
    posMap.get(posId).count += 1;
    const avatarFile = ins.avatarLocalPath ? path.basename(ins.avatarLocalPath) : undefined;
    candidates.push({
      id: `unread:${name}`,
      name,
      geekId: '',
      job,
      positionId: posId,
      stage: 'new',
      inferredStage: '',
      summary: ins.summary || ins.lastMessage || '',
      avatar: avatarFile,
      source: 'message',
      resumePdfFile: resolvePdf(name, null),
      onlineResumeFile: resolveOnline(name, null),
      facts: {
        age: ins.age || undefined,
        exp: ins.experience || undefined,
        edu: ins.education || undefined,
        city: ins.city || undefined,
        salary: ins.salary || undefined,
        latestWork: ins.latestWork || undefined,
      },
      messages: Array.isArray(ins.recentMessages) ? ins.recentMessages.slice(-8) : [],
      lastText: ins.lastMessage || (Array.isArray(ins.recentMessages) ? ins.recentMessages.at(-1)?.text : '') || '',
      unread: Number(ins.unread || 0),
      lastTime: ins.lastTime || undefined,
      updatedAt: ins.inspectedAt || new Date().toISOString(),
    });
  }

  // Also include sourcing snapshots (推荐牛人 / 精选牛人)
  for (const s of sourcing) {
    const name = String(s.name || '').trim();
    const job = s.job || '默认岗位';
    if (!name || seenKeys.has(`${name}::${job}`)) continue;
    seenKeys.add(`${name}::${job}`);
    const posId = job.toLowerCase().replace(/\s+/g, '-');
    if (!posMap.has(posId)) {
      posMap.set(posId, { id: posId, name: job, short: job.slice(0, 8), count: 0 });
    }
    posMap.get(posId).count += 1;
    const summaryParts = [
      ...String(s.baseInfo || '').split('/').map((x) => x.trim()).filter(Boolean),
      s.expect || '',
      s.salary || '',
      s.experience ? String(s.experience).split('；')[0]?.trim() || '' : '',
    ].filter(Boolean);
    candidates.push({
      id: s.geekId ? `geek:${s.geekId}` : `sourcing:${s.sourceTab}:${name}::${job}`,
      name,
      geekId: s.geekId || '',
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
      onlineResumeFile: resolveOnline(name, null),
      facts: {},
      messages: [],
      lastTime: s.activeStatus || undefined,
      updatedAt: s.fetchedAt || new Date().toISOString(),
    });
  }

  const byStage = {};
  const byJob = {};
  const bySource = { message: 0, recommend: 0, featured: 0 };
  const byJobAndSource = {};
  for (const s of STAGE_META) byStage[s.key] = 0;
  for (const c of candidates) {
    const src = normalizeSource(c.source);
    byStage[c.stage] = (byStage[c.stage] || 0) + 1;
    byJob[c.positionId] = (byJob[c.positionId] || 0) + 1;
    bySource[src] = (bySource[src] || 0) + 1;
    if (!byJobAndSource[c.positionId]) byJobAndSource[c.positionId] = { message: 0, recommend: 0, featured: 0 };
    byJobAndSource[c.positionId][src] = (byJobAndSource[c.positionId][src] || 0) + 1;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return {
    meta: {
      product: '招聘助手',
      generatedAt,
      generatedAtISO: now.toISOString(),
      source: 'boss-cli-live',
      stageMeta: STAGE_META,
      positions: [...posMap.values()],
    },
    stats: {
      total: candidates.length,
      byStage,
      byJob,
      bySource,
      byJobAndSource,
      todayNew: 0,
      awaitingReply: (byStage.greeted || 0) + (byStage.shortlisted || 0),
      quota: svc.readQuota(),
    },
    candidates,
  };
}

function loadDeskData(svc) {
  const paths = svc.resolveRepoPaths();
  let pipeline = null;
  if (existsSync(paths.pipelineFile)) {
    try {
      pipeline = JSON.parse(readFileSync(paths.pipelineFile, 'utf8'));
    } catch {
      pipeline = null;
    }
  }
  if (!pipeline) {
    pipeline = synthesizePipeline(svc);
  }

  let evalData = { meta: { total: 0 }, positions: [], candidates: [] };
  if (existsSync(paths.evalDataFile)) {
    try {
      const text = readFileSync(paths.evalDataFile, 'utf8');
      evalData = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch {
      evalData = { meta: { total: 0 }, positions: [], candidates: [] };
    }
  }

  return { pipeline, evalData, quota: svc.readQuota() };
}

function resolveDshModelSelection(ctx, override = null) {
  const llm = ctx.get('llm');
  if (!llm) return null;
  if (override?.provider && override?.model) {
    return {
      llm,
      selection: {
        provider: String(override.provider),
        model: String(override.model),
        ...(override.reasoningEffort ? { reasoningEffort: String(override.reasoningEffort) } : {}),
      },
    };
  }
  const defaultModel = ctx.get('agentDefaultModel');
  if (defaultModel && typeof defaultModel.currentSelection === 'function') {
    try {
      const sel = defaultModel.currentSelection();
      if (sel?.provider && sel?.model) {
        return { llm, selection: sel };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function listDshModelsCatalog(ctx) {
  const llm = ctx.get('llm');
  const defaultModel = ctx.get('agentDefaultModel');
  let current = null;
  if (defaultModel && typeof defaultModel.currentSelection === 'function') {
    try {
      const sel = defaultModel.currentSelection();
      if (sel?.provider && sel?.model) {
        current = {
          provider: sel.provider,
          model: sel.model,
          ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
        };
      }
    } catch {
      /* ignore */
    }
  }
  if (!llm) {
    return { runtime: 'deepseek-harness', current, providers: [] };
  }
  const rawProviders = typeof llm.listProviders === 'function' ? llm.listProviders() : [];
  const providers = await Promise.all(
    rawProviders.map(async (p) => {
      let models = [];
      try {
        const list = await llm.listModels(p.id);
        models = (Array.isArray(list) ? list : []).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description || undefined,
        }));
      } catch {
        models = [];
      }
      return { id: p.id, name: p.name || p.id, models };
    }),
  );
  // Ensure the active default selection is always selectable even if a custom adapter omits catalog discovery
  if (current) {
    let providerRow = providers.find((p) => p.id === current.provider);
    if (!providerRow) {
      providerRow = { id: current.provider, name: current.provider, models: [] };
      providers.unshift(providerRow);
    }
    if (!providerRow.models.some((m) => m.id === current.model)) {
      providerRow.models.unshift({ id: current.model, name: current.model });
    }
  }
  return {
    runtime: 'deepseek-harness',
    current,
    providers: providers.filter((p) => p.models.length > 0),
  };
}

function currentModelInfo(ctx) {
  const dsh = resolveDshModelSelection(ctx);
  if (dsh) {
    return {
      runtime: 'deepseek-harness',
      modelMode: 'llm',
      provider: dsh.selection.provider,
      modelId: dsh.selection.model,
      modelName: `${dsh.selection.provider} / ${dsh.selection.model}`,
    };
  }
  return {
    runtime: 'deepseek-harness',
    modelMode: 'llm',
    provider: '',
    modelId: '',
    modelName: '未配置 DSH 模型',
  };
}

function formatDshLlmError(sel, code, message) {
  const label = `${sel.provider}/${sel.model}`;
  const raw = String(message || code || '调用失败');
  if (code === 'AUTH' || code === 'NO_ADAPTER' || code === 'MISSING_CREDENTIAL' || /api.?key|auth|unauthorized|credential|未登录|401/i.test(raw)) {
    return `DSH 模型「${label}」尚未完成授权或凭证配置（${raw}）。请前往 DSH 主界面「设置 → 模型」填入对应 API Key / 登录账号，或在上方切换已配置好的模型。`;
  }
  if (code === 'UNSUPPORTED_CONTENT' || /image|vision|modalit|多模态|不支持图片/i.test(raw)) {
    return `当前 DSH 模型「${label}」不支持图片输入（${raw}）。请在上方模型下拉框切换支持视觉/多模态的模型后再发送图片。`;
  }
  return `DSH 模型「${label}」调用失败：${raw}`;
}

async function streamAssistantReply(ctx, svc, req, res, body) {
  const rawQuestion = String(body.message || '').trim();
  const images = normalizeIncomingImages(body.images);
  const question = rawQuestion || (images.length > 0 ? '请结合图片内容进行分析并给出招聘建议。' : '');
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const contextCandidate =
    body.contextCandidate && typeof body.contextCandidate === 'object' ? body.contextCandidate : null;
  const requestedModel =
    body.provider && body.model
      ? { provider: String(body.provider), model: String(body.model), reasoningEffort: body.reasoningEffort }
      : null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const dsh = resolveDshModelSelection(ctx, requestedModel);
  if (!dsh) {
    send('error', {
      code: 'NO_DSH_MODEL',
      message: '尚未检测到 DeepSeek Harness 已配置的模型，请先在 DSH 主界面「设置 → 模型」配置并启用一个模型。',
    });
    res.end();
    return;
  }

  const { pipeline, evalData } = loadDeskData(svc);
  const repoPaths = svc.resolveRepoPaths();
  let enrichedFocused = contextCandidate;
  if (contextCandidate?.name) {
    const localOnline = readLocalOnlineResume(repoPaths, svc.webDeskPath, contextCandidate.name);
    if (localOnline.found && localOnline.text) {
      enrichedFocused = {
        ...contextCandidate,
        onlineResumeExcerpt: localOnline.text.slice(0, 3000),
      };
    }
  }
  const top = [...(pipeline.candidates || [])]
    .filter((c) => typeof c.score === 'number')
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((c) => ({
      name: c.name,
      job: c.job,
      source: normalizeSource(c.source),
      stage: c.stage,
      score: c.score,
      city: c.facts?.city,
      salary: c.facts?.salary,
      summary: c.summary,
    }));
  const snapshot = {
    total: pipeline.stats?.total ?? pipeline.candidates?.length ?? 0,
    byStage: pipeline.stats?.byStage ?? {},
    bySource: pipeline.stats?.bySource ?? {},
    positions: (pipeline.meta?.positions || []).map((p) => p.name || p.short || p.id),
    top,
    evalCount: evalData?.candidates?.length ?? 0,
    defaultReplyTemplate: svc.defaultReplyTemplate,
    ...(enrichedFocused ? { focusedCandidate: enrichedFocused } : {}),
  };

  const systemPrompt = [
    '你是运行在 DeepSeek Harness 底座上的招聘助手。回答必须简短、具体、可执行，使用中文，不编造不存在的候选人。',
    '如果提供了 focusedCandidate，请优先聚焦该候选人的简历亮点、风险点、面试追问或可执行沟通话术。',
    '如果用户附带了图片（如简历截图、聊天截图、JD 截图），请仔细提取图片中的关键事实后再给结论与建议。',
    '如需对候选人发送真实 Boss 消息，提醒用户通过左侧「发消息」或回到 DSH 对话界面调用受审批保护的 boss_send_message 工具。',
    `当前本地台账摘要：${JSON.stringify(snapshot)}`,
  ].join('\n');

  const historyBlock = history.length
    ? `[最近对话]\n${history.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n')}\n\n[当前问题]\n${question}`
    : question;

  try {
    send('meta', {
      provider: dsh.selection.provider,
      model: dsh.selection.model,
    });
    send('thinking', {
      steps: [
        `调用 DSH 模型：${dsh.selection.provider} / ${dsh.selection.model}`,
        ...(images.length > 0 ? [`处理附带的 ${images.length} 张图片`] : []),
        contextCandidate ? `读取候选人档案：${contextCandidate.name}` : `读取本地台账（${snapshot.total} 人）`,
      ],
    });

    let userContentBlocks = [{ type: 'text', text: historyBlock }];
    if (images.length > 0) {
      const attachments = ctx.get('attachments');
      if (!attachments || typeof attachments.admitPromptContent !== 'function') {
        send('error', {
          code: 'ATTACHMENT_UNAVAILABLE',
          message: '当前 DeepSeek Harness 未启用附件存储服务（attachments），无法发送图片。',
        });
        return;
      }
      const promptParts = [
        { type: 'text', text: historyBlock },
        ...images.map((img) => ({
          type: 'image',
          mediaType: img.mediaType,
          data: img.data,
          ...(img.name ? { name: img.name } : {}),
        })),
      ];
      userContentBlocks = await attachments.admitPromptContent(promptParts);
    }

    let emittedText = false;
    let reasoningChars = 0;
    let reasoningNotified = false;
    let finishFailure = null;

    const stream = dsh.llm.stream({
      provider: dsh.selection.provider,
      model: dsh.selection.model,
      ...(dsh.selection.reasoningEffort ? { reasoningEffort: dsh.selection.reasoningEffort } : {}),
      system: systemPrompt,
      messages: [{ role: 'user', content: userContentBlocks }],
      temperature: 0.4,
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'reasoning-delta' && chunk.text) {
        reasoningChars += chunk.text.length;
        if (!reasoningNotified) {
          reasoningNotified = true;
          send('thinking', { steps: ['模型正在深度推理…'] });
        }
        send('reasoning', { text: chunk.text });
      } else if (chunk.type === 'text-delta' && chunk.text) {
        emittedText = true;
        send('delta', { text: chunk.text });
      } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        finishFailure = chunk.reason.failure || { code: chunk.reason.kind, message: chunk.reason.kind };
      }
    }

    if (finishFailure && !controller.signal.aborted) {
      send('error', {
        code: finishFailure.code || 'LLM_ERROR',
        message: formatDshLlmError(dsh.selection, finishFailure.code, finishFailure.message),
      });
    } else if (!emittedText && !controller.signal.aborted) {
      send('error', {
        code: 'EMPTY_RESPONSE',
        message: `DSH 模型「${dsh.selection.provider}/${dsh.selection.model}」未返回正文内容${reasoningChars > 0 ? '（仅返回了思考过程）' : ''}，请重试或切换模型。`,
      });
    } else {
      send('done', { ok: true });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      send('error', {
        code: error?.code || 'LLM_ERROR',
        message: formatDshLlmError(dsh.selection, error?.code, error?.message || String(error)),
      });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

export const name = 'boss-recruiter-web';
export const inject = ['bossRecruiter'];

export function apply(ctx) {
  const svc = ctx.bossRecruiter;
  if (svc.config.enableWebDesk === false) return;

  const prefix = svc.webDeskPath;
  let doctorCache = { at: 0, value: null };

  async function checkDoctor(force = false) {
    if (!force && doctorCache.value && Date.now() - doctorCache.at < 20_000) {
      return doctorCache.value;
    }
    const modelInfo = currentModelInfo(ctx);
    try {
      const { data } = await svc.runCli(['doctor', '--json'], { timeoutMs: 12000 });
      const value = {
        ok: Boolean(data?.safariRunning && data?.jsAppleEventsEnabled && data?.loggedInShell),
        safariRunning: Boolean(data?.safariRunning),
        jsAppleEventsEnabled: Boolean(data?.jsAppleEventsEnabled),
        loggedInShell: Boolean(data?.loggedInShell),
        tabTitle: data?.bossTab?.title || '',
        message:
          data?.manualInterventionMessage ||
          (data?.loggedInShell ? '本机 Safari 已就绪' : '请先在 Safari 登录 Boss 直聘'),
        ...modelInfo,
        checkedAt: new Date().toISOString(),
      };
      doctorCache = { at: Date.now(), value };
      return value;
    } catch (error) {
      const value = {
        ok: false,
        safariRunning: false,
        jsAppleEventsEnabled: false,
        loggedInShell: false,
        message: error?.message || 'Safari 状态检测失败',
        ...modelInfo,
        checkedAt: new Date().toISOString(),
      };
      doctorCache = { at: Date.now(), value };
      return value;
    }
  }

  // Optional injection: only activates when running a surface with WebServer (`dsh web`).
  ctx.inject(['webServer'], (webCtx) => {
    const handler = async (req, res) => {
      const url = new URL(req.url || prefix, 'http://127.0.0.1');
      const fullPath = decodeURIComponent(url.pathname);

      // Ensure trailing slash on bare `/boss-desk` so Vite `./assets/...` relative paths resolve under `/boss-desk/`.
      if (fullPath === prefix) {
        res.writeHead(302, { Location: `${prefix}/` });
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD' && !isLoopbackOrigin(req)) {
        return sendJson(res, 403, { error: '仅允许本机访问' });
      }

      const subPath = fullPath.slice(prefix.length) || '/';
      const repoPaths = svc.resolveRepoPaths();

      if (subPath.startsWith('/media/avatars/')) {
        const rel = subPath.slice('/media/avatars/'.length);
        for (const base of repoPaths.avatarDirs) {
          const file = safeJoin(base, rel);
          if (file && existsSync(file)) return serveFile(res, file);
        }
        return sendJson(res, 404, { error: 'not found' });
      }

      if (subPath.startsWith('/media/eval/')) {
        const file = safeJoin(repoPaths.evalAssetsDir, subPath.slice('/media/eval/'.length));
        return file ? serveFile(res, file) : sendJson(res, 400, { error: 'bad path' });
      }

      if (subPath.startsWith('/media/resumes/pdf/')) {
        const rel = subPath.slice('/media/resumes/pdf/'.length);
        const searchDirs = [repoPaths.resumePdfDir, ...(repoPaths.evalPdfDirs || [])];
        for (const base of searchDirs) {
          const file = safeJoin(base, rel);
          if (file && existsSync(file) && statSync(file).isFile()) return serveFile(res, file);
        }
        return sendJson(res, 404, { error: '本地未找到该 PDF 简历文件' });
      }

      if (subPath.startsWith('/media/resumes/screenshots/')) {
        const rel = subPath.slice('/media/resumes/screenshots/'.length);
        const file = safeJoin(repoPaths.resumeScreenshotDir, rel);
        return file && existsSync(file) ? serveFile(res, file) : sendJson(res, 404, { error: 'not found' });
      }

      if (subPath.startsWith('/api/')) {
        if (subPath === '/api/ping') {
          return sendJson(res, 200, {
            ok: true,
            runtime: 'deepseek-harness',
            mountPath: `${prefix}/`,
            ...currentModelInfo(ctx),
          });
        }

        if (subPath === '/api/doctor') {
          const force = url.searchParams.get('refresh') === '1';
          return sendJson(res, 200, await checkDoctor(force));
        }

        if (subPath === '/api/models' && req.method === 'GET') {
          return sendJson(res, 200, await listDshModelsCatalog(ctx));
        }

        if (subPath === '/api/models/select' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const provider = String(body.provider || '').trim();
          const model = String(body.model || '').trim();
          if (!provider || !model) {
            return sendJson(res, 400, { error: '缺少 provider 或 model' });
          }
          const defaultModel = ctx.get('agentDefaultModel');
          if (defaultModel && typeof defaultModel.saveSelection === 'function') {
            try {
              await defaultModel.saveSelection({
                provider,
                model,
                ...(body.reasoningEffort ? { reasoningEffort: String(body.reasoningEffort) } : {}),
              });
              doctorCache = { at: 0, value: null };
              return sendJson(res, 200, {
                ok: true,
                savedToDsh: true,
                current: { provider, model },
              });
            } catch (error) {
              return sendJson(res, 500, { error: `切换 DSH 默认模型失败：${error?.message || error}` });
            }
          }
          return sendJson(res, 200, { ok: true, savedToDsh: false, current: { provider, model } });
        }

        if (subPath === '/api/data') {
          return sendJson(res, 200, loadDeskData(svc));
        }

        if (subPath === '/api/refresh' && req.method === 'POST') {
          try {
            await svc.rebuildPipelineIfAvailable();
          } catch (error) {
            return sendJson(res, 500, { error: `重建数据失败：${error?.message || error}` });
          }
          const data = loadDeskData(svc);
          return sendJson(res, 200, { pipeline: data.pipeline, quota: data.quota });
        }

        if (subPath === '/api/stage' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const nameVal = String(body.name || '').trim();
          const stageVal = String(body.stage || '').trim();
          const jobVal = String(body.job || '').trim();
          const scoreVal = Number(body.score);
          if (!nameVal || !stageVal) return sendJson(res, 400, { error: '缺少姓名或阶段' });
          if (!ALLOWED_STAGES.has(stageVal)) return sendJson(res, 400, { error: '未知阶段' });
          const args = ['tracker', 'upsert', '--name', nameVal, '--job', jobVal || '未标注', '--stage', stageVal];
          if (Number.isFinite(scoreVal)) args.push('--score', String(Math.round(scoreVal)));
          args.push('--summary', '招聘助手调整阶段', '--reason', 'DSH 招聘助手', '--json');
          try {
            await svc.runCli(args);
            await svc.rebuildPipelineIfAvailable().catch(() => {});
            const data = loadDeskData(svc);
            return sendJson(res, 200, { ok: true, pipeline: data.pipeline, quota: data.quota });
          } catch (error) {
            return sendJson(res, 500, { error: `写入台账失败：${error?.message || error}` });
          }
        }

        if (subPath === '/api/send' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const recipient = String(body.name || '').trim();
          const text = String(body.text || '').trim();
          if (!recipient || !text) return sendJson(res, 400, { error: '缺少收件人或内容' });
          if (text.length > 800) return sendJson(res, 400, { error: '消息超过 800 字' });
          const quota = svc.readQuota();
          if (quota.quotas.send.remaining <= 0) {
            return sendJson(res, 429, { error: '今日发送额度已用完' });
          }
          try {
            const { stdout } = await svc.runCli([
              'send',
              '--to',
              recipient,
              '--strict',
              '-t',
              text,
              '--confirm',
              '--json',
            ]);
            await svc.rebuildPipelineIfAvailable().catch(() => {});
            const data = loadDeskData(svc);
            return sendJson(res, 200, {
              ok: true,
              result: stdout.slice(-2000),
              quota: data.quota,
              pipeline: data.pipeline,
            });
          } catch (error) {
            return sendJson(res, 500, { error: `发送失败：${error?.message || error}` });
          }
        }

        if (subPath === '/api/resume/pdfs' && req.method === 'GET') {
          return sendJson(res, 200, { files: listLocalPdfResumes(repoPaths, prefix) });
        }

        if (subPath === '/api/resume/upload-pdf' && req.method === 'POST') {
          const body = await readJsonBody(req, 30 * 1024 * 1024);
          const candidateName = String(body.name || '').trim();
          const jobVal = String(body.job || '').trim();
          const geekIdVal = String(body.geekId || '').trim();
          const sourceVal = body.source ? normalizeSource(body.source) : '';
          let rawBase64 = String(body.dataBase64 || '').trim();
          if (!candidateName || !rawBase64) {
            return sendJson(res, 400, { error: '缺少候选人姓名或 PDF 文件数据' });
          }
          if (rawBase64.startsWith('data:')) {
            const m = /^data:[^;]+;base64,(.+)$/s.exec(rawBase64);
            if (m) rawBase64 = m[1];
          }
          const buf = Buffer.from(rawBase64.replace(/\s+/g, ''), 'base64');
          if (buf.length < 10 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
            return sendJson(res, 400, { error: '上传文件不是有效的 PDF 格式（缺少 %PDF- 文件头）' });
          }
          if (buf.length > 25 * 1024 * 1024) {
            return sendJson(res, 413, { error: 'PDF 文件超过 25MB 限制' });
          }
          mkdirSync(repoPaths.resumePdfDir, { recursive: true });
          const pdfFile = `${safeFileBase(candidateName)}-${Date.now()}.pdf`;
          const pdfAbsPath = path.join(repoPaths.resumePdfDir, pdfFile);
          writeFileSync(pdfAbsPath, buf);

          const cliArgs = ['tracker', 'upsert', '--name', candidateName, '--resume-pdf', pdfAbsPath, '--json'];
          if (jobVal) cliArgs.push('--job', jobVal);
          if (geekIdVal) cliArgs.push('--geek-id', geekIdVal);
          if (sourceVal) cliArgs.push('--source', sourceVal);
          try {
            await svc.runCli(cliArgs);
            await svc.rebuildPipelineIfAvailable().catch(() => {});
          } catch {
            /* 本地 PDF 已成功落盘，即使台账同步失败仍返回可查看 URL */
          }
          const data = loadDeskData(svc);
          return sendJson(res, 200, {
            ok: true,
            pdfFile,
            pdfUrl: `${prefix}/media/resumes/pdf/${encodeURIComponent(pdfFile)}`,
            pdfPath: pdfAbsPath,
            pipeline: data.pipeline,
          });
        }

        if (subPath === '/api/resume/online' && req.method === 'GET') {
          const candidateName = String(url.searchParams.get('name') || '').trim();
          const explicitFile = String(url.searchParams.get('file') || '').trim();
          if (!candidateName && !explicitFile) {
            return sendJson(res, 400, { error: '缺少候选人姓名或文件名' });
          }
          return sendJson(res, 200, readLocalOnlineResume(repoPaths, prefix, candidateName, explicitFile));
        }

        if (subPath === '/api/resume/fetch' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const candidateName = String(body.name || '').trim();
          const geekIdVal = String(body.geekId || '').trim();
          const jobVal = String(body.job || '').trim();
          const sourceVal = normalizeSource(body.source);
          const screenshot = Boolean(body.screenshot);
          if (!candidateName && !geekIdVal) {
            return sendJson(res, 400, { error: '缺少候选人姓名或 geekId' });
          }
          const quota = svc.readQuota();
          if (quota.quotas.preview.remaining <= 0) {
            return sendJson(res, 429, { error: '今日在线简历查看额度已用完' });
          }
          try {
            let cliResult;
            if (sourceVal === 'recommend' || sourceVal === 'featured') {
              const args = ['preview'];
              if (candidateName) args.push(candidateName);
              if (geekIdVal) args.push('--geek-id', geekIdVal);
              args.push('--tab', sourceVal);
              if (jobVal) args.push('--job', jobVal);
              if (screenshot) args.push('--screenshot');
              args.push('--json');
              cliResult = await svc.runCli(args, { timeoutMs: 180000 });
            } else {
              await svc.runCli(['chat', candidateName, '--strict', '--json'], { timeoutMs: 90000 });
              const args = ['action', 'resume', '--json'];
              if (screenshot) args.push('--screenshot');
              cliResult = await svc.runCli(args, { timeoutMs: 180000 });
            }
            await svc.rebuildPipelineIfAvailable().catch(() => {});
            const data = loadDeskData(svc);
            const savedFile = cliResult?.data?.onlineResumePath
              ? path.basename(cliResult.data.onlineResumePath)
              : '';
            const resume = readLocalOnlineResume(repoPaths, prefix, candidateName, savedFile);
            return sendJson(res, 200, {
              ok: true,
              resume,
              raw: cliResult?.data || null,
              quota: data.quota,
              pipeline: data.pipeline,
            });
          } catch (error) {
            return sendJson(res, 500, { error: `从 Boss 读取在线简历失败：${error?.message || error}` });
          }
        }

        if (subPath === '/api/sourcing/sync' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const rawTab = String(body.tab || '').trim().toLowerCase();
          if (rawTab !== 'recommend' && rawTab !== 'featured') {
            return sendJson(res, 400, {
              error: '仅支持从「推荐牛人 (recommend)」或「精选牛人 (featured)」拉取，暂不包含「最新」。',
            });
          }
          const jobVal = String(body.job || '').trim();
          const limit = Math.max(1, Math.min(50, Number(body.limit) || 20));
          const cliArgs = ['recommend'];
          if (jobVal && jobVal !== 'all') cliArgs.push(jobVal);
          cliArgs.push('--tab', rawTab, '--limit', String(limit), '--sync-tracker', '--json');
          if (body.skipViewed !== false) cliArgs.push('--skip-viewed');
          if (body.skipColleague !== false) cliArgs.push('--skip-colleague');
          try {
            const { data: cliData } = await svc.runCli(cliArgs, { timeoutMs: 240000 });
            await svc.rebuildPipelineIfAvailable().catch(() => {});
            const desk = loadDeskData(svc);
            return sendJson(res, 200, {
              ok: true,
              tab: rawTab,
              job: cliData?.job || jobVal || '',
              count: Array.isArray(cliData?.candidates) ? cliData.candidates.length : 0,
              fetched: cliData,
              pipeline: desk.pipeline,
              quota: desk.quota,
            });
          } catch (error) {
            return sendJson(res, 500, { error: `拉取${rawTab === 'featured' ? '精选牛人' : '推荐牛人'}失败：${error?.message || error}` });
          }
        }

        if (subPath === '/api/greet' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const candidateName = String(body.name || '').trim();
          const geekIdVal = String(body.geekId || '').trim();
          const jobVal = String(body.job || '').trim();
          const rawTab = String(body.tab || '').trim().toLowerCase();
          if (!candidateName && !geekIdVal) {
            return sendJson(res, 400, { error: '缺少候选人姓名或 geekId' });
          }
          const quota = svc.readQuota();
          if (quota.quotas.greet.remaining <= 0) {
            return sendJson(res, 429, { error: '今日打招呼额度已用完' });
          }
          const cliArgs = ['greet'];
          if (candidateName) cliArgs.push(candidateName);
          if (geekIdVal) cliArgs.push('--geek-id', geekIdVal);
          if (jobVal) cliArgs.push('--job', jobVal);
          if (rawTab === 'recommend' || rawTab === 'featured') cliArgs.push('--tab', rawTab);
          cliArgs.push('--confirm', '--json');
          try {
            const { stdout, data: cliData } = await svc.runCli(cliArgs, { timeoutMs: 120000 });
            await svc.rebuildPipelineIfAvailable().catch(() => {});
            const desk = loadDeskData(svc);
            return sendJson(res, 200, {
              ok: true,
              result: cliData || stdout.slice(-2000),
              quota: desk.quota,
              pipeline: desk.pipeline,
            });
          } catch (error) {
            return sendJson(res, 500, { error: `打招呼失败：${error?.message || error}` });
          }
        }

        if (subPath === '/api/update/status' && req.method === 'GET') {
          return sendJson(res, 200, getUpdateStatus(repoPaths.repoRoot));
        }

        if (subPath === '/api/update/config' && req.method === 'POST') {
          const body = await readJsonBody(req);
          saveUpdateConfig({
            ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
            ...(body.githubRepo !== undefined ? { githubRepo: body.githubRepo } : {}),
            ...(body.githubToken !== undefined ? { githubToken: body.githubToken } : {}),
          });
          return sendJson(res, 200, { ok: true, status: getUpdateStatus(repoPaths.repoRoot) });
        }

        if (subPath === '/api/update/check' && req.method === 'POST') {
          const body = await readJsonBody(req);
          try {
            const result = await checkForUpdate(repoPaths.repoRoot, body);
            return sendJson(res, 200, result);
          } catch (error) {
            return sendJson(res, error?.needAuth ? 401 : 502, {
              error: error?.message || '检查更新失败',
              needAuth: Boolean(error?.needAuth),
            });
          }
        }

        if (subPath === '/api/update/install' && req.method === 'POST') {
          const body = await readJsonBody(req);
          try {
            const result = await downloadAndInstallUpdate(repoPaths.repoRoot, body);
            return sendJson(res, 200, result);
          } catch (error) {
            return sendJson(res, 500, { error: error?.message || '下载或安装更新失败' });
          }
        }

        if (subPath === '/api/update/upload' && req.method === 'POST') {
          const body = await readJsonBody(req, 45 * 1024 * 1024);
          try {
            const result = installUpdateFromBase64(repoPaths.repoRoot, body);
            return sendJson(res, 200, result);
          } catch (error) {
            return sendJson(res, 400, { error: error?.message || '离线更新包安装失败' });
          }
        }

        if (subPath === '/api/update/restart' && req.method === 'POST') {
          markRestartRequested();
          sendJson(res, 200, { ok: true, restarting: true });
          setTimeout(() => {
            process.exit(RESTART_EXIT_CODE);
          }, 250);
          return;
        }

        if (subPath === '/api/assistant' && req.method === 'POST') {
          const body = await readJsonBody(req);
          return streamAssistantReply(ctx, svc, req, res, body);
        }

        return sendJson(res, 404, { error: 'not found' });
      }

      // Static 招聘助手 SPA serving
      const distDir = svc.resolveDeskDistDir();
      if (!distDir) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>招聘助手</title><body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto"><h2>招聘助手前端尚未构建</h2><p>请在仓库根目录运行 <code>npm run desk:build</code>，或在 DSH 插件配置中设置 <code>deskDistDir</code>。</p><p>API 已就绪：<a href="${prefix}/api/ping">${prefix}/api/ping</a></p></body>`,
        );
        return;
      }

      if (subPath === '/' || subPath === '/index.html') {
        return serveFile(res, path.join(distDir, 'index.html'));
      }
      const asset = safeJoin(distDir, subPath.slice(1));
      if (asset && existsSync(asset) && statSync(asset).isFile()) {
        return serveFile(res, asset);
      }
      return serveFile(res, path.join(distDir, 'index.html'));
    };

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: prefix,
          handler,
        }),
      `boss-recruiter-web: prefix ${prefix}`,
    );
  });
}
