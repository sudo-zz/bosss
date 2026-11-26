import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameTarget, SafariPage } from '../browser/index.js';
import {
  JOB_SEARCH_ACTION_GAP_MS,
  JOB_SELECT_ACTION_GAP_MS,
  LIST_SCROLL_COLLECT_GAP_MS,
  RESUME_PREVIEW_OPEN_GAP_MS,
  sleepRandom,
} from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { ensurePage } from '../common/ensure_page.js';
import { findTrackedCandidate, upsertTrackedCandidate } from '../common/tracker.js';
import { ensureAppDataLayout, SOURCING_DIR } from '../config.js';

const BOSS_CHAT_RECOMMEND_URL = 'https://www.zhipin.com/web/chat/recommend';
export const RECOMMEND_FRAME: FrameTarget = { selector: 'iframe[name="recommendFrame"]' };

const RECOMMEND_CARD_ROOT_SELECTOR =
  '.candidate-card-wrap, .card-list .card-item, .geek-list .geek-card';

/** 仅支持「推荐」和「精选」，按产品规则排除「最新」 */
export type RecommendTab = 'recommend' | 'featured';

export function normalizeRecommendTab(raw?: string): RecommendTab {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'featured' || v === 'selected' || v === 'jingxuan' || v === '精选') {
    return 'featured';
  }
  return 'recommend';
}

export type RecommendCandidate = {
  index: number;
  geekId: string;
  name: string;
  activeStatus: string;
  salary: string;
  baseInfo: string;
  expect: string;
  experience: string;
  advantage: string;
  highlights: string[];
  canGreet: boolean;
  hasHistoryChat: boolean;
  hasViewed: boolean;
  sourceTab?: RecommendTab;
  trackedStage?: string;
  trackedScore?: number;
};

export type CandidateLocator = {
  name?: string;
  index?: number;
  geekId?: string;
};

export function isBossChatRecommendUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    return (u.pathname.replace(/\/+$/, '') || '/') === '/web/chat/recommend';
  } catch {
    return false;
  }
}

async function ensureRecommendFrameReady(page: SafariPage): Promise<void> {
  const frameOk = await page
    .waitFor(
      async () =>
        page
          .evalInFrame<boolean>(RECOMMEND_FRAME, `return location.href.includes("/web/frame/recommend");`)
          .catch(() => false),
      8_000,
      200,
      320,
      '推荐页 recommendFrame 加载',
    )
    .then(() => true)
    .catch(() => false);
  if (!frameOk) {
    throw new Error('推荐页 iframe 没加载出来（/web/frame/recommend）。请确认 Safari 停在 BOSS 推荐页并已登录。');
  }

  const hasCards = async (): Promise<boolean> =>
    page
      .evalInFrame<boolean>(
        RECOMMEND_FRAME,
        `
        if (document.querySelector(args.sel)) return true;
        return !!document.querySelector(".card-list, .geek-list-wrap .geek-list");
        `,
        { sel: RECOMMEND_CARD_ROOT_SELECTOR },
      )
      .catch(() => false);

  if (await hasCards()) return;

  // 新前端首屏可能没有选中职位（jobid=null），直接替用户选第一个，别干等
  const opened = await page
    .evalInFrame<boolean>(
      RECOMMEND_FRAME,
      `
      const host = document.querySelector(".job-selecter-wrap .ui-dropmenu-label");
      if (!(host instanceof HTMLElement)) return false;
      host.scrollIntoView({ block: "center", inline: "nearest" });
      host.click();
      return true;
      `,
    )
    .catch(() => false);

  let chosen = '';
  if (opened) {
    await sleepRandom(500, 900);
    chosen = await page
      .evalInFrame<string>(
        RECOMMEND_FRAME,
        `
        const rows = Array.from(document.querySelectorAll(".job-selecter-options .job-list .job-item"));
        const target = rows[0];
        if (!(target instanceof HTMLElement)) return "";
        const label = (target.querySelector(".label")?.textContent || target.textContent || "").replace(/\s+/g, " ").trim();
        target.scrollIntoView({ block: "center", inline: "nearest" });
        target.click();
        return label;
        `,
      )
      .catch(() => '');
  }

  if (chosen) {
    await page.waitFor(hasCards, 15_000, 220, 380, `推荐页选择职位「${chosen}」后加载`).catch(() => {});
    if (await hasCards()) return;
  }

  throw new Error(
    chosen
      ? `已自动选择职位「${chosen}」，但仍没有候选人卡片：可能今日推荐已看完，换 boss recommend "<其他岗位>" 或明天再看。`
      : '推荐页没有候选人卡片：可能今日推荐已看完，或页面还没选职位。试试 boss recommend "<岗位名>" 指定岗位。',
  );
}

