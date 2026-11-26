/**
 * 候选人本地筛选台账命令（`boss tracker ...`）与配额查询命令（`boss quota`）。
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getQuotaSummary } from '../common/safety.js';
import {
  CANDIDATE_STAGES,
  findTrackedCandidate,
  getTrackerStats,
  isValidStage,
  listTrackedCandidates,
  renderTrackerMarkdown,
  upsertTrackedCandidate,
  type CandidateStage,
} from '../common/tracker.js';
import { TRACKER_FILE } from '../config.js';

export function runQuotaCommand(opts: { json?: boolean } = {}): string {
  const summary = getQuotaSummary();
  if (opts.json) {
    return JSON.stringify(summary, null, 2);
  }
  const lines: string[] = [
    `=== 今日安全配额（${summary.date}）===`,
    `写操作默认模式：${summary.writeDefaultMode}`,
    `写操作最小间隔：${summary.minWriteIntervalSec} 秒`,
    '',
    `打招呼 (greet)：${summary.quotas.greet.used}/${summary.quotas.greet.limit}`,
    `发消息 (send)：${summary.quotas.send.used}/${summary.quotas.send.limit}`,
    `在线简历查看 (preview/resume)：${summary.quotas.preview.used}/${summary.quotas.preview.limit}`,
    `深度搜索匹配 (deep-search --match)：${summary.quotas.deep_search_match.used}/${summary.quotas.deep_search_match.limit}`,
    `求简历 (request-resume)：${summary.quotas.request_resume.used}/${summary.quotas.request_resume.limit}`,
    `换微信 (wechat)：${summary.quotas.wechat.used}/${summary.quotas.wechat.limit}`,
    `不合适 (not-fit)：${summary.quotas.not_fit.used}/${summary.quotas.not_fit.limit}`,
    `备注 (remark)：${summary.quotas.remark.used}/${summary.quotas.remark.limit}`,
  ];
  return lines.join('\n');
}

export async function runTrackerCommand(params: {
  subcommand: 'list' | 'get' | 'upsert' | 'stats' | 'export';
  target?: string;
  name?: string;
  geekId?: string;
  job?: string;
  source?: string;
  stage?: string;
  score?: number;
  minScore?: number;
  summary?: string;
  reason?: string;
  notes?: string;
  resumePdfPath?: string;
  onlineResumePath?: string;
  outPath?: string;
  json?: boolean;
}): Promise<string> {
  if (params.stage && !isValidStage(params.stage)) {
    throw new Error(`无效阶段「${params.stage}」，可选值：${CANDIDATE_STAGES.join(' | ')}`);
  }
  const stage = params.stage as CandidateStage | undefined;

  if (params.subcommand === 'stats') {
    const stats = getTrackerStats(params.job);
    if (params.json) {
      return JSON.stringify({ file: TRACKER_FILE, ...stats }, null, 2);
    }
    const stageStr = CANDIDATE_STAGES.map((s) => `${s}:${stats.byStage[s]}`).join('｜');
    return [
      `台账文件：${TRACKER_FILE}`,
      `候选人总数：${stats.total}${stats.avgScore !== null ? `｜平均分：${stats.avgScore}` : ''}`,
      `各阶段分布：${stageStr}`,
    ].join('\n');
  }

  if (params.subcommand === 'get') {
    const q = (params.target ?? params.name ?? '').trim();
    if (!q) throw new Error('用法：boss tracker get <姓名或ID> [--json]');
    const found =
      findTrackedCandidate({ id: q }) ??
      findTrackedCandidate({ geekId: q }) ??
      findTrackedCandidate({ name: q, job: params.job });
    if (!found) {
      throw new Error(`台账中未找到候选人：${q}`);
    }
    if (params.json) {
      return JSON.stringify(found, null, 2);
    }
    return [
      `ID: ${found.id}`,
      `姓名: ${found.name}${found.geekId ? ` (geekId: ${found.geekId})` : ''}`,
      `岗位: ${found.job ?? '-'}｜来源: ${found.source ?? '-'}`,
      `阶段: ${found.stage}｜评分: ${found.score !== undefined ? found.score : '-'}`,
      ...(found.summary ? [`摘要: ${found.summary}`] : []),
      ...(found.reason ? [`评估理由: ${found.reason}`] : []),
      ...(found.notes ? [`备注: ${found.notes}`] : []),
      ...(found.resumeTextPath ? [`简历文本: ${found.resumeTextPath}`] : []),
      ...(found.resumeScreenshotPath ? [`简历截图: ${found.resumeScreenshotPath}`] : []),
      `更新时间: ${found.updatedAt}`,
    ].join('\n');
  }

  if (params.subcommand === 'upsert') {
    const name = (params.name ?? params.target ?? '').trim();
    if (!name) {
      throw new Error('用法：boss tracker upsert --name <姓名> [--geek-id <ID>] [--job <岗位>] [--stage <阶段>] [--score <0-100>] [--summary <摘要>] [--reason <理由>]');
    }
    if (params.score !== undefined && (!Number.isFinite(params.score) || params.score < 0 || params.score > 100)) {
      throw new Error(`评分必须在 0 到 100 之间，当前值：${params.score}`);
    }
    const saved = upsertTrackedCandidate({
      name,
      geekId: params.geekId,
      job: params.job,
      source: params.source,
      stage,
      score: params.score,
      summary: params.summary,
      reason: params.reason,
      notes: params.notes,
      resumePdfPath: params.resumePdfPath,
      onlineResumePath: params.onlineResumePath,
    });
    if (params.json) {
      return JSON.stringify(saved, null, 2);
    }
    return `已更新台账：${saved.name}（id=${saved.id}，stage=${saved.stage}${saved.score !== undefined ? `，score=${saved.score}` : ''}）`;
  }

  const list = listTrackedCandidates({
    job: params.job,
    stage,
    minScore: params.minScore,
  });

  if (params.subcommand === 'export') {
    const isJsonOut = params.json || (params.outPath?.toLowerCase().endsWith('.json') ?? false);
    const content = isJsonOut
      ? `${JSON.stringify({ total: list.length, candidates: list }, null, 2)}\n`
      : `${renderTrackerMarkdown(list, params.job ? `${params.job} - 面试候选人筛选表` : '面试候选人筛选表')}\n`;

    if (params.outPath) {
      const resolved = path.resolve(params.outPath);
      await writeFile(resolved, content, 'utf8');
      return `已导出 ${list.length} 位候选人至：${resolved}`;
    }
    return content.trimEnd();
  }

  if (params.json) {
    return JSON.stringify({ total: list.length, candidates: list }, null, 2);
  }
  if (list.length === 0) {
    return '本地筛选台账暂无匹配候选人。';
  }
  const lines = list.map((c, idx) => {
    const parts = [
      `${idx + 1}. ${c.name}`,
      c.job ? `岗位:${c.job}` : '',
      `阶段:${c.stage}`,
      c.score !== undefined ? `评分:${c.score}` : '',
      c.reason ? `理由:${c.reason}` : c.summary ? `摘要:${c.summary}` : '',
    ].filter(Boolean);
    return parts.join('｜');
  });
  return [`本地筛选台账（共 ${list.length} 人）：`, ...lines].join('\n');
}
