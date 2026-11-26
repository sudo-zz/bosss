/**
 * 写操作安全护栏、每日配额保护与审计日志。
 *
 * 默认策略（筛选优先 + 写操作受控）：
 * - 所有对外变更/互动动作（greet、send、not-fit、wechat、request-attachment-resume、agree-resume、remark）
 *   默认运行在安全预演模式（dry-run），仅展示即将执行的内容与配额，不真正触发点击/发送。
 * - 只有显式传入 `--confirm`（或环境变量 `BOSS_ALLOW_WRITE=1`）时才真正执行。
 * - 同时强制检查单日配额上限与最小写入间隔，防止高频操作或误触发。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AUDIT_LOG_FILE, ensureAppDataLayout, QUOTA_FILE } from '../config.js';

export type QuotaAction =
  | 'greet'
  | 'send'
  | 'preview'
  | 'deep_search_match'
  | 'not_fit'
  | 'wechat'
  | 'request_resume'
  | 'agree_resume'
  | 'remark';

type DailyQuotaStore = {
  date: string;
  counts: Record<QuotaAction, number>;
  lastWriteAtMs: number;
};

const ALL_ACTIONS: QuotaAction[] = [
  'greet',
  'send',
  'preview',
  'deep_search_match',
  'not_fit',
  'wechat',
  'request_resume',
  'agree_resume',
  'remark',
];

function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emptyCounts(): Record<QuotaAction, number> {
  return {
    greet: 0,
    send: 0,
    preview: 0,
    deep_search_match: 0,
    not_fit: 0,
    wechat: 0,
    request_resume: 0,
    agree_resume: 0,
    remark: 0,
  };
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getDailyLimits(): Record<QuotaAction, number> {
  return {
    greet: readEnvInt('BOSS_MAX_DAILY_GREET', 20),
    send: readEnvInt('BOSS_MAX_DAILY_SEND', 40),
    preview: readEnvInt('BOSS_MAX_DAILY_PREVIEW', 30),
    deep_search_match: readEnvInt('BOSS_MAX_DAILY_DEEP_MATCH', 10),
    not_fit: readEnvInt('BOSS_MAX_DAILY_NOT_FIT', 20),
    wechat: readEnvInt('BOSS_MAX_DAILY_WECHAT', 15),
    request_resume: readEnvInt('BOSS_MAX_DAILY_REQUEST_RESUME', 30),
    agree_resume: readEnvInt('BOSS_MAX_DAILY_AGREE_RESUME', 50),
    remark: readEnvInt('BOSS_MAX_DAILY_REMARK', 100),
  };
}

export function getMinWriteIntervalSec(): number {
  return readEnvInt('BOSS_MIN_WRITE_INTERVAL_SEC', 10);
}

export function isWriteGloballyAllowed(): boolean {
  const v = (process.env.BOSS_ALLOW_WRITE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function loadQuotaStore(): DailyQuotaStore {
  ensureAppDataLayout();
  const today = todayKey();
  if (!existsSync(QUOTA_FILE)) {
    return { date: today, counts: emptyCounts(), lastWriteAtMs: 0 };
  }
  try {
    const parsed = JSON.parse(readFileSync(QUOTA_FILE, 'utf8')) as Partial<DailyQuotaStore>;
    if (parsed.date !== today) {
      return { date: today, counts: emptyCounts(), lastWriteAtMs: 0 };
    }
    const counts = emptyCounts();
    for (const k of ALL_ACTIONS) {
      const val = parsed.counts?.[k];
      counts[k] = typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0;
    }
    return {
      date: today,
      counts,
      lastWriteAtMs: typeof parsed.lastWriteAtMs === 'number' ? parsed.lastWriteAtMs : 0,
    };
  } catch {
    return { date: today, counts: emptyCounts(), lastWriteAtMs: 0 };
  }
}

function saveQuotaStore(store: DailyQuotaStore): void {
  ensureAppDataLayout();
  writeFileSync(QUOTA_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function appendAuditLog(entry: {
  action: QuotaAction;
  confirmed: boolean;
  dryRun: boolean;
  target?: string;
  detail?: string;
  status: 'dry_run' | 'executed' | 'blocked' | 'failed';
}): void {
  ensureAppDataLayout();
  const row = {
    at: new Date().toISOString(),
    ...entry,
  };
  appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(row)}\n`, 'utf8');
}

export function assertQuotaAndInterval(
  action: QuotaAction,
  opts: { isWriteAction: boolean } = { isWriteAction: true },
): { used: number; limit: number } {
  const store = loadQuotaStore();
  const limits = getDailyLimits();
  const used = store.counts[action] ?? 0;
  const limit = limits[action];

  if (limit > 0 && used >= limit) {
    appendAuditLog({
      action,
      confirmed: true,
      dryRun: false,
      detail: `quota_exceeded:${used}/${limit}`,
      status: 'blocked',
    });
    throw new Error(
      `安全护栏已拦截：今日 ${action} 次数已达上限（${used}/${limit}）。如需调整，可设置对应 BOSS_MAX_DAILY_* 环境变量。`,
    );
  }

  if (opts.isWriteAction && store.lastWriteAtMs > 0) {
    const minIntervalMs = getMinWriteIntervalSec() * 1000;
    const elapsed = Date.now() - store.lastWriteAtMs;
    if (minIntervalMs > 0 && elapsed < minIntervalMs) {
      const waitSec = Math.ceil((minIntervalMs - elapsed) / 1000);
      throw new Error(
        `安全护栏已拦截：距离上次写操作仅过 ${Math.floor(elapsed / 1000)} 秒（最小间隔 ${getMinWriteIntervalSec()} 秒），请等待 ${waitSec} 秒后再执行。`,
      );
    }
  }

  return { used, limit };
}

export function recordQuotaUsage(
  action: QuotaAction,
  opts: { isWriteAction: boolean; target?: string; detail?: string },
): void {
  const store = loadQuotaStore();
  store.counts[action] = (store.counts[action] ?? 0) + 1;
  if (opts.isWriteAction) {
    store.lastWriteAtMs = Date.now();
  }
  saveQuotaStore(store);
  appendAuditLog({
    action,
    confirmed: true,
    dryRun: false,
    target: opts.target,
    detail: opts.detail,
    status: 'executed',
  });
}

export type WriteGuardDecision =
  | { allowed: true }
  | { allowed: false; dryRunPayload: Record<string, unknown>; text: string };

/**
 * 统一写操作确认护栏：
 * 默认为预演模式（不真正执行），仅在 `--confirm` 或 `BOSS_ALLOW_WRITE=1` 且未显式 `--dry-run` 时放行。
 */