async function readCurrentRecommendJobLabel(page: SafariPage): Promise<string> {
  return page.evalInFrame<string>(
    RECOMMEND_FRAME,
    `return (document.querySelector(".job-selecter-wrap .ui-dropmenu-label")?.textContent ?? "").replace(/\\s+/g, " ").trim();`,
  );
}

export async function selectRecommendJob(page: SafariPage, keyword: string): Promise<string> {
  const kw = keyword.trim();
  if (!kw) return readCurrentRecommendJobLabel(page);

  const opened = await page.evalInFrame<boolean>(
    RECOMMEND_FRAME,
    `
    const host = document.querySelector(".job-selecter-wrap .ui-dropmenu-label");
    if (!(host instanceof HTMLElement)) return false;
    host.scrollIntoView({ block: "center", inline: "nearest" });
    host.click();
    return true;
    `,
  );
  if (!opened) throw new Error('未找到岗位下拉入口（.job-selecter-wrap .ui-dropmenu-label）。');
  await sleepRandom(JOB_SELECT_ACTION_GAP_MS.min, JOB_SELECT_ACTION_GAP_MS.max);

  await page.waitFor(
    async () =>
      page.evalInFrame<boolean>(
        RECOMMEND_FRAME,
        `
        const options = document.querySelector(".job-selecter-options");
        if (!(options instanceof HTMLElement)) return false;
        const rect = options.getBoundingClientRect();
        const st = window.getComputedStyle(options);
        if (rect.width <= 0 || rect.height <= 0 || st.display === "none" || st.visibility === "hidden") return false;
        return !!options.querySelector(".top-chat-search .chat-job-search");
        `,
      ),
    8_000,
    180,
    320,
    '推荐页岗位下拉列表打开',
  );

  const searched = await page.evalInFrame<boolean>(
    RECOMMEND_FRAME,
    `
    const input = document.querySelector(".job-selecter-options .top-chat-search .chat-job-search");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (desc?.set) desc.set.call(input, args.kw);
    else input.value = args.kw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
    `,
    { kw },
  );
  if (!searched) throw new Error('未找到职位搜索框（.chat-job-search）。');
  await sleepRandom(JOB_SEARCH_ACTION_GAP_MS.min, JOB_SEARCH_ACTION_GAP_MS.max);

  await page.waitFor(
    async () =>
      page.evalInFrame<boolean>(
        RECOMMEND_FRAME,
        `
        const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim().toLowerCase();
        const rows = Array.from(document.querySelectorAll(".job-selecter-options .job-list .job-item"));
        return rows.some((el) => norm(el.querySelector(".label")?.textContent || el.textContent).includes(norm(args.kw)));
        `,
        { kw },
      ),
    10_000,
    180,
    320,
    `岗位匹配结果「${kw}」`,
  );

  const picked = await page.evalInFrame<{ ok: boolean; label?: string }>(
    RECOMMEND_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim().toLowerCase();
    const rows = Array.from(document.querySelectorAll(".job-selecter-options .job-list .job-item"));
    const target = rows.find((el) => norm(el.querySelector(".label")?.textContent || el.textContent).includes(norm(args.kw)));
    if (!(target instanceof HTMLElement)) return { ok: false };
    const label = (target.querySelector(".label")?.textContent ?? target.textContent ?? "").replace(/\\s+/g, " ").trim();
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
    return { ok: true, label };
    `,
    { kw },
  );
  if (!picked.ok) throw new Error(`未找到匹配岗位“${kw}”。`);

  const label = picked.label ?? kw;
  await sleepRandom(JOB_SELECT_ACTION_GAP_MS.min, JOB_SELECT_ACTION_GAP_MS.max);
  await page.waitFor(
    async () =>
      page.evalInFrame<boolean>(
        RECOMMEND_FRAME,
        `
        const current = (document.querySelector(".job-selecter-wrap .ui-dropmenu-label")?.textContent ?? "").replace(/\\s+/g, " ").trim();
        return !!current && current === args.label;
        `,
        { label },
      ),
    10_000,
    200,
    360,
    `切换至岗位「${label}」`,
  );
  await ensureRecommendFrameReady(page);
  await sleepRandom(400, 750);
  return label;
}

export async function selectRecommendTab(page: SafariPage, tab: RecommendTab): Promise<RecommendTab> {
  const targetLabel = tab === 'featured' ? '精选' : '推荐';
  const res = await page.evalInFrame<{ found: boolean; clicked: boolean; activeText: string }>(
    RECOMMEND_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim();
    const candidates = Array.from(document.querySelectorAll("a, li, button, div, span")).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.children.length > 2) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top > 180) return false;
      const txt = norm(el.textContent);
      if (args.label === "精选") return /^精选\\d*$/.test(txt);
      return txt === "推荐";
    });
    // 优先选包含 tab/active/nav 语义且最贴近顶部的可点击元素
    candidates.sort((a, b) => {
      const aScore = /tab|nav|item|active|selected/i.test((a.className || "") + " " + (a.parentElement?.className || "")) ? 0 : 1;
      const bScore = /tab|nav|item|active|selected/i.test((b.className || "") + " " + (b.parentElement?.className || "")) ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    const el = candidates[0];
    if (!el) return { found: false, clicked: false, activeText: "" };
    const cls = (el.className || "") + " " + (el.parentElement?.className || "");
    const alreadyActive = /active|selected|current|cur\\b/i.test(cls);
    if (!alreadyActive) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.click();
    }
    return { found: true, clicked: !alreadyActive, activeText: norm(el.textContent) };
    `,
    { label: targetLabel },
  );
  if (!res.found && tab === 'featured') {
    throw new Error('未在推荐牛人页顶部找到「精选」标签页，请确认当前账号有精选牛人入口。');
  }
  if (res.clicked) {
    await sleepRandom(650, 1100);
    await ensureRecommendFrameReady(page).catch(() => {});
  }
  return tab;
}

