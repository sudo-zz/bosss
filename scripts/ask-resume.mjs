#!/usr/bin/env node
/**
 * 给已打招呼的候选人发「要简历 + 确认是否在上海 + 能否现场面试」。
 *
 * 流程（逐人）：
 *   1. boss chat <姓名> --json 打开会话并读完整对话
 *   2. 若对话里我方已经问过（含「上海」且含「简历」）→ 只解析回复，不重复发
 *   3. 否则 boss send --to <姓名> -t <文案> --confirm
 *   4. 解析对方回复 → 回写台账（replyCity / replyInterview / replySummary）
 *
 * 用法：
 *   node scripts/ask-resume.mjs --dry-run                 # 只看会发给谁
 *   node scripts/ask-resume.mjs --limit 3                 # 先试 3 人
 *   node scripts/ask-resume.mjs                           # 全部已打招呼的人
 *   node scripts/ask-resume.mjs --job 讲解员 --resend      # 强制重发
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
const CLI = join(REPO, 'dist/cli/index.js');
const TRACKER = join(homedir(), '.boss-cli/tracker.json');
const CHAT_URL = 'https://www.zhipin.com/web/chat/index';

const { upsertTrackedCandidate } = await import(join(REPO, 'dist/common/tracker.js'));
const { scrollChatListStep, scrollChatListToTop } = await import(
  join(REPO, 'dist/toolset/list.js')
);
// 直接复用 CLI 的会话抓取实现：避免再起一个进程重切「全部」标签把右侧面板清空
const { scrapeCurrentChatMessages } = await import(join(REPO, 'dist/toolset/chat.js'));

const MESSAGE_TEXT =
  '你好，方便发一份最新的附件简历吗？另外想确认下你现在人在上海吗，近期是否方便来公司现场面试？谢谢～';

const CITY_WORDS = [
  '上海', '北京', '杭州', '苏州', '南京', '广州', '深圳', '成都', '武汉', '西安', '郑州',
  '合肥', '宁波', '无锡', '常州', '嘉兴', '南通', '重庆', '天津', '长沙', '青岛', '济南',
  '厦门', '福州', '南昌', '昆明', '贵阳', '石家庄', '太原', '沈阳', '大连', '哈尔滨', '长春',
];

function parseArgs(argv) {
  const out = {
    job: '',
    limit: 0,
    dryRun: false,
    resend: false,
    only: '',
    minScore: 0,
    gapMs: 10_500,
    onlyNew: false,
    collectOnly: false,
    agree: false,
    download: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--job') out.job = argv[++i] ?? '';
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--only') out.only = argv[++i] ?? '';
    else if (a === '--min-score') out.minScore = Number(argv[++i]);
    else if (a === '--gap') out.gapMs = Number(argv[++i]) * 1000;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--resend') out.resend = true;
    else if (a === '--only-new') out.onlyNew = true;
    else if (a === '--collect') out.collectOnly = true;
    else if (a === '--agree') out.agree = true;
    else if (a === '--download') out.download = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runCli(argv, timeout = 300_000) {
  const r = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: REPO,
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function parseJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  for (let end = text.length; end > start; end--) {
    if (text[end - 1] !== '}') continue;
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      /* 继续向前收缩 */
    }
  }
  return null;
}

/** 从对方消息里判断城市（只在明确的居住地表述上判断，避免「上海迪士尼实习」这类经历误判） */
function parseCity(friendTexts) {
  for (let i = friendTexts.length - 1; i >= 0; i--) {
    const t = friendTexts[i];
    if (!t) continue;
    if (/不在上海|不在沪|离开上海|没在上海|上海.{0,4}(去不了|来不了|待不了)/.test(t)) {
      const m = t.match(new RegExp(`(${CITY_WORDS.join('|')})`));
      return { inShanghai: false, city: m && m[1] !== '上海' ? m[1] : '外地', raw: t };
    }
    if (
      /(人在|现居|目前|现在|坐标|家住|住在|定居|常驻)\s*(上海|沪)/.test(t) ||
      /上海(本地|人)/.test(t) ||
      /^(是的|嗯|对|在)[，,、\s]*(我)?(就)?在?上海/.test(t)
    ) {
      return { inShanghai: true, city: '上海', raw: t };
    }
    const m = t.match(/(?:人在|现居|目前|现在|坐标|家住|住在|定居|常驻)\s*([\u4e00-\u9fa5]{2,4})/);
    if (m && CITY_WORDS.includes(m[1]) && m[1] !== '上海') {
      return { inShanghai: false, city: m[1], raw: t };
    }
  }
  return { inShanghai: null, city: '', raw: '' };
}

