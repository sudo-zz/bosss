import type { FrameTarget, SafariPage } from '../browser/index.js';
import {
  LIST_SCROLL_COLLECT_GAP_MS,
  RESUME_PREVIEW_OPEN_GAP_MS,
  sleepRandom,
} from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { ensurePage } from '../common/ensure_page.js';
import { findTrackedCandidate } from '../common/tracker.js';
import type { CandidateLocator } from './recommend.js';

const BOSS_CHAT_SEARCH_URL = 'https://www.zhipin.com/web/chat/search';
export const SEARCH_FRAME: FrameTarget = { selector: 'iframe[name="searchFrame"]' };
const SEARCH_RESULT_SETTLE_MS = { min: 900, max: 1600 } as const;

export type NormalSearchCandidate = {
  index: number;
  name: string;
  active: string;
  labels: string[];
  basicInfo: string;
  summary: string;
  tags: string[];
  expectation: string;
  work: string[];
  education: string;
  reason: string;
  contactText: string;
  trackedStage?: string;
  trackedScore?: number;
};

export function isBossChatSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    return (u.pathname.replace(/\/+$/, '') || '/') === '/web/chat/search';
  } catch {
    return false;
  }
}

async function ensureSearchFrameReady(page: SafariPage): Promise<void> {
  await page.waitFor(
    async () =>
      page
        .evalInFrame<boolean>(
          SEARCH_FRAME,
          `
          if (!location.href.includes("/web/frame/search")) return false;
          const input = document.querySelector(".search-input");
          if (!(input instanceof HTMLInputElement)) return false;
          return !!document.querySelector(".geek-list-wrap, .card-list, .geek-info-card, .empty-tips");
          `,
        )
        .catch(() => false),
    18_000,
    220,
    380,
    '常规搜索页 searchFrame 加载完成',
  );
}

export async function ensureInNormalSearchPage(page: SafariPage): Promise<void> {
  await ensurePage(page, {
    name: '常规搜索页',
    targetUrl: BOSS_CHAT_SEARCH_URL,
    matches: isBossChatSearchUrl,
  });
  await ensureSearchFrameReady(page);
}

export async function assertNormalSearchPageReady(page: SafariPage): Promise<void> {
  if (!isBossChatSearchUrl(await page.url())) {
    throw new Error('当前不在常规搜索页（/web/chat/search），请先通过 boss search 进入。');
  }
  await ensureSearchFrameReady(page);
}

async function runKeywordSearch(page: SafariPage, keyword: string): Promise<void> {
  const ok = await page.evalInFrame<boolean>(
    SEARCH_FRAME,
    `
    const input = document.querySelector(".search-input");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (desc?.set) desc.set.call(input, args.kw);
    else input.value = args.kw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const searchBtn = document.querySelector(".btn-search, .search-btn, button[type='submit']");
    if (searchBtn instanceof HTMLElement) {
      searchBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
    return true;
    `,
    { kw: keyword },
  );
  if (!ok) throw new Error('未找到常规搜索关键词输入框（.search-input）。');
  await sleepRandom(SEARCH_RESULT_SETTLE_MS.min, SEARCH_RESULT_SETTLE_MS.max);
  await ensureSearchFrameReady(page);
}

export async function readNormalSearchSelectedJobLabel(page: SafariPage): Promise<string> {
  const label = await page.evalInFrame<string>(
    SEARCH_FRAME,
    `return (document.querySelector(".search-current-job")?.textContent ?? "").replace(/\\s+/g, " ").trim();`,
  );
  return label || '默认';
}