export async function ensureInRecommendPage(page: SafariPage): Promise<void> {
  await ensurePage(page, {
    name: '推荐列表页',
    targetUrl: BOSS_CHAT_RECOMMEND_URL,
    matches: isBossChatRecommendUrl,
  });
  await ensureRecommendFrameReady(page);
}

export async function assertRecommendPageReady(page: SafariPage, actionName: string): Promise<void> {
  if (!isBossChatRecommendUrl(await page.url())) {
    throw new Error(`当前不在推荐列表页（/web/chat/recommend），无法${actionName}。`);
  }
  await ensureRecommendFrameReady(page);
}

export async function readRecommendList(
  page: SafariPage,
  opts: { limit?: number } = {},
): Promise<RecommendCandidate[]> {
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 80) : 20;
  const maxScrollRounds = limit > 12 ? 6 : 0;

  for (let round = 0; round < maxScrollRounds; round++) {
    const count = await page.evalInFrame<number>(
      RECOMMEND_FRAME,
      `return document.querySelectorAll(args.sel).length;`,
      { sel: RECOMMEND_CARD_ROOT_SELECTOR },
    );
    if (count >= limit) break;
    const moved = await page.evalInFrame<boolean>(
      RECOMMEND_FRAME,
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

  const raw = await page.evalInFrame<Array<Omit<RecommendCandidate, 'index'>>>(
    RECOMMEND_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(args.sel));
    return cards.map((item) => {
      const inner = item.querySelector(".card-inner") || item;
      const wrap = item.matches(".candidate-card-wrap") ? item : item.querySelector(".candidate-card-wrap");
      const hasViewed = Boolean(wrap?.classList.contains("has-viewed") || inner?.classList.contains("has-viewed"));
      const geekId = inner?.getAttribute("data-geekid") ?? inner?.getAttribute("data-geek") ?? "";
      const name = norm(item.querySelector(".name-wrap .name")?.textContent) || norm(item.querySelector(".name")?.textContent);
      const activeStatus =
        norm(item.querySelector(".active-text, .online-marker, .geek-active-text, .name-wrap .active-time, .name-wrap .online")?.textContent) ||
        (item.querySelector(".online-icon, .icon-online") ? "在线" : "");
      const salary = norm(item.querySelector(".salary-wrap span")?.textContent) || norm(item.querySelector(".salary-wrap")?.textContent);
      const baseInfo = Array.from(item.querySelectorAll(".base-info span")).map((el) => norm(el.textContent)).filter(Boolean).join(" / ");
      const expect = norm(item.querySelector(".expect-wrap .content")?.textContent) || norm(item.querySelector(".expect-wrap .join-text-wrap")?.textContent);
      const experience = norm(item.querySelector(".experience-wrap .join-text-wrap")?.textContent) ||
        Array.from(item.querySelectorAll(".timeline-wrap .join-text-wrap, .work-exp-box .exp-item")).map((el) => norm(el.textContent)).filter(Boolean).slice(0, 2).join("；");
      const advantage = norm(item.querySelector(".geek-desc .content")?.textContent);
      const highlightLabels = [
        ...Array.from(item.querySelectorAll(".operate .labels .label")),
        ...Array.from(item.querySelectorAll(".tags-wrap .tag-item, .tag-list .tag-item")),
      ].map((el) => norm(el.textContent)).filter(Boolean);
      const highlights = [...new Set(highlightLabels)];
      const greetBtn = item.querySelector(".button-chat-wrap .btn.btn-greet, .btn-greet");
      const btnCls = greetBtn?.className ?? "";
      const disabled = !greetBtn || /disabled|forbid|ban/i.test(btnCls) || greetBtn.getAttribute("disabled") !== null;
      const hasHistoryChat =
        !!item.querySelector(".tooltip-wrap.chat-history .icon-chat-history") ||
        Array.from(item.querySelectorAll("use")).some((u) => {
          const href = u.getAttribute("href") ?? u.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
          return href.includes("icon-chat-history");
        });
      return { geekId, name, activeStatus, salary, baseInfo, expect, experience, advantage, highlights, canGreet: !disabled, hasHistoryChat, hasViewed };
    }).filter((x) => x.name);
    `,
    { sel: RECOMMEND_CARD_ROOT_SELECTOR },
  );

  return raw.slice(0, limit).map((c, idx) => {
    const tracked = findTrackedCandidate({ geekId: c.geekId, name: c.name });
    return {
      index: idx + 1,
      ...c,
      ...(tracked ? { trackedStage: tracked.stage, trackedScore: tracked.score } : {}),
    };
  });
}

export async function resolveRecommendCandidate(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<RecommendCandidate | null> {
  const list = await readRecommendList(page, { limit: 60 });
  if (locator.geekId) {
    const byId = list.find((c) => c.geekId === locator.geekId);
    if (byId) return byId;
  }
  if (locator.index !== undefined) {
    return list[locator.index - 1] ?? null;
  }
  const needle = (locator.name ?? '').trim();
  if (!needle) return null;
  return list.find((c) => c.name === needle) ?? list.find((c) => c.name.includes(needle)) ?? null;
}

export async function clickGreetRecommend(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<{ name: string; geekId: string; message: string }> {
  const result = await page.evalInFrame<
    | { kind: 'empty' }
    | { kind: 'not_found' }
    | { kind: 'no_btn'; name: string }
    | { kind: 'disabled'; name: string }
    | { kind: 'clicked'; name: string; geekId: string }
  >(
    RECOMMEND_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(args.sel));
    if (cards.length === 0) return { kind: "empty" };
    let targetCard = null;
    if (args.geekId) {
      targetCard = cards.find((item) => {
        const inner = item.querySelector(".card-inner") || item;
        const gid = inner?.getAttribute("data-geekid") ?? inner?.getAttribute("data-geek") ?? "";
        return gid === args.geekId;
      }) ?? null;
    } else if (typeof args.index === "number" && args.index >= 1) {
      targetCard = cards[args.index - 1] ?? null;
    } else if (args.name) {
      targetCard = cards.find((item) => {
        const name = norm(item.querySelector(".name-wrap .name")?.textContent) || norm(item.querySelector(".name")?.textContent);
        return name === args.name || name.includes(args.name);
      }) ?? null;
    }
    if (!targetCard) return { kind: "not_found" };

    const name = norm(targetCard.querySelector(".name-wrap .name")?.textContent) || norm(targetCard.querySelector(".name")?.textContent);
    const inner = targetCard.querySelector(".card-inner") || targetCard;
    const geekId = inner?.getAttribute("data-geekid") ?? inner?.getAttribute("data-geek") ?? "";
    const btn = targetCard.querySelector(".button-chat-wrap .btn.btn-greet");
    if (!(btn instanceof HTMLElement)) return { kind: "no_btn", name };
    const cls = btn.className ?? "";
    if (/disabled|forbid|ban/i.test(cls) || btn.getAttribute("disabled") !== null) {
      return { kind: "disabled", name };
    }
    btn.scrollIntoView({ block: "center", inline: "nearest" });
    btn.click();
    return { kind: "clicked", name, geekId };
    `,
    {
      sel: RECOMMEND_CARD_ROOT_SELECTOR,
      name: locator.name?.trim() ?? '',
      index: locator.index ?? null,
      geekId: locator.geekId?.trim() ?? '',
    },
  );

  switch (result.kind) {
    case 'empty':
      throw new Error('推荐列表为空，无法执行打招呼。');
    case 'not_found':
      throw new Error(`未在推荐列表中找到目标候选人。`);
    case 'no_btn':
      throw new Error(`候选人 ${result.name} 缺少“打招呼”按钮。`);
    case 'disabled':
      throw new Error(`候选人 ${result.name} 已打招呼或按钮不可用。`);
    case 'clicked':
      return { name: result.name, geekId: result.geekId, message: `已对 ${result.name} 点击“打招呼”。` };
  }
}

