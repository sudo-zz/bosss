/**
 * 批量温和巡检未读会话（`boss inspect-unread`）：
 * - 在同一 Safari 会话中切到「未读」筛选，按真实人类的阅读频率顺序查看每个未读会话
 * - 边滚动边读取（支持虚拟列表与断点续传），不漏人、不重复
 * - 提取每位候选人的基础信息（活跃状态、年龄/经验/学历/状态、期望、近期经历、备注）与完整聊天记录
 * - 自动下载候选人头像图片（以及聊天内的图片消息）到本地 `~/.boss-cli/avatars/`
 * - 全程只读、不点击「在线简历」弹窗（零消耗每日 30 次预览额度）
 * - 遇到登录失效/风控弹窗/403 立即中止并保留断点进度交还人工
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SafariPage } from '../browser/index.js';
import { sleepRandom } from '../browser/index.js';
import { describeManualInterventionUrl, isBossChatIndexUrl } from '../common/auth.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { upsertTrackedCandidate } from '../common/tracker.js';
import { AVATARS_DIR, ensureAppDataLayout, UNREAD_INSPECT_FILE } from '../config.js';
import {
  fetchCandidateSummary,
  scrapeCurrentChatMessages,
  waitForOpenedCandidateChat,
  type CandidateSummary,
  type ChatMessageItem,
} from './chat.js';
import { ensureChatListReady, scrollChatListStep } from './list.js';

export type InspectedUnreadCandidate = {
  order: number;
  rowKey: string;
  name: string;
  gender: string;
  job: string;
  listTime: string;
  listPreview: string;
  unreadCount: number;
  avatarUrl: string;
  avatarLocalPath: string | null;
  isDefaultAvatar: boolean;
  active: string;
  basicFacts: string[];
  recentExperience: string[];
  experienceTimelines: Array<{ time: string; detail: string }>;
  communicationPosition: string;
  expectation: string;
  remark: string;
  hasFriendResumeAttachment: boolean;
  friendImages: string[];
  friendImageLocalPaths: string[];
  messages: ChatMessageItem[];
  inspectedAt: string;
};

export type UnreadInspectSnapshot = {
  updatedAt: string;
  completed: boolean;
  totalInspected: number;
  candidates: InspectedUnreadCandidate[];
};

function loadInspectSnapshot(filePath: string = UNREAD_INSPECT_FILE): UnreadInspectSnapshot {
  ensureAppDataLayout();
  if (!existsSync(filePath)) {
    return {
      updatedAt: new Date().toISOString(),
      completed: false,
      totalInspected: 0,
      candidates: [],
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<UnreadInspectSnapshot>;
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      completed: Boolean(parsed.completed),
      totalInspected: candidates.length,
      candidates,
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      completed: false,
      totalInspected: 0,
      candidates: [],
    };
  }
}

function saveInspectSnapshot(snapshot: UnreadInspectSnapshot, filePath: string = UNREAD_INSPECT_FILE): void {
  ensureAppDataLayout();
  snapshot.updatedAt = new Date().toISOString();
  snapshot.totalInspected = snapshot.candidates.length;
  writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function inferImageExt(url: string, contentType: string | null): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  const cleanUrl = url.split('?')[0]?.toLowerCase() ?? '';
  if (cleanUrl.endsWith('.png')) return 'png';
  if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return 'jpg';
  if (cleanUrl.endsWith('.webp')) return 'webp';
  return 'png';
}

function safeSlug(name: string): string {
  const s = name.replace(/[/\\?%*:|"<>.\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return s || 'candidate';
}

async function downloadImageSafe(
  url: string,
  prefix: string,
  preferHdAvatar = false,
): Promise<{ localPath: string | null; resolvedUrl: string }> {
  if (!url || !/^https?:\/\//i.test(url)) return { localPath: null, resolvedUrl: url };

  const candidates =
    preferHdAvatar && /_s\.(?:jpe?g|png|webp)/i.test(url)
      ? [url.replace(/_s(?=\.(?:jpe?g|png|webp))/i, ''), url]
      : [url];

  for (const targetUrl of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(targetUrl, {
        signal: ctrl.signal,
        headers: {
          Referer: 'https://www.zhipin.com/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) continue;
      const ext = inferImageExt(targetUrl, res.headers.get('content-type'));
      const hash = createHash('sha1').update(targetUrl).digest('hex').slice(0, 8);
      const filename = `${prefix}-${hash}.${ext}`;
      const absPath = join(AVATARS_DIR, filename);
      await writeFile(absPath, buf);
      return { localPath: absPath, resolvedUrl: targetUrl };
    } catch {
      // try next candidate
    }
  }
  return { localPath: null, resolvedUrl: url };
}

type VisibleUnreadRow = {
  domIndex: number;
  rowKey: string;
  name: string;
  job: string;
  time: string;
  message: string;
  unreadCount: number;
  avatarUrl: string;
};

async function readVisibleUnreadRows(page: SafariPage): Promise<VisibleUnreadRow[]> {
  return page.eval<VisibleUnreadRow[]>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const wraps = Array.from(document.querySelectorAll(".geek-item-wrap"));
    return wraps.map((wrap, domIndex) => {
      const el = wrap.querySelector(".geek-item") || wrap;
      const name = norm(el.querySelector(".geek-name")?.textContent);
      const job = norm(el.querySelector(".source-job")?.textContent);
      const time = norm(el.querySelector(".time")?.textContent);
      const message = norm(el.querySelector(".push-text")?.textContent);
      const badge = el.querySelector(".badge-count");
      let unreadCount = 0;
      if (badge) {
        const digits = norm(badge.textContent).replace(/\\D/g, "");
        if (digits) unreadCount = parseInt(digits, 10) || 0;
      }
      const img = el.querySelector(".figure img.image-square, .figure img, img.image-square");
      let avatarUrl = img ? (img.getAttribute("src") || img.currentSrc || "") : "";
      if (avatarUrl.startsWith("data:")) avatarUrl = "";
      const rowKey = name + "::" + job + "::" + time + "::" + message.slice(0, 40) + "::" + avatarUrl.slice(-24);
      return { domIndex, rowKey, name, job, time, message, unreadCount, avatarUrl };
    }).filter((r) => r.name);
  `);
}

async function clickRowByKey(page: SafariPage, rowKey: string): Promise<boolean> {
  return page.eval<boolean>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const wraps = Array.from(document.querySelectorAll(".geek-item-wrap"));
    for (const wrap of wraps) {
      const el = wrap.querySelector(".geek-item") || wrap;
      const name = norm(el.querySelector(".geek-name")?.textContent);
      const job = norm(el.querySelector(".source-job")?.textContent);
      const time = norm(el.querySelector(".time")?.textContent);
      const message = norm(el.querySelector(".push-text")?.textContent);
      const img = el.querySelector(".figure img.image-square, .figure img, img.image-square");
      let avatarUrl = img ? (img.getAttribute("src") || img.currentSrc || "") : "";
      if (avatarUrl.startsWith("data:")) avatarUrl = "";
      const key = name + "::" + job + "::" + time + "::" + message.slice(0, 40) + "::" + avatarUrl.slice(-24);
      if (key === args.rowKey) {
        if (el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          el.click();
          return true;
        }
      }
    }
    return false;
    `,
    { rowKey },
  );
}

async function assertNoRiskOrAuthLoss(page: SafariPage): Promise<void> {
  const url = await page.url();
  const intervention = describeManualInterventionUrl(url);
  if (intervention) {
    throw new Error(intervention);
  }
  if (!isBossChatIndexUrl(url)) {
    throw new Error(`页面意外跳转离开沟通页（当前 URL：${url}），已中止巡检并保存当前进度。`);
  }
  const verifyPopup = await page.eval<string | null>(`
    const roots = Array.from(document.querySelectorAll(".boss-popup__wrapper, .boss-dialog__wrapper, .geetest_panel"));
    for (const r of roots) {
      if (!(r instanceof HTMLElement)) continue;
      const st = window.getComputedStyle(r);
      if (st.display === "none" || st.visibility === "hidden") continue;
      const rect = r.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      const txt = (r.textContent || "").replace(/\\s+/g, " ").trim();
      if (/安全验证|滑动验证|拖动滑块|行为异常|账号异常|请完成验证|验证码/.test(txt)) {
        return txt.slice(0, 120);
      }
    }
    return null;
  `);
  if (verifyPopup) {
    throw new Error(`检测到 Boss 安全验证/风控弹窗（${verifyPopup}），已立即暂停并保存进度，请在 Safari 完成验证后用 --resume 继续。`);
  }
}

export type InspectUnreadOptions = {
  max?: number;
  resume?: boolean;
  /** 读取「全部」标签（默认只读「未读」） */
  all?: boolean;
  /** 每 N 位候选人做一次长停顿（默认 10） */
  pauseEvery?: number;
  /** 只巡检沟通职位包含该关键字的会话 */
  jobFilter?: string;
  /** 快照输出路径（默认 ~/.boss-cli/unread-inspect.json） */
  outFile?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  json?: boolean;
};