export async function readNormalSearchCandidates(
  page: SafariPage,
  opts: { limit?: number } = {},
): Promise<NormalSearchCandidate[]> {
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 80) : 20;
  const maxScrollRounds = limit > 12 ? 6 : 0;

  for (let round = 0; round < maxScrollRounds; round++) {
    const count = await page.evalInFrame<number>(
      SEARCH_FRAME,
      `return document.querySelectorAll(".geek-info-card").length;`,
    );
    if (count >= limit) break;
    const moved = await page.evalInFrame<boolean>(
      SEARCH_FRAME,
      `
      const el = document.scrollingElement || document.documentElement || document.body;
      const prev = el.scrollTop;
      el.scrollTop = Math.min(el.scrollTop + 900, el.scrollHeight);
      window.scrollBy(0, 900);
      return (el.scrollTop !== prev) || window.scrollY > 0;
      `,
    );
    if (!moved) break;
    await sleepRandom(LIST_SCROLL_COLLECT_GAP_MS.min, LIST_SCROLL_COLLECT_GAP_MS.max);
  }

  const raw = await page.evalInFrame<Array<Omit<NormalSearchCandidate, 'index'>>>(
    SEARCH_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const unique = (items) => Array.from(new Set(items.map(norm).filter(Boolean)));
    return Array.from(document.querySelectorAll(".geek-info-card")).map((card) => {
      const labels = unique(Array.from(card.querySelectorAll(".card-label")).map((el) => el.textContent));
      const tags = unique(
        Array.from(card.querySelectorAll(".info-tags:not(.info-tags-measure) .info-tags-item")).map((el) => el.textContent),
      );
      const work = Array.from(card.querySelectorAll(".work-exp-box .work-exp-item")).map((el) => norm(el.textContent)).filter(Boolean);
      return {
        name: norm(card.querySelector(".name-label")?.textContent),
        active: norm(card.querySelector(".active-desc-text")?.textContent),
        labels,
        basicInfo: norm(card.querySelector(".info-labels")?.textContent),
        summary: norm(card.querySelector(".info-detail")?.textContent),
        tags,
        expectation: norm(card.querySelector(".expect-exp-box")?.textContent),
        work,
        education: norm(card.querySelector(".edu-exp-box")?.textContent),
        reason: norm(card.querySelector(".recommend-reason")?.textContent),
        contactText: norm(card.querySelector(".btn-getcontact, .btn-greet")?.textContent),
      };
    }).filter((item) => item.name);
    `,
  );

  return raw.slice(0, limit).map((c, idx) => {
    const tracked = findTrackedCandidate({ name: c.name });
    return {
      index: idx + 1,
      ...c,
      ...(tracked ? { trackedStage: tracked.stage, trackedScore: tracked.score } : {}),
    };
  });
}

export async function openNormalSearchResumePreview(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<{ opened: boolean; name: string }> {
  const res = await page.evalInFrame<{ opened: boolean; name: string }>(
    SEARCH_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(".geek-info-card"));
    if (cards.length === 0) return { opened: false, name: "" };
    let targetCard = null;
    if (typeof args.index === "number" && args.index >= 1) {
      targetCard = cards[args.index - 1] ?? null;
    } else if (args.name) {
      const bare = args.name.replace(/\\*/g, "");
      targetCard = cards.find((item) => {
        const name = norm(item.querySelector(".name-label")?.textContent);
        return name === args.name || (!!bare && name.includes(bare));
      }) ?? null;
    }
    if (!(targetCard instanceof HTMLElement)) return { opened: false, name: "" };
    const name = norm(targetCard.querySelector(".name-label")?.textContent);
    const candidates = [
      targetCard.querySelector(".name-label"),
      targetCard.querySelector(".info-detail"),
      targetCard.querySelector(".geek-info-main, .geek-card-main, .card-content"),
      targetCard.querySelector("a"),
      targetCard,
    ];
    for (const el of candidates) {
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        el.click();
        return { opened: true, name };
      }
    }
    return { opened: false, name };
    `,
    { name: locator.name?.trim() ?? '', index: locator.index ?? null },
  );
  if (res.opened) {
    await sleepRandom(RESUME_PREVIEW_OPEN_GAP_MS.min, RESUME_PREVIEW_OPEN_GAP_MS.max);
  }
  return res;
}

/**
 * 补齐原版缺失能力：支持在常规搜索页对指定候选人点击「打招呼」。
 */