export async function openRecommendResumePreview(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<{ opened: boolean; name: string; geekId: string }> {
  const res = await page.evalInFrame<{ opened: boolean; name: string; geekId: string }>(
    RECOMMEND_FRAME,
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll(args.sel));
    if (cards.length === 0) return { opened: false, name: "", geekId: "" };
    let targetCard = null;
    if (args.geekId) {
      targetCard = cards.find((item) => {
        const inner = item.querySelector(".card-inner") || item;
        return (inner?.getAttribute("data-geekid") ?? inner?.getAttribute("data-geek") ?? "") === args.geekId;
      }) ?? null;
    } else if (typeof args.index === "number" && args.index >= 1) {
      targetCard = cards[args.index - 1] ?? null;
    } else if (args.name) {
      targetCard = cards.find((item) => {
        const name = norm(item.querySelector(".name-wrap .name")?.textContent) || norm(item.querySelector(".name")?.textContent);
        return name === args.name || name.includes(args.name);
      }) ?? null;
    }
    if (!targetCard) return { opened: false, name: "", geekId: "" };

    const name = norm(targetCard.querySelector(".name-wrap .name")?.textContent) || norm(targetCard.querySelector(".name")?.textContent);
    const inner = targetCard.querySelector(".card-inner");
    const geekId = (inner || targetCard).getAttribute("data-geekid") ?? (inner || targetCard).getAttribute("data-geek") ?? "";

    function tryOpen(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (el.classList.contains("disabled")) return false;
      const st = window.getComputedStyle(el);
      if (st.pointerEvents === "none" || Number(st.opacity) < 0.3) return false;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.click();
      return true;
    }

    if (inner instanceof HTMLElement) {
      inner.scrollIntoView({ block: "center", inline: "nearest" });
      inner.click();
      return { opened: true, name, geekId };
    }
    if (tryOpen(targetCard.querySelector("a.resume-btn-online"))) return { opened: true, name, geekId };
    if (tryOpen(targetCard.querySelector('a[href*="c-resume"], a[href*="frame/c-resume"]'))) return { opened: true, name, geekId };
    return { opened: false, name, geekId };
    `,
    {
      sel: RECOMMEND_CARD_ROOT_SELECTOR,
      name: locator.name?.trim() ?? '',
      index: locator.index ?? null,
      geekId: locator.geekId?.trim() ?? '',
    },
  );
  if (res.opened) {
    await sleepRandom(RESUME_PREVIEW_OPEN_GAP_MS.min, RESUME_PREVIEW_OPEN_GAP_MS.max);
  }
  return res;
}

export type RecommendOptions = {
  jobKeyword?: string;
  tab?: RecommendTab;
  limit?: number;
  skipViewed?: boolean;
  skipColleague?: boolean;
  excludeTracked?: boolean;
  syncTracker?: boolean;
  json?: boolean;
};

function safeSlug(raw: string): string {
  return raw.replace(/[/\\?%*:|"<>_\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'default';
}

export async function runRecommend(opts: RecommendOptions = {}): Promise<string> {
  const tab: RecommendTab = normalizeRecommendTab(opts.tab);
  const tabLabel = tab === 'featured' ? '精选牛人' : '推荐牛人';

  return withBossSessionPage(async (page) => {
    await ensureInRecommendPage(page);
    await selectRecommendTab(page, tab);
    const selectedJob = await selectRecommendJob(page, (opts.jobKeyword ?? '').trim());
    // 切换岗位后确保仍停在目标标签页（推荐 / 精选）
    await selectRecommendTab(page, tab);
    const all = await readRecommendList(page, { limit: opts.limit });
    const taggedAll = all.map((c) => ({ ...c, sourceTab: tab }));

    const filtered = taggedAll.filter((c) => {
      if (opts.skipViewed && c.hasViewed) return false;
      if (opts.skipColleague && c.hasHistoryChat) return false;
      if (opts.excludeTracked && c.trackedStage) return false;
      return true;
    });

    // 落盘快照至 ~/.boss-cli/sourcing/ 供招聘助手工作台合并与统计
    ensureAppDataLayout();
    const snapshotPath = join(SOURCING_DIR, `${tab}-${safeSlug(selectedJob || opts.jobKeyword || 'default')}.json`);
    writeFileSync(
      snapshotPath,
      `${JSON.stringify(
        {
          tab,
          tabLabel,
          job: selectedJob || opts.jobKeyword || '默认',
          fetchedAt: new Date().toISOString(),
          count: filtered.length,
          candidates: filtered,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    if (opts.syncTracker) {
      for (const c of filtered) {
        const summaryParts = [
          ...c.baseInfo.split('/').map((s) => s.trim()).filter(Boolean),
          c.expect ? c.expect.replace(/^期望[:：]?\s*/, '') : '',
          c.salary || '',
          c.experience ? c.experience.split('；')[0]?.trim() || '' : '',
        ].filter(Boolean);
        upsertTrackedCandidate({
          geekId: c.geekId || undefined,
          name: c.name,
          job: selectedJob || opts.jobKeyword || '默认岗位',
          source: tab,
          activeStatus: c.activeStatus || undefined,
          canGreet: c.canGreet,
          hasViewed: c.hasViewed,
          hasHistoryChat: c.hasHistoryChat,
          stage: c.trackedStage ? undefined : c.canGreet ? 'new' : 'greeted',
          summary: summaryParts.join('｜'),
          reason:
            c.advantage ||
            (c.highlights.length > 0 ? `优势：${c.highlights.slice(0, 4).join('、')}` : undefined),
          event: `synced_${tab}`,
          eventDetail: `${tabLabel} · ${selectedJob || '默认'}`,
        });
      }
    }

    if (opts.json) {
      return JSON.stringify(
        {
          tab,
          tabLabel,
          job: selectedJob || '默认',
          snapshotPath,
          syncedToTracker: Boolean(opts.syncTracker),
          rawCount: taggedAll.length,
          count: filtered.length,
          candidates: filtered,
        },
        null,
        2,
      );
    }

    const lines: string[] = [
      `来源频道：${tabLabel}（${tab}）`,
      `当前岗位：${selectedJob || '默认'}`,
      `候选人数：共 ${filtered.length} 人${filtered.length !== taggedAll.length ? `（已过滤 ${taggedAll.length - filtered.length} 人）` : ''}`,
      '',
    ];
    if (filtered.length === 0) {
      lines.push(`暂无符合条件的${tabLabel}候选人。`);
      return lines.join('\n');
    }
    for (const m of filtered) {
      const adv = m.advantage || (m.highlights.length > 0 ? m.highlights.slice(0, 3).join(' / ') : '（无）');
      const fields = [
        m.geekId ? `ID:${m.geekId}` : '',
        m.activeStatus ? `状态:${m.activeStatus}` : '',
        m.salary ? `薪资:${m.salary}` : '',
        m.baseInfo ? `信息:${m.baseInfo}` : '',
        m.expect ? `期望:${m.expect}` : '',
        m.experience ? `经历:${m.experience}` : '',
        m.hasHistoryChat ? '同事沟通过' : '',
        m.hasViewed ? '已看过' : '',
        m.canGreet ? '可打招呼' : '已打招呼',
        m.trackedStage ? `台账:${m.trackedStage}${m.trackedScore !== undefined ? `(${m.trackedScore}分)` : ''}` : '',
      ]
        .filter(Boolean)
        .join('｜');
      lines.push(`${m.index}. ${m.name}｜${fields}`);
      lines.push(`   优势: ${adv}`);
    }
    return lines.join('\n');
  });
}
