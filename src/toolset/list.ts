import type { SafariPage } from '../browser/index.js';
import {
  LIST_FILTER_GAP_MS,
  LIST_MIN_BEFORE_EMPTY_OK_MS,
  LIST_POLL_MS,
  LIST_SCROLL_COLLECT_GAP_MS,
  sleepRandom,
} from '../browser/index.js';
import { BOSS_CHAT_INDEX_URL, isBossChatIndexUrl } from '../common/auth.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { ensurePage } from '../common/ensure_page.js';
import { findTrackedCandidate } from '../common/tracker.js';

export type CandidateListItem = {
  index: number;
  name: string;
  job: string;
  time: string;
  message: string;
  unreadCount: number;
  avatarUrl: string;
  trackedStage?: string;
  trackedScore?: number;
};

async function waitForCandidateListSettled(
  page: SafariPage,
  opts: { timeoutMs: number; pollMsMin: number; pollMsMax: number; minMsBeforeEmptyOk: number },
): Promise<void> {
  const start = Date.now();
  let prev = -1;
  let stable = 0;
  while (Date.now() - start < opts.timeoutMs) {
    const n = await page.eval<number>(
      `return document.querySelectorAll(".geek-item").length;`,
    );
    const elapsed = Date.now() - start;
    if (n === prev) {
      stable++;
    } else {
      prev = n;
      stable = 1;
    }
    if (stable >= 2) {
      if (n > 0) return;
      if (n === 0 && elapsed >= opts.minMsBeforeEmptyOk) return;
    }
    await sleepRandom(opts.pollMsMin, opts.pollMsMax);
  }
}

async function clickChatFilterTab(page: SafariPage, label: string): Promise<void> {
  await page.eval<void>(
    `
    const container = document.querySelector(".chat-message-filter-left");
    if (!container) {
      throw new Error("未找到聊天筛选容器：.chat-message-filter-left");
    }
    const spans = Array.from(container.querySelectorAll("span"));
    const norm = (v) => (v ?? "").replace(/\\s+/g, "");
    const target = spans.find((el) => norm(el.textContent).includes(args.label));
    if (!target) {
      const labels = spans.map((el) => norm(el.textContent)).filter(Boolean).join(",");
      throw new Error("未找到聊天筛选项：" + args.label + "；当前筛选项：" + (labels || "空"));
    }
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    target.click();
    `,
    { label },
  );
}

async function waitForChatFilterTabSelected(page: SafariPage, label: string): Promise<void> {
  await page.waitFor(
    async () =>
      page.eval<boolean>(
        `
        const container = document.querySelector(".chat-message-filter-left");
        if (!container) return false;
        const norm = (v) => (v ?? "").replace(/\\s+/g, "");
        const tabs = Array.from(container.querySelectorAll("span"));
        const tab = tabs.find((el) => norm(el.textContent).includes(args.label));
        if (!tab) return false;
        const cls = String(tab.className || "");
        const selectedByClass = /active|selected|current|checked/.test(cls);
        const selectedByAria = tab.getAttribute("aria-selected") === "true";
        const selectedByAncestor = !!tab.closest(".active, .selected, .current, .checked");
        return selectedByClass || selectedByAria || selectedByAncestor;
        `,
        { label },
      ),
    8_000,
    180,
    320,
    `聊天筛选标签「${label}」选中`,
  );
}

export async function ensureChatListReady(
  page: SafariPage,
  filter: 'all' | 'unread' = 'all',
): Promise<void> {
  await ensurePage(page, {
    name: '沟通列表页',
    targetUrl: BOSS_CHAT_INDEX_URL,
    matches: isBossChatIndexUrl,
  });

  await page.waitFor(
    async () =>
      page.eval<boolean>(
        `
        const filter = document.querySelector(".chat-message-filter-left");
        if (!filter) return false;
        return filter.querySelectorAll("span").length >= 2;
        `,
      ),
    15_000,
    200,
    360,
    '沟通列表筛选栏加载',
  );

  const filterLabel = filter === 'unread' ? '未读' : '全部';
  await clickChatFilterTab(page, filterLabel);
  await sleepRandom(LIST_FILTER_GAP_MS.min, LIST_FILTER_GAP_MS.max);
  await waitForChatFilterTabSelected(page, filterLabel);
  await waitForCandidateListSettled(page, {
    timeoutMs: 16_000,
    pollMsMin: LIST_POLL_MS.min,
    pollMsMax: LIST_POLL_MS.max,
    minMsBeforeEmptyOk: LIST_MIN_BEFORE_EMPTY_OK_MS,
  });
}