export async function clickGreetNormalSearch(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<{ name: string; message: string }> {
  const result = await page.evalInFrame<
    | { kind: 'empty' }
    | { kind: 'not_found' }
    | { kind: 'no_btn'; name: string }
    | { kind: 'disabled'; name: string; label: string }
    | { kind: 'clicked'; name: string }
  >(
    SEARCH_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(".geek-info-card"));
    if (cards.length === 0) return { kind: "empty" };
    let targetCard = null;
    if (typeof args.index === "number" && args.index >= 1) {
      targetCard = cards[args.index - 1] ?? null;
    } else if (args.name) {
      const bare = args.name.replace(/\\*/g, "");
      targetCard = cards.find((item) => {
        const name = norm(item.querySelector(".name-label")?.textContent);
        return name === args.name || (!!bare && name.includes(bare));
      }) ?? null;
    }
    if (!targetCard) return { kind: "not_found" };

    const name = norm(targetCard.querySelector(".name-label")?.textContent);
    const btn =
      targetCard.querySelector(".btn-getcontact") ||
      targetCard.querySelector(".btn-greet") ||
      Array.from(targetCard.querySelectorAll("button, a, .btn")).find((b) =>
        /打招呼/.test(norm(b.textContent)),
      );
    if (!(btn instanceof HTMLElement)) return { kind: "no_btn", name };
    const label = norm(btn.textContent);
    const cls = btn.className ?? "";
    if (/继续沟通/.test(label) || /disabled|forbid|ban/i.test(cls) || btn.getAttribute("disabled") !== null) {
      return { kind: "disabled", name, label };
    }
    btn.scrollIntoView({ block: "center", inline: "nearest" });
    btn.click();
    return { kind: "clicked", name };
    `,
    { name: locator.name?.trim() ?? '', index: locator.index ?? null },
  );

  switch (result.kind) {
    case 'empty':
      throw new Error('常规搜索列表为空，无法执行打招呼。');
    case 'not_found':
      throw new Error('未在常规搜索结果中找到目标候选人。');
    case 'no_btn':
      throw new Error(`候选人 ${result.name} 缺少「打招呼」按钮。`);
    case 'disabled':
      throw new Error(`候选人 ${result.name} 当前不可打招呼（按钮状态：${result.label || '已禁用'}）。`);
    case 'clicked':
      return { name: result.name, message: `已在常规搜索页对 ${result.name} 点击「打招呼」。` };
  }
}

export type NormalSearchOptions = {
  keyword?: string;
  limit?: number;
  excludeTracked?: boolean;
  json?: boolean;
};

export async function runNormalSearch(opts: NormalSearchOptions = {}): Promise<string> {
  const kw = (opts.keyword ?? '').trim();
  if (kw.length > 20) {
    throw new Error('常规搜索关键词最多 20 个字符。');
  }
  return withBossSessionPage(async (page) => {
    await ensureInNormalSearchPage(page);
    if (kw) {
      await runKeywordSearch(page, kw);
    }
    const currentKeyword = await page.evalInFrame<string>(
      SEARCH_FRAME,
      `return document.querySelector(".search-input")?.value?.trim() ?? "";`,
    );
    const currentJob = await readNormalSearchSelectedJobLabel(page);
    const all = await readNormalSearchCandidates(page, { limit: opts.limit });
    const visible = opts.excludeTracked ? all.filter((c) => !c.trackedStage) : all;

    if (opts.json) {
      return JSON.stringify(
        {
          keyword: currentKeyword || kw || '默认',
          job: currentJob,
          rawCount: all.length,
          count: visible.length,
          candidates: visible,
        },
        null,
        2,
      );
    }

    const lines = [
      `常规搜索结果（关键词：${currentKeyword || kw || '默认/热门词'}；当前岗位：${currentJob}）`,
      `共 ${visible.length} 人${visible.length !== all.length ? `（已过滤 ${all.length - visible.length} 人）` : ''}`,
      '',
    ];
    for (const item of visible) {
      const labelText = item.labels.length > 0 ? `｜标签:${item.labels.join('/')}` : '';
      const activeText = item.active ? `｜${item.active}` : '';
      const trackText = item.trackedStage
        ? `｜台账:${item.trackedStage}${item.trackedScore !== undefined ? `(${item.trackedScore}分)` : ''}`
        : '';
      lines.push(`${item.index}. ${item.name}${activeText}${item.basicInfo ? `｜${item.basicInfo}` : ''}${labelText}${trackText}`);
      if (item.summary) lines.push(`   摘要: ${item.summary}`);
      if (item.tags.length > 0) lines.push(`   亮点: ${item.tags.join(' / ')}`);
      if (item.expectation) lines.push(`   ${item.expectation}`);
      if (item.work.length > 0) lines.push(`   经历: ${item.work.join('；')}`);
      if (item.education) lines.push(`   ${item.education}`);
      if (item.reason) lines.push(`   ${item.reason}`);
    }
    return lines.join('\n').trimEnd();
  });
}
