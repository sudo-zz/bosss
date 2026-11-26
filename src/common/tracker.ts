/**
 * 本地候选人筛选台账（~/.boss-cli/tracker.json）。
 *
 * 解决原版 boss-cli 完全无状态的问题：
 * - 跨轮对话与多次筛选任务自动去重，避免重复查看简历浪费每日额度
 * - 沉淀岗位匹配评分、核心亮点、风险点与阶段（shortlisted / interview / rejected 等）
 * - 支持一键导出 Markdown 面试候选人短名单
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureAppDataLayout, TRACKER_FILE } from '../config.js';

export const CANDIDATE_STAGES = [
  'new',
  'screened',
  'shortlisted',
  'greeted',
  'replied',
  'interview',
  'rejected',
  'hold',
] as const;

export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export type TrackedCandidate = {
  id: string;
  geekId?: string;
  name: string;
  job?: string;
  source?: string;
  activeStatus?: string;
  canGreet?: boolean;
  hasViewed?: boolean;
  hasHistoryChat?: boolean;
  stage: CandidateStage;
  score?: number;
  summary?: string;
  reason?: string;
  notes?: string;
  resumeTextPath?: string;
  resumeScreenshotPath?: string;
  resumePdfPath?: string;
  onlineResumePath?: string;
  createdAt: string;
  updatedAt: string;
  history: Array<{ at: string; event: string; detail?: string }>;
};

type TrackerStore = {
  version: 1;
  updatedAt: string;
  candidates: Record<string, TrackedCandidate>;
};

export function isValidStage(value: string): value is CandidateStage {
  return (CANDIDATE_STAGES as readonly string[]).includes(value);
}

function normalizeKeyPart(v: string | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildCandidateKey(params: {
  geekId?: string;
  name: string;
  job?: string;
}): string {
  const gid = (params.geekId ?? '').trim();
  if (gid) {
    return `geek:${gid}`;
  }
  const n = normalizeKeyPart(params.name);
  const j = normalizeKeyPart(params.job);
  return j ? `name:${n}::${j}` : `name:${n}`;
}

function loadStore(): TrackerStore {
  ensureAppDataLayout();
  if (!existsSync(TRACKER_FILE)) {
    return { version: 1, updatedAt: new Date().toISOString(), candidates: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(TRACKER_FILE, 'utf8')) as Partial<TrackerStore>;
    return {
      version: 1,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      candidates:
        raw.candidates && typeof raw.candidates === 'object'
          ? (raw.candidates as Record<string, TrackedCandidate>)
          : {},
    };
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), candidates: {} };
  }
}

function saveStore(store: TrackerStore): void {
  ensureAppDataLayout();
  store.updatedAt = new Date().toISOString();
  writeFileSync(TRACKER_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function findTrackedCandidate(query: {
  id?: string;
  geekId?: string;
  name?: string;
  job?: string;
}): TrackedCandidate | null {
  const store = loadStore();
  if (query.id && store.candidates[query.id]) {
    return store.candidates[query.id]!;
  }
  const gid = (query.geekId ?? '').trim();
  if (gid) {
    const byKey = store.candidates[`geek:${gid}`];
    if (byKey) return byKey;
    const found = Object.values(store.candidates).find((c) => c.geekId === gid);
    if (found) return found;
  }
  const nameNorm = normalizeKeyPart(query.name);
  if (!nameNorm) return null;
  const jobNorm = normalizeKeyPart(query.job);
  const all = Object.values(store.candidates);
  if (jobNorm) {
    const exactBoth = all.find(
      (c) => normalizeKeyPart(c.name) === nameNorm && normalizeKeyPart(c.job) === jobNorm,
    );
    if (exactBoth) return exactBoth;
  }
  return all.find((c) => normalizeKeyPart(c.name) === nameNorm) ?? null;
}

export function upsertTrackedCandidate(input: {
  geekId?: string;
  name: string;
  job?: string;
  source?: string;
  activeStatus?: string;
  canGreet?: boolean;
  hasViewed?: boolean;
  hasHistoryChat?: boolean;
  stage?: CandidateStage;
  score?: number;
  summary?: string;
  reason?: string;
  notes?: string;
  resumeTextPath?: string;
  resumeScreenshotPath?: string;
  resumePdfPath?: string;
  onlineResumePath?: string;
  event?: string;
  eventDetail?: string;
}): TrackedCandidate {
  const store = loadStore();
  const existing = findTrackedCandidate({
    geekId: input.geekId,
    name: input.name,
    job: input.job,
  });
  const now = new Date().toISOString();
  const id = existing?.id ?? buildCandidateKey({ geekId: input.geekId, name: input.name, job: input.job });

  const next: TrackedCandidate = {
    id,
    geekId: input.geekId?.trim() || existing?.geekId,
    name: input.name.trim() || existing?.name || '未命名',
    job: input.job?.trim() || existing?.job,
    source: input.source?.trim() || existing?.source,
    activeStatus: input.activeStatus?.trim() || existing?.activeStatus,
    canGreet: input.canGreet !== undefined ? input.canGreet : existing?.canGreet,
    hasViewed: input.hasViewed !== undefined ? input.hasViewed : existing?.hasViewed,
    hasHistoryChat: input.hasHistoryChat !== undefined ? input.hasHistoryChat : existing?.hasHistoryChat,
    stage: input.stage ?? existing?.stage ?? 'screened',
    score: input.score !== undefined ? input.score : existing?.score,
    summary: input.summary?.trim() || existing?.summary,
    reason: input.reason?.trim() || existing?.reason,
    notes: input.notes?.trim() || existing?.notes,
    resumeTextPath: input.resumeTextPath || existing?.resumeTextPath,
    resumeScreenshotPath: input.resumeScreenshotPath || existing?.resumeScreenshotPath,
    resumePdfPath: input.resumePdfPath || existing?.resumePdfPath,
    onlineResumePath: input.onlineResumePath || existing?.onlineResumePath,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    history: [...(existing?.history ?? [])],
  };

  if (input.event) {
    next.history.push({ at: now, event: input.event, detail: input.eventDetail });
  } else if (!existing) {
    next.history.push({ at: now, event: 'created', detail: `stage=${next.stage}` });
  } else if (input.stage && input.stage !== existing.stage) {
    next.history.push({ at: now, event: 'stage_change', detail: `${existing.stage} -> ${input.stage}` });
  } else if (input.score !== undefined && input.score !== existing.score) {
    next.history.push({ at: now, event: 'scored', detail: `score=${input.score}` });
  }

  store.candidates[id] = next;
  saveStore(store);
  return next;
}

export function listTrackedCandidates(filter: {
  job?: string;
  stage?: CandidateStage;
  minScore?: number;
} = {}): TrackedCandidate[] {
  const store = loadStore();
  const jobNeedle = normalizeKeyPart(filter.job);
  return Object.values(store.candidates)
    .filter((c) => {
      if (jobNeedle && !normalizeKeyPart(c.job).includes(jobNeedle)) {
        return false;
      }
      if (filter.stage && c.stage !== filter.stage) {
        return false;
      }
      if (filter.minScore !== undefined && (c.score === undefined || c.score < filter.minScore)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      if (sb !== sa) return sb - sa;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function getTrackerStats(job?: string): {
  total: number;
  byStage: Record<CandidateStage, number>;
  avgScore: number | null;
} {
  const list = listTrackedCandidates({ job });
  const byStage = {} as Record<CandidateStage, number>;
  for (const s of CANDIDATE_STAGES) {
    byStage[s] = 0;
  }
  let scoreSum = 0;
  let scoreCount = 0;
  for (const c of list) {
    byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;
    if (typeof c.score === 'number') {
      scoreSum += c.score;
      scoreCount += 1;
    }
  }
  return {
    total: list.length,
    byStage,
    avgScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
  };
}

export function renderTrackerMarkdown(
  candidates: TrackedCandidate[],
  title = '候选人筛选台账',
): string {
  const lines: string[] = [
    `# ${title}`,
    '',
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    `- 候选人总数：${candidates.length}`,
    '',
  ];
  if (candidates.length === 0) {
    lines.push('暂无记录。');
    return lines.join('\n');
  }
  lines.push('| # | 姓名 | 岗位 | 阶段 | 评分 | 摘要 / 评估理由 | 更新时间 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  candidates.forEach((c, idx) => {
    const score = c.score !== undefined ? `${c.score}` : '-';
    const desc = [c.summary, c.reason, c.notes].filter(Boolean).join('；').replace(/\|/g, '｜');
    lines.push(
      `| ${idx + 1} | ${c.name} | ${c.job ?? '-'} | ${c.stage} | ${score} | ${desc || '-'} | ${c.updatedAt.slice(0, 16).replace('T', ' ')} |`,
    );
  });
  return lines.join('\n');
}