export async function scrapeVisibleChatListItems(
  page: SafariPage,
): Promise<Array<Omit<CandidateListItem, 'index'>>> {
  return page.eval<Array<Omit<CandidateListItem, 'index'>>>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    return Array.from(document.querySelectorAll(".geek-item")).map((el) => {
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
      const avatarImg = el.querySelector(".figure img.image-square, .figure img, img.image-square");
      let avatarUrl = avatarImg ? (avatarImg.getAttribute("src") || avatarImg.currentSrc || "") : "";
      if (avatarUrl.startsWith("data:")) avatarUrl = "";
      return { name, job, time, message, unreadCount, avatarUrl };
    }).filter((it) => it.name);
  `);
}

const FIND_SCROLLER_JS = `
  function findChatListScroller() {
    const direct = document.querySelector(".user-list.b-scroll-stable, .user-list");
    if (direct && direct.scrollHeight > direct.clientHeight) {
      return direct;
    }
    const first = document.querySelector(".geek-item-wrap") || document.querySelector(".geek-item");
    if (!first) return null;
    let node = first.parentElement;
    while (node) {
      const style = window.getComputedStyle(node);
      const canScroll =
        node.scrollHeight > node.clientHeight &&
        (style.overflowY === "auto" ||
          style.overflowY === "scroll" ||
          style.overflowY === "overlay" ||
          node.classList.contains("b-scroll-stable"));
      if (canScroll) return node;
      node = node.parentElement;
    }
    return null;
  }
`;

export async function scrollChatListStep(
  page: SafariPage,
): Promise<{ moved: boolean; atEnd: boolean; scrollHeight: number }> {
  return page.eval<{ moved: boolean; atEnd: boolean; scrollHeight: number }>(`
    ${FIND_SCROLLER_JS}
    const scroller = findChatListScroller();
    if (!scroller) return { moved: false, atEnd: true, scrollHeight: 0 };
    const prev = scroller.scrollTop;
    const step = Math.max(220, Math.floor(scroller.clientHeight * 0.78));
    scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    const moved = scroller.scrollTop !== prev;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    return { moved, atEnd, scrollHeight: scroller.scrollHeight };
  `);
}

export async function scrollChatListToTop(page: SafariPage): Promise<void> {
  await page.eval<void>(`
    ${FIND_SCROLLER_JS}
    const scroller = findChatListScroller();
    if (!scroller) return;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
  `);
}

export type ListCandidatesOptions = {
  unreadOnly?: boolean;
  limit?: number;
  excludeTracked?: boolean;
  json?: boolean;
};

export async function runGetCandidateList(opts: ListCandidatesOptions = {}): Promise<string> {
  const unreadOnly = opts.unreadOnly === true;
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 30;

  try {
    return await withBossSessionPage(async (page) => {
      await ensureChatListReady(page, unreadOnly ? 'unread' : 'all');

      const seen = new Set<string>();
      const collected: Array<Omit<CandidateListItem, 'index'>> = [];
      const maxScrollRounds = limit > 15 ? 45 : 0;

      for (let round = 0; round <= maxScrollRounds; round++) {
        const batch = await scrapeVisibleChatListItems(page);
        for (const item of batch) {
          const key = `${item.name}::${item.job}::${item.time}::${item.message}`;
          if (!seen.has(key)) {
            seen.add(key);
            collected.push(item);
          }
        }
        if (collected.length >= limit || round === maxScrollRounds) {
          break;
        }
        const st = await scrollChatListStep(page);
        if (!st.moved || st.atEnd) {
          await sleepRandom(500, 800);
          const extra = await scrapeVisibleChatListItems(page);
          let added = 0;
          for (const item of extra) {
            const key = `${item.name}::${item.job}::${item.time}::${item.message}`;
            if (!seen.has(key)) {
              seen.add(key);
              collected.push(item);
              added++;
            }
          }
          if (added === 0) break;
        }
        await sleepRandom(LIST_SCROLL_COLLECT_GAP_MS.min, LIST_SCROLL_COLLECT_GAP_MS.max);
      }

      if (maxScrollRounds > 0) {
        await scrollChatListToTop(page);
      }

      const enriched: CandidateListItem[] = collected.slice(0, limit).map((it, idx) => {
        const tracked = findTrackedCandidate({ name: it.name, job: it.job });
        return {
          index: idx + 1,
          ...it,
          ...(tracked ? { trackedStage: tracked.stage, trackedScore: tracked.score } : {}),
        };
      });

      const visible = opts.excludeTracked
        ? enriched.filter((it) => !it.trackedStage)
        : enriched;

      const withUnread = visible.filter((it) => it.unreadCount > 0).length;

      if (opts.json) {
        return JSON.stringify(
          {
            filter: unreadOnly ? 'unread' : 'all',
            total: visible.length,
            unreadCount: withUnread,
            candidates: visible,
          },
          null,
          2,
        );
      }

      const lines = visible.map((it) => {
        const base = `${it.index}. ${it.name}${it.job ? `｜${it.job}` : ''}`;
        const meta = [
          it.unreadCount > 0 ? `未读:${it.unreadCount}` : '',
          it.time ? `时间:${it.time}` : '',
          it.message ? `消息:${it.message}` : '',
          it.trackedStage
            ? `台账:${it.trackedStage}${it.trackedScore !== undefined ? `(${it.trackedScore}分)` : ''}`
            : '',
        ]
          .filter(Boolean)
          .join('｜');
        return meta ? `${base}｜${meta}` : base;
      });
      const previewText =
        lines.length > 0 ? `候选人明细：\n${lines.join('\n')}` : '候选人明细：暂无。';

      return [
        unreadOnly
          ? `未读筛选：共 ${visible.length} 人（已切换页面「未读」筛选）。`
          : `沟通列表共 ${visible.length} 人，其中 ${withUnread} 人有未读消息。`,
        previewText,
      ].join('\n');
    });
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(`获取候选人列表失败：${String(e)}`);
  }
}
