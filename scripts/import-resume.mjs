#!/usr/bin/env node
/**
 * 导入外部简历（PDF）到伯乐台。
 *
 * 典型场景：从 51job / 邮件 / 微信收到候选人 PDF 简历，想和 BOSS 上的候选人放到同一块看板里比较。
 *
 * 做的事情：
 *   1. 用 macOS PDFKit 抽取 PDF 文本（文本型 PDF；扫描件会提示改用 OCR）
 *   2. 从文件名 + 正文推断姓名
 *   3. 解析成结构化简历（复用 src/resume/parse_online_resume.ts 的版式解析）
 *   4. 把 PDF 归档到 ~/.boss-cli/resumes/pdf/<姓名>.pdf，结构化存档写到 ~/.boss-cli/resumes/online/<姓名>.json
 *   5. 写入台账（source=external），并按需带上评估结果（分数 / 维度 / 亮点 / 风险）
 *   6. 重建 pipeline，让工作台立刻可见
 *
 * 用法：
 *   node scripts/import-resume.mjs <a.pdf> [b.pdf ...] [--job 新媒体运营] [--assessment eval.json] [--no-build]
 *
 * assessment JSON 形如：
 *   {
 *     "王俐琳": {
 *       "stage": "screened",
 *       "score": 75,
 *       "summary": "3 年新媒体运营…",
 *       "reason": "…",
 *       "facts": { "edu": "本科", "city": "上海", "latestWork": "…" },
 *       "dimensions": { "platform": 26, "content": 22, "ai": 5, "data": 13, "base": 9 },
 *       "highlights": ["…"],
 *       "risks": ["…"]
 *     }
 *   }
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOME = os.homedir();
const BOSS_DIR = join(HOME, '.boss-cli');
const PDF_DIR = join(BOSS_DIR, 'resumes', 'pdf');
const ONLINE_DIR = join(BOSS_DIR, 'resumes', 'online');

const { extractPdfText } = await import(join(REPO, 'dist/media/pdf_text.js'));
const { parseResumeText } = await import(join(REPO, 'dist/resume/parse_online_resume.js'));
const { upsertTrackedCandidate, findTrackedCandidate, listTrackedCandidates } = await import(
  join(REPO, 'dist/common/tracker.js')
);

function parseArgs(argv) {
  const files = [];
  const opts = { job: '新媒体运营', assessment: '', build: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--job') opts.job = argv[++i] || opts.job;
    else if (arg === '--assessment') opts.assessment = argv[++i] || '';
    else if (arg === '--no-build') opts.build = false;
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else files.push(arg);
  }
  return { files, opts };
}

const NOISE_NAME_TOKENS = new Set([
  '51job',
  'boss',
  '简历',
  '求职',
  '应聘',
  '新媒体',
  '运营',
  '专员',
  '实习生',
  '实习',
  '上海',
  '北京',
  '深圳',
  '杭州',
  '广州',
  '方向',
  'ai',
  '2024',
  '2025',
  '2026',
]);

/** 从文件名推断姓名：`51job_郑文洁_新媒体运营专员ai方向(174278155).pdf` → 郑文洁 */
function nameFromFile(file) {
  const base = basename(file, extname(file)).replace(/\(\d+\)/g, '');
  const tokens = base
    .split(/[_\-—\s]+/)
    .map((t) => t.replace(/^\d+|\d+$/g, '').trim())
    .filter(Boolean);
  const cjk = tokens.filter(
    (t) => /^[\u4e00-\u9fa5]{2,4}$/.test(t) && !NOISE_NAME_TOKENS.has(t.toLowerCase()),
  );
  return cjk[0] || '';
}

/** 区块标题等不是人名的常见词 */
const SECTION_WORDS = new Set([
  '教育背景',
  '教育经历',
  '工作经历',
  '实习经历',
  '项目经历',
  '自我评价',
  '专业技能',
  '基本信息',
  '联系方式',
  '求职意向',
  '荣誉奖项',
  '获奖经历',
  '个人优势',
]);

/** 正文里出现且像人名的 2~4 字中文串（兜底，文件名优先） */
function nameFromText(text, fileHint) {
  if (fileHint) return fileHint;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const line of lines) {
    const m = /^([\u4e00-\u9fa5]{2,4})$/.exec(line);
    if (m && !NOISE_NAME_TOKENS.has(m[1]) && !SECTION_WORDS.has(m[1])) return m[1];
  }
  return '';
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function pickFirstSection(structured, keys) {
  for (const key of keys) {
    const sec = structured.sections.find((s) => s.key === key && (s.items.length || s.paragraphs?.length));
    if (sec) return sec;
  }
  return null;
}

