#!/usr/bin/env node
/**
 * 按岗位给候选人标注「评分前 N% 重点池」（写台账 isTop30 字段）。
 *
 * 用法：
 *   node scripts/mark-top.mjs --job 讲解员 --ratio 0.3
 *   node scripts/mark-top.mjs --job 讲解员 --count 60
 *   node scripts/mark-top.mjs --job 讲解员 --ratio 0.3 --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TRACKER = join(homedir(), '.boss-cli/tracker.json');

function parseArgs(argv) {
  const out = { job: '讲解员', ratio: 0.3, count: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--job') out.job = argv[++i] ?? '';
    else if (a === '--ratio') out.ratio = Number(argv[++i]);
    else if (a === '--count') out.count = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const store = JSON.parse(readFileSync(TRACKER, 'utf8'));
const all = Object.values(store.candidates || {});

const pool = all
  .filter((c) => (c.job || '').includes(args.job) && typeof c.score === 'number')
  .sort((a, b) => b.score - a.score);

const take = args.count > 0 ? Math.min(args.count, pool.length) : Math.round(pool.length * args.ratio);
const cutoff = pool[Math.max(0, take - 1)]?.score ?? 0;

console.log(
  `${args.job}：${pool.length} 人，取前 ${take} 名（${args.ratio ? `${Math.round(args.ratio * 100)}%` : '指定人数'}），分数线 ${cutoff}`,
);

const topIds = new Set(pool.slice(0, take).map((c) => c.id));

let marked = 0;
let cleared = 0;
for (const c of all) {
  const shouldMark = topIds.has(c.id);
  if (shouldMark) {
    if (!c.isTop30) marked += 1;
    if (!args.dryRun) c.isTop30 = true;
  } else if (c.isTop30) {
    cleared += 1;
    if (!args.dryRun) c.isTop30 = false;
  }
}

if (!args.dryRun) {
  store.updatedAt = new Date().toISOString();
  writeFileSync(TRACKER, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}
console.log(`新标记 ${marked} 人，取消标记 ${cleared} 人${args.dryRun ? '（dry-run 未写入）' : ''}`);
console.log(
  `前 ${take} 名：${pool.slice(0, take).map((c) => `${c.name}${c.score}`).join('、')}`,
);
