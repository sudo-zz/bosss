// 配置文件 — 应用数据位于 ~/.boss-cli/

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 多数 Agent 客户端约定的 skills 根目录（如 `~/.agents/skills`）。
 * 可用 `BOSS_AGENT_SKILLS_DIR` 设为绝对路径以覆盖。
 */
export function getAgentSkillsDir(): string {
  const raw = process.env.BOSS_AGENT_SKILLS_DIR?.trim();
  if (raw && raw.length > 0) {
    return raw;
  }
  return join(homedir(), '.agents', 'skills');
}

/** 应用主目录 */
export const APP_HOME = join(homedir(), '.boss-cli');

/** 存放岗位 JD 的目录（每个岗位一个 .md 文件） */
export const JD_DIR = join(APP_HOME, 'jd');

/** 本地候选人筛选台账（去重、评分、阶段跟踪） */
export const TRACKER_FILE = join(APP_HOME, 'tracker.json');

/** 未读消息巡检快照（含候选人基础信息、聊天记录、头像本地路径） */
export const UNREAD_INSPECT_FILE = join(APP_HOME, 'unread-inspect.json');

/** 候选人头像与聊天照片下载目录 */
export const AVATARS_DIR = join(APP_HOME, 'avatars');

/** 本地简历持久化根目录（PDF 附件简历 + Boss 在线简历本地存档，不入库 git） */
export const RESUMES_DIR = join(APP_HOME, 'resumes');

/** 候选人附件 PDF 简历本地目录 */
export const RESUME_PDF_DIR = join(RESUMES_DIR, 'pdf');

/** Boss 在线简历结构化本地存档目录（.json / .md） */
export const RESUME_ONLINE_DIR = join(RESUMES_DIR, 'online');

/** 推荐牛人 / 精选牛人拉取快照目录 */
export const SOURCING_DIR = join(APP_HOME, 'sourcing');

/** 每日操作配额计数（保护账号安全与每日简历查看额度） */
export const QUOTA_FILE = join(APP_HOME, 'quota.json');

/** 写操作审计日志（JSONL） */
export const AUDIT_LOG_FILE = join(APP_HOME, 'audit-log.jsonl');

/** 应用缓存与生成数据根目录 */
export const CACHE_DIR = join(APP_HOME, '.cache');

/** 在线简历截图保存目录（供多模态 Agent 直接查看） */
export const RESUME_SCREENSHOTS_DIR = join(CACHE_DIR, 'resume-screenshots');

/** 在线简历提取文本 / OCR 文本保存目录 */
export const RESUME_TEXT_DIR = join(CACHE_DIR, 'resumes');

/** 兼容旧路径：在线简历 OCR 目录 */
export const RESUME_OCR_DIR = join(CACHE_DIR, 'ocr');

let appDataLayoutReady = false;

/** 确保 `~/.boss-cli` 目录结构存在（幂等） */
export function ensureAppDataLayout(): void {
  if (appDataLayoutReady) {
    return;
  }
  appDataLayoutReady = true;
  for (const dir of [
    APP_HOME,
    CACHE_DIR,
    JD_DIR,
    AVATARS_DIR,
    RESUMES_DIR,
    RESUME_PDF_DIR,
    RESUME_ONLINE_DIR,
    SOURCING_DIR,
    RESUME_SCREENSHOTS_DIR,
    RESUME_TEXT_DIR,
    RESUME_OCR_DIR,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