export function evaluateWriteGuard(params: {
  action: QuotaAction;
  actionLabel: string;
  target: string;
  detail?: string;
  confirm?: boolean;
  dryRun?: boolean;
  retryHint: string;
}): WriteGuardDecision {
  const explicitlyDryRun = params.dryRun === true;
  const confirmed = !explicitlyDryRun && (params.confirm === true || isWriteGloballyAllowed());
  const store = loadQuotaStore();
  const limits = getDailyLimits();
  const used = store.counts[params.action] ?? 0;
  const limit = limits[params.action];

  if (!confirmed) {
    appendAuditLog({
      action: params.action,
      confirmed: false,
      dryRun: true,
      target: params.target,
      detail: params.detail,
      status: 'dry_run',
    });
    const dryRunPayload = {
      dryRun: true,
      executed: false,
      action: params.action,
      actionLabel: params.actionLabel,
      target: params.target,
      detail: params.detail ?? null,
      quota: { used, limit },
      nextStep: params.retryHint,
    };
    const lines = [
      `[预演/未执行] ${params.actionLabel}`,
      `目标：${params.target}`,
      ...(params.detail ? [`内容：${params.detail}`] : []),
      `今日配额：${used}/${limit}`,
      `说明：当前处于「筛选优先 + 写操作受控」安全模式，未向 Boss 发送任何操作。`,
      `确认执行请追加 --confirm：${params.retryHint}`,
    ];
    return { allowed: false, dryRunPayload, text: lines.join('\n') };
  }

  assertQuotaAndInterval(params.action, { isWriteAction: true });
  return { allowed: true };
}

export function getQuotaSummary(): {
  date: string;
  writeDefaultMode: string;
  minWriteIntervalSec: number;
  quotas: Record<QuotaAction, { used: number; limit: number; remaining: number }>;
} {
  const store = loadQuotaStore();
  const limits = getDailyLimits();
  const quotas = {} as Record<QuotaAction, { used: number; limit: number; remaining: number }>;
  for (const k of ALL_ACTIONS) {
    const used = store.counts[k] ?? 0;
    const limit = limits[k];
    quotas[k] = { used, limit, remaining: Math.max(0, limit - used) };
  }
  return {
    date: store.date,
    writeDefaultMode: isWriteGloballyAllowed() ? 'allow-write (BOSS_ALLOW_WRITE=1)' : 'dry-run (需 --confirm)',
    minWriteIntervalSec: getMinWriteIntervalSec(),
    quotas,
  };
}