/** 从对方消息里判断面试意愿（必须带面试/到岗语境，单独的「可以」不算） */
function parseInterview(friendTexts) {
  for (let i = friendTexts.length - 1; i >= 0; i--) {
    const t = friendTexts[i];
    if (!t) continue;
    if (
      /(不方便|来不了|去不了|暂时不|暂不|不考虑|不感兴趣|太远|有点远).{0,8}(面试|过来|到岗|面谈)/.test(t) ||
      /(面试|到岗|面谈).{0,8}(不方便|来不了|去不了|暂时不|暂不)/.test(t)
    ) {
      return { canInterview: false, raw: t };
    }
    if (
      /(可以|方便|没问题|随时|能|愿意|有空).{0,10}(面试|到岗|过来|来公司|面谈|入职)/.test(t) ||
      /(面试|到岗|面谈|入职).{0,10}(可以|方便|没问题|随时|能来|有空)/.test(t)
    ) {
      return { canInterview: true, raw: t };
    }
  }
  return { canInterview: null, raw: '' };
}

function summarizeReply(city, interview, hasResume, friendTexts) {
  const parts = [];
  if (city.city) parts.push(city.inShanghai ? '上海' : `不在上海（${city.city}）`);
  if (interview.canInterview === true) parts.push('可现场面试');
  else if (interview.canInterview === false) parts.push('暂不方便面试');
  if (hasResume) parts.push('已收到简历');
  if (parts.length) return parts.join(' · ');
  const last = friendTexts[friendTexts.length - 1];
  return last ? last.replace(/\s+/g, ' ').slice(0, 40) : '';
}