export async function runInspectUnread(opts: InspectUnreadOptions = {}): Promise<string> {
  ensureAppDataLayout();
  const maxItems = opts.max && opts.max > 0 ? opts.max : 300;
  const minDelayMs = opts.minDelayMs && opts.minDelayMs >= 500 ? opts.minDelayMs : 1200;
  const maxDelayMs = opts.maxDelayMs && opts.maxDelayMs >= minDelayMs ? opts.maxDelayMs : 2600;
  const pauseEvery = opts.pauseEvery && opts.pauseEvery >= 2 ? Math.floor(opts.pauseEvery) : 10;
  const jobFilter = (opts.jobFilter ?? '').trim();
  const outFile = opts.outFile ? opts.outFile : UNREAD_INSPECT_FILE;

  const snapshot: UnreadInspectSnapshot = opts.resume
    ? loadInspectSnapshot(outFile)
    : { updatedAt: new Date().toISOString(), completed: false, totalInspected: 0, candidates: [] };

  const visitedKeys = new Set<string>(snapshot.candidates.map((c) => c.rowKey));
  let processedInRun = 0;

  await withBossSessionPage(async (page) => {
    await ensureChatListReady(page, opts.all ? 'all' : 'unread');

    let emptyScrollCount = 0;
    while (processedInRun < maxItems) {
      await assertNoRiskOrAuthLoss(page);
      const visible = await readVisibleUnreadRows(page);
      const nextRow = visible.find(
        (r) => !visitedKeys.has(r.rowKey) && (!jobFilter || (r.job ?? '').includes(jobFilter)),
      );

      if (!nextRow) {
        const scroll = await scrollChatListStep(page);
        if (!scroll.moved || scroll.atEnd) {
          emptyScrollCount += 1;
          await sleepRandom(700, 1200);
          const afterCheck = await readVisibleUnreadRows(page);
          const stillNext = afterCheck.find((r) => !visitedKeys.has(r.rowKey));
          if (!stillNext && emptyScrollCount >= 2) {
            snapshot.completed = true;
            saveInspectSnapshot(snapshot, outFile);
            break;
          }
        } else {
          emptyScrollCount = 0;
          await sleepRandom(750, 1400);
        }
        continue;
      }

      emptyScrollCount = 0;
      visitedKeys.add(nextRow.rowKey);

      // 拟人浏览停顿（每 10 位增加一次长停顿模拟阅读）
      if (processedInRun > 0) {
        if (processedInRun % pauseEvery === 0) {
          await sleepRandom(3200, 5800);
        } else {
          await sleepRandom(minDelayMs, maxDelayMs);
        }
      }

      const clicked = await clickRowByKey(page, nextRow.rowKey);
      if (!clicked) continue;

      await sleepRandom(500, 1000);
      await assertNoRiskOrAuthLoss(page);

      let summary: CandidateSummary = {
        name: nextRow.name,
        gender: '',
        active: '',
        basicFacts: [],
        recentExperience: [],
        experienceTimelines: [],
        communicationPosition: nextRow.job,
        expectation: '',
        remark: '',
        hasAttachmentBtnEnabled: false,
        avatarUrl: nextRow.avatarUrl,
      };
      let messages: ChatMessageItem[] = [];
      let hasFriendResumeAttachment = false;
      let friendImages: string[] = [];

      try {
        await waitForOpenedCandidateChat(page, nextRow.name, true);
        const [scrapedMsgs, scrapedSummary] = await Promise.all([
          scrapeCurrentChatMessages(page),
          fetchCandidateSummary(page, nextRow.name, true),
        ]);
        summary = {
          ...scrapedSummary,
          avatarUrl: nextRow.avatarUrl || scrapedSummary.avatarUrl,
        };
        messages = scrapedMsgs.messages;
        hasFriendResumeAttachment =
          scrapedMsgs.hasFriendResumeAttachment || scrapedSummary.hasAttachmentBtnEnabled;
        friendImages = scrapedMsgs.friendImages;
      } catch {
        // 如果某个会话消息列表极其异常，至少保留列表侧基础记录继续向下走
      }

      const order = snapshot.candidates.length + 1;
      const rawAvatarUrl = nextRow.avatarUrl || summary.avatarUrl;
      const isDefaultAvatar = /\/boss\/avatar\/avatar_\d+/i.test(rawAvatarUrl);
      const downloadedAvatar = await downloadImageSafe(
        rawAvatarUrl,
        `${String(order).padStart(3, '0')}-${safeSlug(summary.name || nextRow.name)}`,
        true,
      );

      const friendImageLocalPaths: string[] = [];
      for (let idx = 0; idx < friendImages.length; idx++) {
        const res = await downloadImageSafe(
          friendImages[idx]!,
          `${String(order).padStart(3, '0')}-${safeSlug(summary.name || nextRow.name)}-msg${idx + 1}`,
          false,
        );
        if (res.localPath) friendImageLocalPaths.push(res.localPath);
      }

      const entry: InspectedUnreadCandidate = {
        order,
        rowKey: nextRow.rowKey,
        name: summary.name || nextRow.name,
        gender: summary.gender,
        job: summary.communicationPosition || nextRow.job,
        listTime: nextRow.time,
        listPreview: nextRow.message,
        unreadCount: nextRow.unreadCount,
        avatarUrl: downloadedAvatar.resolvedUrl,
        avatarLocalPath: downloadedAvatar.localPath,
        isDefaultAvatar,
        active: summary.active,
        basicFacts: summary.basicFacts,
        recentExperience: summary.recentExperience,
        experienceTimelines: summary.experienceTimelines,
        communicationPosition: summary.communicationPosition || nextRow.job,
        expectation: summary.expectation,
        remark: summary.remark,
        hasFriendResumeAttachment,
        friendImages,
        friendImageLocalPaths,
        messages,
        inspectedAt: new Date().toISOString(),
      };

      snapshot.candidates.push(entry);
      saveInspectSnapshot(snapshot, outFile);

      upsertTrackedCandidate({
        name: entry.name,
        job: entry.job,
        source: 'unread-chat',
        stage: 'new',
        summary: [entry.basicFacts.join(' / '), entry.expectation].filter(Boolean).join('｜'),
        notes: entry.remark || undefined,
        event: 'unread_inspected',
        eventDetail: entry.listPreview.slice(0, 80),
      });

      processedInRun += 1;
    }

    if (processedInRun >= maxItems) {
      saveInspectSnapshot(snapshot, outFile);
    }
  });

  if (opts.json) {
    return JSON.stringify(
      {
        snapshotFile: outFile,
        avatarsDir: AVATARS_DIR,
        processedInRun,
        totalInspected: snapshot.candidates.length,
        completed: snapshot.completed,
      },
      null,
      2,
    );
  }

  return [
    `未读会话巡检${snapshot.completed ? '全部完成' : '阶段完成'}：本次新读取 ${processedInRun} 人，累计 ${snapshot.candidates.length} 人。`,
    `快照文件：${outFile}`,
    `头像目录：${AVATARS_DIR}`,
  ].join('\n');
}
