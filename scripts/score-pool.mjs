#!/usr/bin/env node
/**
 * 把「推荐牛人」快照按岗位打分后写入台账（离线批量）。
 *
 * 用法：
 *   node scripts/score-pool.mjs --preset jiangjie --job 讲解员 --in a.json b.json
 *   node scripts/score-pool.mjs --preset jiangjie --job 讲解员 --in a.json --dry-run
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PRESETS } from './lib/score-presets.mjs';

const REPO = join(import.meta.dirname, '..');
const { upsertTrackedCandidate, findTrackedCandidate } = await import(join(REPO, 'dist/common/tracker.js'));

function parseArgs(argv) {
  const out = { preset: 'jiangjie', job: '讲解员', inputs: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preset') out.preset = argv[++i];
    else if (a === '--job') out.job = argv[++i];
    else if (a === '--in') {
      i += 1;
      while (i < argv.length && !argv[i].startsWith('--')) out.inputs.push(argv[i++]);
      i -= 1;
    } else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const scorer = PRESETS[args.preset];
if (!scorer) {
  console.error(`未知 preset: ${args.preset}`);
  process.exit(1);
}
if (!args.inputs.length) {
  console.error('缺少 --in <快照.json ...>');
  process.exit(1);
}

const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

// 多份快照合并：同一 geekId 取信息最全的一条
const byId = new Map();
for (const file of args.inputs) {
  const raw = JSON.parse(readFileSync(expand(file), 'utf8'));
  for (const c of raw.candidates ?? []) {
    if (!c?.name) continue;
    const key = c.geekId || `${c.name}|${c.baseInfo}`;
    const prev = byId.get(key);
    const weight = (x) => String(x.advantage ?? '').length + String(x.experience ?? '').length;
    if (!prev || weight(c) > weight(prev)) byId.set(key, c);
  }
}

const rows = [];
const skipped = [];
for (const c of byId.values()) {
  // 一个人台账里只有一条记录（按 geekId），已归属其他岗位的不抢过来
  const tracked = findTrackedCandidate({ geekId: c.geekId || undefined, name: c.name, job: args.job });
  const currentJob = (tracked?.job ?? '').trim();
  if (currentJob && !currentJob.includes(args.job) && !args.job.includes(currentJob)) {
    skipped.push(`${c.name}（已在「${currentJob}」）`);
    continue;
  }
  const scored = scorer(c);
  rows.push({ c, ...scored });
  if (!args.dryRun) {
    upsertTrackedCandidate({
      geekId: c.geekId || undefined,
      name: c.name,
      job: args.job,
      source: 'recommend',
      activeStatus: c.activeStatus,
      canGreet: c.canGreet,
      hasViewed: c.hasViewed,
      hasHistoryChat: c.hasHistoryChat,
      stage: 'new',
      score: scored.score,
      summary: scored.summary,
      reason: scored.reason,
      facts: scored.facts,
      dimensions: scored.dimensions,
      highlights: scored.highlights,
      risks: scored.risks,
      event: 'scored',
      eventDetail: `${args.preset} 规则评分 ${scored.score}`,
    });
  }
}

rows.sort((a, b) => b.score - a.score);
console.log(`${args.dryRun ? '[dry-run] ' : ''}共 ${rows.length} 人，写入岗位「${args.job}」`);
if (skipped.length) console.log(`跳过 ${skipped.length} 人（已在其他岗位）：${skipped.join('、')}`);
console.log(
  '分数分布：',
  [90, 80, 70, 60, 50, 0].map((t) => `≥${t}: ${rows.filter((r) => r.score >= t).length}`).join(' · '),
);
console.log('前 15：');
for (const r of rows.slice(0, 15)) {
  console.log(`  ${String(r.score).padStart(3)}  ${r.c.name}  ${r.c.baseInfo}  | ${r.summary}`);
}
