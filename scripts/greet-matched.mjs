#!/usr/bin/env node
/**
 * 「推荐牛人」扫一批 → 打分入库 → 对达标的当场打招呼。
 *
 * BOSS 每次加载推荐列表都会换一批人，所以没法「先收 100 人再统一打招呼」：
 * 只能在当前这页上看到谁就给谁打，脚本按轮次循环，直到今日配额用完。
 *
 * 用法：
 *   node scripts/greet-matched.mjs --job 讲解员 [--min-score 60] [--rounds 8] [--max-total 180]
 *   加 --dry-run 只打分不打招呼
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PRESETS } from './lib/score-presets.mjs';

const REPO = join(import.meta.dirname, '..');
const CLI = join(REPO, 'dist/cli/index.js');
const TRACKER = join(homedir(), '.boss-cli/tracker.json');
const { upsertTrackedCandidate, findTrackedCandidate } = await import(
  join(REPO, 'dist/common/tracker.js')
);

function parseArgs(argv) {
  const out = {
    job: '讲解员',
    preset: 'jiangjie',
    minScore: 60,
    rounds: 8,
    limit: 60,
    maxTotal: 180,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--job') out.job = argv[++i];
    else if (a === '--preset') out.preset = argv[++i];
    else if (a === '--min-score') out.minScore = Number(argv[++i]);
    else if (a === '--rounds') out.rounds = Number(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--max-total') out.maxTotal = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const scorer = PRESETS[args.preset];
if (!scorer) {
  console.error(`未知 preset: ${args.preset}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runCli(argv, timeout = 240_000) {
  const r = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: REPO,
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function greetQuota() {
  const r = runCli(['quota', '--json'], 60_000);
  try {
    const j = JSON.parse(r.out);
    return j.quotas?.greet ?? null;
  } catch {
    return null;
  }
}

function countInJob() {
  try {
    const store = JSON.parse(readFileSync(TRACKER, 'utf8'));
    return Object.values(store.candidates || {}).filter((c) => (c.job || '').includes(args.job))
      .length;
  } catch {
    return 0;
  }
}

function sameJob(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  return x.includes(y) || y.includes(x);
}

const greeted = new Set();
let greetedCount = 0;
let addedCount = 0;

for (let round = 1; round <= args.rounds; round++) {
  const q0 = greetQuota();
  if (q0 && q0.limit - q0.used <= 0) {
    console.log('今日打招呼配额已用完');
    break;
  }

  let list = [];
  for (let attempt = 0; attempt < 2 && !list.length; attempt++) {
    const rec = runCli(['recommend', args.job, '--limit', String(args.limit), '--json'], 300_000);
    try {
      list = JSON.parse(rec.out).candidates || [];
    } catch {
      console.error('读取推荐列表失败，重试：', (rec.out || rec.err).trim().slice(0, 120));
    }
  }
  if (!list.length) break;
  await sleep(2_500);

  const total = countInJob();
  const scored = [];
  for (const c of list) {
    if (!c?.name || !c.geekId) continue;
    const tracked = findTrackedCandidate({ geekId: c.geekId, name: c.name, job: args.job });
    if (tracked && tracked.job && !sameJob(tracked.job, args.job)) continue;
    if (tracked) {
      scored.push({ c, score: tracked.score ?? 0, stage: tracked.stage });
      continue;
    }
    if (total + addedCount >= args.maxTotal) continue;
    const s = scorer(c);
    scored.push({ c, score: s.score, stage: 'new' });
    addedCount += 1;
    if (!args.dryRun) {
      upsertTrackedCandidate({
        geekId: c.geekId,
        name: c.name,
        job: args.job,
        source: 'recommend',
        activeStatus: c.activeStatus,
        canGreet: c.canGreet,
        hasViewed: c.hasViewed,
        hasHistoryChat: c.hasHistoryChat,
        stage: 'new',
        score: s.score,
        summary: s.summary,
        reason: s.reason,
        facts: s.facts,
        dimensions: s.dimensions,
        highlights: s.highlights,
        risks: s.risks,
        event: 'scored',
        eventDetail: `${args.preset} 规则评分 ${s.score}`,
      });
    }
  }

  const targets = scored
    .filter((x) => x.c.canGreet && x.score >= args.minScore && x.stage !== 'greeted')
    .filter((x) => !greeted.has(x.c.geekId))
    .sort((a, b) => b.score - a.score);

  const q1 = greetQuota();
  console.log(
    `第 ${round} 轮：列表 ${list.length} 人，新增入库 ${addedCount} 人，达标可打招呼 ${targets.length} 人` +
      `（配额 ${q1 ? `${q1.used}/${q1.limit}` : '?'}）`,
  );

  for (const t of targets) {
    const q = greetQuota();
    if (q && q.limit - q.used <= 0) break;
    // BOSS 写操作最小间隔 10 秒，提前等够，避免被安全护栏拦下
    await sleep(10_500);
    if (args.dryRun) {
      console.log(`  [dry] ${t.score} ${t.c.name}`);
      greeted.add(t.c.geekId);
      continue;
    }
    let r = runCli(['greet', '--geek-id', t.c.geekId, '--confirm', '--json'], 180_000);
    let ok = /"executed"\s*:\s*true/.test(r.out) || /已对.*点击/.test(r.out);
    if (!ok) {
      // 推荐页刚加载完 iframe 还没挂好，等一会儿再试一次
      await sleep(3_000);
      r = runCli(['greet', '--geek-id', t.c.geekId, '--confirm', '--json'], 180_000);
      ok = /"executed"\s*:\s*true/.test(r.out) || /已对.*点击/.test(r.out);
    }
    console.log(
      `  ${ok ? '✓' : '✗'} ${t.score} ${t.c.name}${ok ? '' : `（${(r.out || r.err).trim().slice(0, 50)}）`}`,
    );
    if (ok) {
      greeted.add(t.c.geekId);
      greetedCount += 1;
    }
  }
}

console.log(`完成：新增入库 ${addedCount} 人，打招呼 ${greetedCount} 人`);