/** 从结构化简历 + 原文里推导看板需要的 facts */
function deriveFacts(structured, text) {
  const facts = {};
  const work = pickFirstSection(structured, ['work']);
  const edu = pickFirstSection(structured, ['education']);
  const firstWork = work?.items[0];
  if (firstWork) {
    const org = (firstWork.org || firstWork.headline || '').replace(/[｜|]\s*$/, '').trim();
    const role = (firstWork.role || '').trim();
    if (org) facts.latestWork = role ? `${org} · ${role}` : org;
  }
  const firstEdu = edu?.items[0];
  if (firstEdu) {
    const school = (firstEdu.org || firstEdu.headline || '').trim();
    const major = (firstEdu.role || '').trim();
    if (school) facts.school = [school, major].filter(Boolean).join(' · ');
  }
  const age = /(\d{2})\s*岁/.exec(text);
  if (age) facts.age = `${age[1]}岁`;
  const eduWord = /(博士|硕士|本科|大专|高中)/.exec(facts.school || text);
  if (eduWord) facts.edu = eduWord[1];
  const cityMatch = /(上海|北京|深圳|杭州|广州|成都|苏州|南京|武汉)/.exec(text);
  if (cityMatch) facts.city = cityMatch[1];
  const salary = /(\d{1,2}\s*[-~]\s*\d{1,2}\s*[Kk]|\d{3,5}\s*[-~]\s*\d{3,5}\s*元?\/?月?)/.exec(text);
  if (salary) facts.salary = salary[1].replace(/\s+/g, '');
  return facts;
}

function formatSummary(facts, job) {
  const left = [facts.age, facts.exp, facts.edu].filter(Boolean).join(' / ');
  const right = [facts.city, facts.latestWork || job].filter(Boolean).join(' · ');
  return left && right ? `${left}｜${right}` : '';
}

async function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));
  if (!files.length) {
    console.error('用法：node scripts/import-resume.mjs <a.pdf> [b.pdf ...] [--job 新媒体运营] [--assessment eval.json]');
    process.exit(2);
  }

  const assessments = opts.assessment
    ? JSON.parse(readFileSync(opts.assessment, 'utf8'))
    : {};

  mkdirSync(PDF_DIR, { recursive: true });
  mkdirSync(ONLINE_DIR, { recursive: true });

  // 同一份文件被重复拖入（微信常见 xxx(1).pdf）时只处理一次
  const seenHash = new Map();
  const unique = [];
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`跳过（文件不存在）：${file}`);
      continue;
    }
    if (!/\.pdf$/i.test(file)) {
      console.error(`跳过（不是 PDF）：${file}`);
      continue;
    }
    const hash = fileHash(file);
    if (seenHash.has(hash)) {
      console.log(`跳过重复文件：${basename(file)}（与 ${seenHash.get(hash)} 相同）`);
      continue;
    }
    seenHash.set(hash, basename(file));
    unique.push(file);
  }
  if (!unique.length) return;

  const docs = await extractPdfText(unique);
  const imported = [];

  for (const doc of docs) {
    const file = doc.file;
    const label = basename(file);
    if (doc.error) {
      console.error(`✗ ${label}：${doc.error}`);
      continue;
    }
    const text = String(doc.text || '').replace(/\r\n/g, '\n').trim();
    if (text.length < 60) {
      console.error(`✗ ${label}：没有可提取文本（可能是扫描件），请改用 OCR 或人工确认`);
      continue;
    }

    const fileHint = nameFromFile(file);
    const name = nameFromText(text, fileHint) || fileHint;
    if (!name) {
      console.error(`✗ ${label}：无法识别姓名，请把文件名改成「姓名_岗位.pdf」后重试`);
      continue;
    }

    // 同名但不同岗位时不动台账，避免把已有候选人改岗
    const sameName = listTrackedCandidates().filter((c) => c.name === name);
    const conflicting = sameName.find((c) => c.job && c.job !== opts.job);
    if (conflicting) {
      console.error(`✗ ${name}：台账里已有岗位「${conflicting.job}」，为避免覆盖已跳过`);
      continue;
    }

    // 外部 PDF 版式差异大（51job / BOSS 导出 / 自设计模板），不强行套两栏模板；
    // 只做事实抽取，阅读以原始 PDF 为准。
    const parsed = parseResumeText(text);

    const pdfTarget = join(PDF_DIR, `${name}.pdf`);
    copyFileSync(file, pdfTarget);

    const onlinePath = join(ONLINE_DIR, `${name}.json`);
    writeFileSync(
      onlinePath,
      `${JSON.stringify(
        {
          candidate: name,
          capturedAt: new Date().toISOString(),
          source: 'pdf-import',
          method: 'pdf',
          fileName: label,
          text,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const autoFacts = deriveFacts(parsed, text);
    const assess = assessments[name] || {};
    const facts = { ...autoFacts, ...(assess.facts || {}) };
    const tracked = upsertTrackedCandidate({
      name,
      job: opts.job,
      source: 'external',
      stage: assess.stage || 'new',
      score: assess.score,
      summary: assess.summary || formatSummary(facts, opts.job),
      reason: assess.reason,
      facts,
      dimensions: assess.dimensions,
      highlights: assess.highlights,
      risks: assess.risks,
      resumeTextPath: '',
      resumePdfPath: pdfTarget,
      onlineResumePath: onlinePath,
      hasViewed: true,
      event: 'resume_imported',
      eventDetail: `pdf=${label}`,
    });

    imported.push({ name, tracked });
    console.log(
      `✓ ${name}：${doc.pageCount} 页，stage=${tracked.stage}${typeof tracked.score === 'number' ? `，score=${tracked.score}` : ''}`,
    );
  }

  if (opts.build && imported.length) {
    console.log('\n重建 pipeline…');
    execFileSync(process.execPath, [join(REPO, 'web', 'build.mjs')], { cwd: REPO, stdio: 'inherit' });
  }

  console.log(`\n完成：导入 ${imported.length} 人（岗位：${opts.job}）`);
}

await main();