function loadTargets() {
  const store = JSON.parse(readFileSync(TRACKER, 'utf8'));
  const list = Object.values(store.candidates || {});
  return list
    .filter((c) => c && c.name)
    .filter((c) => c.stage === 'greeted' || c.stage === 'replied')
    .filter((c) => (args.job ? String(c.job || '').includes(args.job) : true))
    .filter((c) => (args.minScore ? Number(c.score || 0) >= args.minScore : true))
    .filter((c) => (args.only ? String(c.name).includes(args.only) : true))
    .filter((c) => (args.onlyNew ? !c.askedResumeAt : true))
    .filter((c) => (args.download ? c.resumeReceived === true && !c.resumePdfPath : true))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

async function gotoChatIndex() {
  const { openOrReuseBossTab } = await import(join(REPO, 'dist/browser/index.js'));
  const page = await openOrReuseBossTab({ targetUrl: CHAT_URL, activate: true });
  const url = await page.url();
  if (!/\/web\/chat\/index/.test(url)) {
    await page.goto(CHAT_URL, { timeoutMs: 45_000 });
    await sleep(1_500);
  }
  return page;
}

/** 读当前会话列表滚动位置与已渲染的姓名 */
async function readListState(page) {
  return page.eval(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const s = document.querySelector(".user-list.b-scroll-stable, .user-list");
    const names = Array.from(document.querySelectorAll(".geek-item-wrap"))
      .map((w) => norm(w.querySelector(".geek-name")?.textContent))
      .filter(Boolean);
    return { names, scrollTop: s ? s.scrollTop : 0, clientHeight: s ? s.clientHeight : 0 };
  `);
}

/** 把会话列表滚到指定位置 */
async function scrollTo(page, top) {
  await page.eval(
    `
    const s = document.querySelector(".user-list.b-scroll-stable, .user-list");
    if (s) { s.scrollTop = args.top; s.dispatchEvent(new Event("scroll", { bubbles: false })); }
    return true;
    `,
    { top },
  );
}

/**
 * 会话列表是虚拟滚动（DOM 只保留可视区附近几十行），所以先从头滚一遍，
 * 记下每个目标姓名出现时的滚动位置，后面直接跳到对应位置找，避免每次都从顶部扫。
 */
async function scanListPositions(page, targetNames) {
  const map = new Map();
  await scrollChatListToTop(page);
  await sleep(450);
  for (let round = 0; round < 90; round++) {
    const st = await readListState(page);
    for (const name of st.names) {
      if (targetNames.has(name) && !map.has(name)) map.set(name, st.scrollTop);
    }
    if (targetNames.size && [...targetNames].every((n) => map.has(n))) break;
    const scrolled = await scrollChatListStep(page);
    await sleep(300);
    if (!scrolled.moved || scrolled.atEnd) break;
  }
  return map;
}

/** 在已渲染的会话列表里按姓名点开（精确优先，退回唯一包含匹配） */
async function clickRowByName(page, name) {
  return page.eval(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const wraps = Array.from(document.querySelectorAll(".geek-item-wrap"));
    const pick = () => {
      const exactRows = wraps.filter((w) => norm(w.querySelector(".geek-name")?.textContent) === args.name);
      if (exactRows.length >= 1) return exactRows[0];
      const partial = wraps.filter((w) => norm(w.querySelector(".geek-name")?.textContent).includes(args.name));
      return partial.length === 1 ? partial[0] : null;
    };
    const target = pick();
    if (!target) return { ok: false, reason: "not-loaded" };
    const row = target.querySelector(".geek-item") || target;
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
      row.click();
    }
    return { ok: true, name: norm(target.querySelector(".geek-name")?.textContent) };
    `,
    { name },
  );
}

/** 跳到记录位置附近，上下小范围找目标姓名 */
async function openRowByName(page, name, hintTop) {
  if (typeof hintTop === 'number') {
    await scrollTo(page, Math.max(0, hintTop - 120));
    await sleep(320);
  }
  let clicked = await clickRowByName(page, name);
  for (let i = 0; i < 10 && !clicked.ok; i++) {
    const st = await scrollChatListStep(page);
    await sleep(280);
    if (!st.moved || st.atEnd) break;
    clicked = await clickRowByName(page, name);
  }
  return clicked;
}

/** 兜底：用聊天页顶部的「搜索姓名/群聊」下拉直接打开被归档、不在列表里的会话 */
async function openBySearch(page, name) {
  const hasInput = await page.eval(
    `return !!document.querySelector("input.search-input");`,
  );
  if (!hasInput) {
    await page.eval(`document.querySelector(".chat-search-btn")?.click(); return true;`);
    await sleep(700);
  }
  const typed = await page.eval(
    `
    const inp = document.querySelector("input.search-input");
    if (!(inp instanceof HTMLInputElement)) return false;
    inp.focus();
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc?.set?.call(inp, "");
    inp.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: "" }));
    document.execCommand("insertText", false, args.name);
    inp.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: args.name }));
    return true;
    `,
    { name },
  );
  if (!typed) return { ok: false, reason: 'no-search-input' };
  await sleep(1_600);

  const clicked = await page.eval(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const items = Array.from(document.querySelectorAll(".geek-search-list li"));
    const hit = items.find((li) => norm(li.textContent).startsWith(args.name + "_"));
    if (!hit) return { ok: false, reason: "no-result", total: items.length };
    hit.click();
    return { ok: true };
    `,
    { name },
  );
  await sleep(1_800);
  await page.pressKey(53).catch(() => {});
  return clicked;
}

/** 等右侧会话面板切到目标候选人，返回当前会话姓名 */
async function waitForChat(page, targetName, timeoutMs = 12_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = await page.eval(`
      const el = document.querySelector(".base-info-single-container .name-box");
      return (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    `);
    if (last && last.includes(targetName)) return last;
    await sleep(320);
  }
  return last;
}

/** 读取当前会话的消息快照（与 CLI chat --json 同源） */
async function readCurrentChat(page, name) {
  const scraped = await scrapeCurrentChatMessages(page);
  return {
    candidate: { name },
    messages: scraped.messages,
    hasFriendResumeAttachment: scraped.hasFriendResumeAttachment,
    friendImages: scraped.friendImages,
  };
}


/** 关闭所有残留的简历预览弹窗（BOSS 的预览会叠加，不复用 iframe） */
async function closeResumePreviews(page) {
  for (let i = 0; i < 14; i++) {
    const n = await page.eval(
      `return Array.from(document.querySelectorAll("iframe")).filter((f) => /pdf-viewer/.test(f.src || "")).length;`,
    );
    if (n === 0) return;
    const clicked = await page.eval(`
      const btns = Array.from(document.querySelectorAll(".new-resume-online-main-ui .close-btn"))
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (!btns.length) return false;
      btns[btns.length - 1].click();
      return true;
    `);
    if (!clicked) return;
    await sleep(420);
  }
}

/** 点击会话里的附件简历卡片，把 BOSS 预览里的 PDF 原文件取回本地 */
async function downloadAttachmentPdf(page, name, geekId) {
  await closeResumePreviews(page);
  const beforeSrcs = await page.eval(
    `return Array.from(document.querySelectorAll("iframe")).map((f) => f.src || "").filter((s) => /pdf-viewer/.test(s));`,
  );
  const clicked = await page.eval(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const items = Array.from(document.querySelectorAll(".message-item"));
    const withResume = items.filter((i) => norm(i.textContent).includes("点击预览附件简历"));
    const last = withResume[withResume.length - 1];
    if (!last) return { ok: false };
    const title = norm(last.querySelector(".message-card-top-title")?.textContent);
    const btn = last.querySelector(".card-btn");
    if (btn instanceof HTMLElement) btn.click();
    return { ok: true, title };
  `);
  if (!clicked.ok) return null;

  let src = "";
  for (let i = 0; i < 24 && !src; i++) {
    await sleep(500);
    src = await page.eval(
      `
      const frames = Array.from(document.querySelectorAll("iframe")).filter((x) => /pdf-viewer/.test(x.src || ""));
      const fresh = frames.filter((f) => !(args.before || []).includes(f.src));
      const pick =
        (args.geekId && frames.find((f) => f.src.includes("geekId=" + args.geekId))) ||
        fresh[fresh.length - 1] ||
        null;
      return pick ? pick.src : "";
      `,
      { before: beforeSrcs, geekId: geekId || "" },
    );
  }
  if (!src) {
    await closeResumePreviews(page);
    return null;
  }

  await page.eval(`
    const f = Array.from(document.querySelectorAll("iframe")).find((x) => /pdf-viewer/.test(x.src || ""));
    const u = new URL(f.src).searchParams.get("url");
    window.__pdfState = "loading";
    window.__pdfBuf = null;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://www.zhipin.com" + u, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => { window.__pdfBuf = new Uint8Array(xhr.response); window.__pdfState = "done"; };
    xhr.onerror = () => { window.__pdfState = "error"; };
    xhr.send();
    return "started";
  `);

  let state = "loading";
  for (let i = 0; i < 40 && state === "loading"; i++) {
    await sleep(400);
    state = await page.eval(`return window.__pdfState || "";`);
  }
  if (state !== "done") {
    await closeResumePreviews(page);
    return null;
  }

  const len = await page.eval(`return window.__pdfBuf ? window.__pdfBuf.length : 0;`);
  const chunks = [];
  const STEP = 19998; // 3 的倍数，避免每块 base64 末尾补 = 影响拼接
  for (let i = 0; i < len; i += STEP) {
    const end = Math.min(i + STEP, len);
    const b64 = await page.eval(
      'const s = window.__pdfBuf.slice(' + i + "," + end + '); let o = ""; for (let k = 0; k < s.length; k++) o += String.fromCharCode(s[k]); return btoa(o);',
    );
    chunks.push(Buffer.from(b64, "base64"));
  }
  await closeResumePreviews(page);
  const buf = Buffer.concat(chunks);
  if (buf.length < 1000 || buf.subarray(0, 4).toString() !== "%PDF") return null;

  const dir = join(homedir(), ".boss-cli/resumes/pdf");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.pdf`);
  writeFileSync(file, buf);
  return { file, size: buf.length, title: clicked.title || "" };
}

const targets = loadTargets();
console.log(`待处理候选（stage=greeted）：${targets.length} 人`);

if (args.dryRun) {
  for (const c of targets) {
    console.log(
      `  ${String(c.score ?? '-').padStart(3)} ${c.name}｜${c.job}｜${c.askedResumeAt ? '已问过' : '未问'}`,
    );
  }
  process.exit(0);
}

if (!targets.length) process.exit(0);

const page = await gotoChatIndex();
console.log(`已进入沟通列表：${await page.url()}`);

// 会话列表按最近活跃排序，先从头扫一遍记录目标所在位置，后面直接跳过去点开
const targetNames = new Set(targets.map((t) => String(t.name)));
const positions = await scanListPositions(page, targetNames);
console.log(
  `已在会话列表定位 ${positions.size}/${targetNames.size} 人` +
    (positions.size < targetNames.size
      ? `（未找到：${[...targetNames].filter((n) => !positions.has(n)).join('、')}）`
      : ''),
);

let sent = 0;
let skipped = 0;
let replied = 0;
let failed = 0;

for (const c of targets) {
  if (args.limit && sent >= args.limit) break;
  const label = `${c.score ?? '-'} ${c.name}`;

  let clicked = await openRowByName(page, String(c.name), positions.get(String(c.name)));
  if (!clicked.ok) {
    // 会话可能已被归档，用搜索下拉兜底
    const searched = await openBySearch(page, String(c.name));
    if (searched.ok) clicked = { ok: true, name: String(c.name) };
  }
  if (!clicked.ok) {
    console.log(`  ✗ ${label}：会话列表和搜索都找不到这个人`);
    failed += 1;
    continue;
  }
  // 等右侧会话面板切换到该候选人
  await sleep(1_400);
  // 等右侧会话面板切换到该候选人
  await sleep(900);
  const openedName = await waitForChat(page, String(c.name));
  if (!openedName || !openedName.includes(String(c.name))) {
    console.log(`  ✗ ${label}：右侧打开的是「${openedName || '空'}」，不是目标候选人`);
    failed += 1;
    continue;
  }

  let snap = null;
  for (let attempt = 0; attempt < 2 && !snap; attempt++) {
    try {
      snap = await readCurrentChat(page, openedName);
    } catch (err) {
      await sleep(1_200);
    }
  }
  if (!snap) {
    console.log(`  ✗ ${label}：读取聊天记录失败`);
    failed += 1;
    continue;
  }

  const actualName = String(snap.candidate.name || '').replace(/\s+/g, '');
  const expectName = String(c.name).replace(/\s+/g, '');
  if (actualName && actualName !== expectName && !actualName.includes(expectName)) {
    console.log(`  ✗ ${label}：打开的会话是「${actualName}」，名字不匹配，跳过`);
    failed += 1;
    continue;
  }

  const messages = Array.isArray(snap.messages) ? snap.messages : [];
  const friendTexts = messages.filter((m) => m.from === 'friend').map((m) => m.text || '');
  const myTexts = messages.filter((m) => m.from === 'myself').map((m) => m.text || '');
  const hasResume = !!snap.hasFriendResumeAttachment;

  const askedBefore = myTexts.some((t) => /上海/.test(t) && /简历/.test(t));
  const city = parseCity(friendTexts);
  const interview = parseInterview(friendTexts);
  const hasReply = friendTexts.length > 0;

  if (hasReply) replied += 1;

  // 回写解析结果
  if (hasReply || hasResume) {
    upsertTrackedCandidate({
      name: c.name,
      job: c.job,
      stage: hasReply ? 'replied' : undefined,
      replyCity: city.city || undefined,
      replyInShanghai: city.inShanghai === null ? undefined : city.inShanghai,
      replyInterview: interview.canInterview === null ? undefined : interview.canInterview,
      replySummary: summarizeReply(city, interview, hasResume, friendTexts) || undefined,
      replyRaw: friendTexts.filter(Boolean).at(-1)?.slice(0, 300) || undefined,
      replyAt: new Date().toISOString(),
      resumeReceived: hasResume || undefined,
      event: 'reply_parsed',
      eventDetail: summarizeReply(city, interview, hasResume, friendTexts) || '已回复',
    });
  }

  // 批量下载已收到的附件简历 PDF
  if (args.download) {
    if (!hasResume) {
      console.log(`  · ${label}：没有收到附件简历`);
      skipped += 1;
      continue;
    }
    const saved = await downloadAttachmentPdf(page, String(c.name), c.geekId);
    if (saved) {
      upsertTrackedCandidate({
        name: c.name,
        job: c.job,
        resumePdfPath: saved.file,
        resumeReceived: true,
        event: 'resume_downloaded',
        eventDetail: `${saved.title || '附件简历'}（${Math.round(saved.size / 1024)}KB）`,
      });
      console.log(`  ✓ ${label}：已保存 ${saved.title || ''}（${Math.round(saved.size / 1024)}KB）`);
      sent += 1;
    } else {
      console.log(`  ✗ ${label}：附件简历下载失败（预览可能未加载）`);
      failed += 1;
    }
    continue;
  }

  // 批量同意对方的「交换附件简历」请求
  if (args.agree) {
    const pendingRequest = messages.some(
      (m) => m.from === 'friend' && /想发送附件简历|是否同意/.test(m.text || ''),
    );
    if (!pendingRequest) {
      console.log(`  · ${label}：无待同意的简历请求`);
    } else {
      const r = runCli(['action', 'agree-resume', '--confirm', '--json'], 120_000);
      const ok = /"executed"\s*:\s*true/.test(r.out);
      console.log(`  ${ok ? '✓' : '✗'} ${label}：${ok ? '已同意接收附件简历' : '同意失败'}`);
    }
    skipped += 1;
    continue;
  }

  if (args.collectOnly) {
    console.log(
      `  ${hasReply ? '✓' : '·'} ${label}：${hasReply ? summarizeReply(city, interview, hasResume, friendTexts) : '暂无回复'}`,
    );
    if (hasReply) replied += 1;
    skipped += 1;
    continue;
  }

  if (askedBefore && !args.resend) {
    console.log(
      `  – ${label}：${hasReply ? `已回复「${summarizeReply(city, interview, hasResume, friendTexts)}」` : '已问过，等回复'}`,
    );
    skipped += 1;
    continue;
  }

  await sleep(args.gapMs);
  const r = runCli(['send', '--to', c.name, '-t', MESSAGE_TEXT, '--confirm', '--json'], 300_000);
  const ok = /"executed"\s*:\s*true/.test(r.out);
  if (ok) {
    sent += 1;
    upsertTrackedCandidate({
      name: c.name,
      job: c.job,
      // send 命令会把 stage 重置为 greeted，这里按是否已回复改回来
      stage: hasReply ? 'replied' : 'greeted',
      askedResumeAt: new Date().toISOString(),
      event: 'asked_resume',
      eventDetail: '索要简历 + 确认是否在上海 / 能否现场面试',
    });
    console.log(
      `  ✓ ${label}：已发送${hasReply ? `（对方已回：${summarizeReply(city, interview, hasResume, friendTexts)}）` : ''}`,
    );
  } else {
    failed += 1;
    const msg = (r.out || r.err).trim().split('\n').filter(Boolean).pop() || '未知错误';
    console.log(`  ✗ ${label}：发送失败 — ${msg.slice(0, 80)}`);
  }
}

console.log(`\n完成：发送 ${sent} 人，跳过 ${skipped} 人，有回复 ${replied} 人，失败 ${failed} 人`);
