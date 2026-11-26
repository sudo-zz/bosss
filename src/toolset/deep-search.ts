import type { SafariPage } from '../browser/index.js';
import {
  JOB_SEARCH_ACTION_GAP_MS,
  JOB_SELECT_ACTION_GAP_MS,
  RESUME_PREVIEW_OPEN_GAP_MS,
  sleepRandom,
} from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { ensurePage } from '../common/ensure_page.js';
import { assertQuotaAndInterval, recordQuotaUsage } from '../common/safety.js';
import { findTrackedCandidate } from '../common/tracker.js';
import type { CandidateLocator } from './recommend.js';

const BOSS_CHAT_AI_FORM_URL = 'https://www.zhipin.com/web/chat/aiform';

export type SearchFormSnapshot = {
  selectedJob: string;
  coreRequirements: string[];
  bonusRequirements: string[];
  remainingCountText: string;
  remainingCount: number | null;
  matchButtonText: string;
  matchButtonDisabled: boolean;
};

export type DeepSearchGeekItem = {
  index: number;
  name: string;
  meta: string;
  work: string;
  edu: string;
  reason: string;
  trackedStage?: string;
  trackedScore?: number;
};

export type BossSearchOptions = {
  jobKeyword?: string;
  coreRequirements?: string[];
  bonusRequirements?: string[];
  match?: boolean;
  excludeTracked?: boolean;
  json?: boolean;
};

export function isBossChatAiFormUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    return (u.pathname.replace(/\/+$/, '') || '/') === '/web/chat/aiform';
  } catch {
    return false;
  }
}

async function waitForAiFormReady(page: SafariPage): Promise<void> {
  await page.waitFor(
    async () =>
      page.eval<boolean>(`
        const root = document.querySelector(".ai-form-left");
        const submit = document.querySelector(".ai-form-match-footer .btn-ai-match-v2");
        const selected = document.querySelector(".job-dropmenu-select .job-main-text");
        if (!root || !submit || !selected) return false;
        return (selected.textContent ?? "").replace(/\\s+/g, " ").trim().length > 0;
      `),
    18_000,
    220,
    380,
    '深度搜索表单就绪',
  );
}

export async function ensureInDeepSearchPage(page: SafariPage): Promise<void> {
  if (!isBossChatAiFormUrl(await page.url())) {
    throw new Error('当前不在深度搜索页（/web/chat/aiform），请先通过 boss deep-search 进入。');
  }
  await waitForAiFormReady(page);
}

async function ensureDeepSearchPageReady(page: SafariPage): Promise<void> {
  await ensurePage(page, {
    name: '深度搜索页',
    targetUrl: BOSS_CHAT_AI_FORM_URL,
    matches: isBossChatAiFormUrl,
  });
  await waitForAiFormReady(page);
}

async function readSearchFormSnapshot(page: SafariPage): Promise<SearchFormSnapshot> {
  return page.eval<SearchFormSnapshot>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    function parseCount(text) {
      const m = String(text || "").match(/\\d+/);
      return m ? Number(m[0]) : null;
    }
    function getGroupList(titleKeyword) {
      const headers = Array.from(document.querySelectorAll(".form-content-header"));
      const header = headers.find((el) => norm(el.querySelector(".form-content-title-h3")?.textContent).includes(titleKeyword));
      if (!header) return null;
      let node = header.nextElementSibling;
      while (node && !node.classList.contains("form-content-header")) {
        if (node.classList.contains("form-content-list")) return node;
        node = node.nextElementSibling;
      }
      return null;
    }
    function itemLineText(item, groupTitle) {
      const word = item.querySelector(".form-content-word");
      const w = word ? norm(word.textContent) : "";
      if (w) return w;
      const inp = item.querySelector("input, textarea");
      if (inp && norm(inp.value)) return norm(inp.value);
      const ce = item.querySelector("[contenteditable='true']");
      if (ce) return norm(ce.textContent);
      const title = norm(item.querySelector(".form-content-list-item-title")?.textContent);
      if (!title || title.includes("请至少输入") || title.includes("可输入") || (groupTitle && title.includes(groupTitle))) return "";
      return title;
    }
    function readGroup(titleKeyword) {
      const list = getGroupList(titleKeyword);
      if (!list) return [];
      return Array.from(list.querySelectorAll(".form-content-list-item")).map((item) => itemLineText(item, titleKeyword)).filter(Boolean);
    }
    const selectedJob = norm(document.querySelector(".job-dropmenu-select .job-main-text")?.textContent);
    const remainingCountText = norm(document.querySelector(".ai-form-match-footer-text-count")?.textContent);
    const btn = document.querySelector(".ai-form-match-footer .btn-ai-match-v2");
    const btnText = norm(btn?.textContent);
    let matchButtonDisabled = true;
    if (btn instanceof HTMLElement) {
      const cls = String(btn.className || "");
      const style = getComputedStyle(btn);
      matchButtonDisabled =
        btn.getAttribute("disabled") !== null ||
        /disabled|forbid|ban/i.test(cls) ||
        style.pointerEvents === "none" ||
        Number(style.opacity) < 0.3;
    }
    return {
      selectedJob,
      coreRequirements: readGroup("核心要求"),
      bonusRequirements: readGroup("加分项"),
      remainingCountText,
      remainingCount: parseCount(remainingCountText),
      matchButtonText: btnText || "未知",
      matchButtonDisabled,
    };
  `);
}

async function ensureRequirementGroupRow(
  page: SafariPage,
  titleKeyword: string,
  rowIndex: number,
): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const state = await page.eval<{ ok: boolean; clickedAdd: boolean }>(
      `
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const headers = Array.from(document.querySelectorAll(".form-content-header"));
      const header = headers.find((el) => norm(el.querySelector(".form-content-title-h3")?.textContent).includes(args.title));
      if (!(header instanceof HTMLElement)) return { ok: false, clickedAdd: false };
      let node = header.nextElementSibling;
      let list = null;
      while (node && !node.classList.contains("form-content-header")) {
        if (node.classList.contains("form-content-list")) { list = node; break; }
        node = node.nextElementSibling;
      }
      if (!list) return { ok: false, clickedAdd: false };
      const items = list.querySelectorAll(".form-content-list-item");
      if (items.length > args.rowIndex) return { ok: true, clickedAdd: false };
      const addBtn = header.querySelector(".form-content-title-btn");
      if (addBtn instanceof HTMLElement && norm(addBtn.textContent).includes("添加条件")) {
        addBtn.scrollIntoView({ block: "center", inline: "nearest" });
        addBtn.click();
        return { ok: false, clickedAdd: true };
      }
      return { ok: false, clickedAdd: false };
      `,
      { title: titleKeyword, rowIndex },
    );
    if (state.ok) return;
    if (!state.clickedAdd) break;
    await sleepRandom(260, 480);
  }
  throw new Error(`「${titleKeyword}」无法创建第 ${rowIndex + 1} 条条件行。`);
}

async function fillRequirementGroupRow(
  page: SafariPage,
  titleKeyword: string,
  rowIndex: number,
  value: string,
): Promise<boolean> {
  await page.eval<void>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const headers = Array.from(document.querySelectorAll(".form-content-header"));
    const header = headers.find((el) => norm(el.querySelector(".form-content-title-h3")?.textContent).includes(args.title));
    if (!header) return;
    let node = header.nextElementSibling;
    while (node && !node.classList.contains("form-content-header")) {
      if (node.classList.contains("form-content-list")) {
        const row = node.querySelectorAll(".form-content-list-item")[args.rowIndex];
        const content = row?.querySelector(".form-content-list-item-content") || row?.querySelector(".form-content-list-item-title");
        if (content instanceof HTMLElement) {
          content.scrollIntoView({ block: "center", inline: "nearest" });
          content.click();
        }
        return;
      }
      node = node.nextElementSibling;
    }
    `,
    { title: titleKeyword, rowIndex },
  );
  await sleepRandom(160, 320);

  const shown = await page.eval<string>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    function getList(titleKeyword) {
      const headers = Array.from(document.querySelectorAll(".form-content-header"));
      const header = headers.find((el) => norm(el.querySelector(".form-content-title-h3")?.textContent).includes(titleKeyword));
      if (!header) return null;
      let node = header.nextElementSibling;
      while (node && !node.classList.contains("form-content-header")) {
        if (node.classList.contains("form-content-list")) return node;
        node = node.nextElementSibling;
      }
      return null;
    }
    function setNativeValue(el, val) {
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === "function") tracker.setValue("");
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) desc.set.call(el, val);
      else el.value = val;
    }
    function fire(el, val) {
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: val, inputType: "insertText" }));
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const list = getList(args.title);
    const row = list?.querySelectorAll(".form-content-list-item")[args.rowIndex];
    if (!(row instanceof HTMLElement)) return "";
    const editable = row.querySelector('[contenteditable="true"]');
    let input = row.querySelector(".auto-resize-textarea-wrapper textarea, .auto-resize-textarea-wrapper input, textarea, input");
    if (input instanceof HTMLInputElement && (input.type === "hidden" || input.type === "button" || input.type === "submit")) {
      input = null;
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.focus();
      setNativeValue(input, args.value);
      fire(input, args.value);
      input.blur();
    } else if (editable instanceof HTMLElement) {
      editable.focus();
      editable.textContent = args.value;
      fire(editable, args.value);
      editable.blur();
    } else {
      const titleEl = row.querySelector(".form-content-list-item-title");
      if (!(titleEl instanceof HTMLElement)) return "";
      let word = titleEl.querySelector(".form-content-word");
      if (!(word instanceof HTMLElement)) {
        word = document.createElement("div");
        word.className = "form-content-word";
        titleEl.appendChild(word);
      }
      word.textContent = args.value;
      titleEl.classList.remove("error");
      fire(word, args.value);
      fire(titleEl, args.value);
    }
    const word = row.querySelector(".form-content-word");
    const rowInput = row.querySelector("textarea, input");
    if (rowInput && norm(rowInput.value)) return norm(rowInput.value);
    if (word && norm(word.textContent)) return norm(word.textContent);
    return norm(row.textContent);
    `,
    { title: titleKeyword, rowIndex, value },
  );

  return shown.replace(/\s+/g, ' ').trim() === value.replace(/\s+/g, ' ').trim();
}

async function removeRequirementGroupRowsAfter(
  page: SafariPage,
  titleKeyword: string,
  desiredCount: number,
): Promise<void> {
  for (let guard = 0; guard < 15; guard++) {
    const res = await page.eval<{ count: number; clicked: boolean }>(
      `
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const headers = Array.from(document.querySelectorAll(".form-content-header"));
      const header = headers.find((el) => norm(el.querySelector(".form-content-title-h3")?.textContent).includes(args.title));
      if (!header) return { count: -1, clicked: false };
      let node = header.nextElementSibling;
      let list = null;
      while (node && !node.classList.contains("form-content-header")) {
        if (node.classList.contains("form-content-list")) { list = node; break; }
        node = node.nextElementSibling;
      }
      if (!list) return { count: -1, clicked: false };
      const items = Array.from(list.querySelectorAll(".form-content-list-item"));
      if (items.length <= args.desiredCount) return { count: items.length, clicked: false };
      const row = items[items.length - 1];
      const btn = row?.querySelector(".form-content-list-item-btn");
      if (!(btn instanceof HTMLElement)) return { count: items.length, clicked: false };
      btn.scrollIntoView({ block: "center", inline: "nearest" });
      btn.click();
      return { count: items.length, clicked: true };
      `,
      { title: titleKeyword, desiredCount },
    );
    if (res.count <= desiredCount || !res.clicked) break;
    await sleepRandom(220, 420);
  }
}

async function applyAiFormRequirementLists(
  page: SafariPage,
  opts: { core?: string[]; bonus?: string[] },
): Promise<void> {
  const applyGroup = async (title: string, lines: string[]) => {
    let idx = 0;
    for (const raw of lines) {
      const text = raw.trim();
      if (!text) continue;
      await ensureRequirementGroupRow(page, title, idx);
      const ok = await fillRequirementGroupRow(page, title, idx, text);
      if (!ok) throw new Error(`「${title}」第 ${idx + 1} 条条件未能写入：${text}`);
      idx += 1;
    }
    await removeRequirementGroupRowsAfter(page, title, idx);
  };
  if (opts.core !== undefined) await applyGroup('核心要求', opts.core);
  if (opts.bonus !== undefined) await applyGroup('加分项', opts.bonus);
}

export async function selectAiFormJob(page: SafariPage, keyword: string): Promise<string> {
  const kw = keyword.trim();
  if (!kw) throw new Error('岗位关键字不能为空。');

  const opened = await page.eval<boolean>(`
    const host = document.querySelector(".job-dropmenu-select");
    if (!(host instanceof HTMLElement)) return false;
    host.scrollIntoView({ block: "center", inline: "nearest" });
    host.click();
    return true;
  `);
  if (!opened) throw new Error('未找到深度搜索页岗位下拉（.job-dropmenu-select）。');
  await sleepRandom(JOB_SELECT_ACTION_GAP_MS.min, JOB_SELECT_ACTION_GAP_MS.max);

  await page.eval<boolean>(
    `
    const inputs = Array.from(
      document.querySelectorAll(".ui-dropmenu-list input, .job-dropmenu-options .chat-job-search, input.chat-job-search"),
    );
    const input = inputs.find((el) => el instanceof HTMLInputElement && el.getBoundingClientRect().width > 0);
    if (!input) return false;
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
  await sleepRandom(JOB_SEARCH_ACTION_GAP_MS.min, JOB_SEARCH_ACTION_GAP_MS.max);

  const picked = await page.eval<{ ok: boolean; label?: string }>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim().toLowerCase();
    const rows = Array.from(
      document.querySelectorAll(".job-dropmenu-list .job-dropmenu-item, .job-dropmenu-options .job-list .job-item, .job-dropmenu-popover .job-list .job-item, .job-dropmenu-options .job-item"),
    );
    const target = rows.find((el) => norm(el.querySelector(".job-option-text, .label")?.textContent || el.textContent).includes(norm(args.kw)));
    if (!(target instanceof HTMLElement)) return { ok: false };
    const label = (target.querySelector(".job-option-text, .label")?.textContent ?? target.textContent ?? "").replace(/\\s+/g, " ").trim();
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
    return { ok: true, label };
    `,
    { kw },
  );
  if (!picked.ok) throw new Error(`未找到匹配岗位「${kw}」。`);

  const label = picked.label ?? kw;
  await sleepRandom(JOB_SELECT_ACTION_GAP_MS.min, JOB_SELECT_ACTION_GAP_MS.max);
  await page.waitFor(
    async () =>
      page.eval<boolean>(
        `return (document.querySelector(".job-dropmenu-select .job-main-text")?.textContent ?? "").replace(/\\s+/g, " ").trim() === args.label;`,
        { label },
      ),
    10_000,
    200,
    350,
    `切换深度搜索岗位「${label}」`,
  );
  return label;
}

export async function readAiFormSelectedJobLabel(page: SafariPage): Promise<string> {
  return page.eval<string>(`
    const t = (document.querySelector(".job-dropmenu-select .job-main-text")?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return t.length > 0 ? t : "默认";
  `);
}

export async function readDeepSearchGeekList(page: SafariPage): Promise<DeepSearchGeekItem[]> {
  const raw = await page.eval<Array<Omit<DeepSearchGeekItem, 'index'>>>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const items = Array.from(document.querySelectorAll(".geeks-box .geek-card-item, .geek-card-list .geek-card-item"));
    return items
      .map((item) => {
        const chatLabel = norm(item.querySelector(".geek-chat")?.textContent);
        if (chatLabel.includes("继续沟通")) return null;
        const name = norm(item.querySelector(".geek-name")?.textContent);
        const splits = Array.from(item.querySelectorAll(".geek-exp .split"))
          .map((el) => norm(el.getAttribute("title") || el.textContent || ""))
          .filter(Boolean);
        const meta = splits.join(" · ");
        const work = norm(item.querySelector(".geek-works span")?.textContent);
        const edu = norm(item.querySelector(".geek-edus span")?.textContent);
        const recEl = item.querySelector(".geek-recommend-text");
        const reason = recEl ? norm(recEl.textContent).replace(/^推荐理由\\s*/, "").trim() : "";
        return { name, meta, work, edu, reason };
      })
      .filter((x) => x !== null);
  `);

  return raw.map((g, idx) => {
    const tracked = findTrackedCandidate({ name: g.name });
    return {
      index: idx + 1,
      ...g,
      ...(tracked ? { trackedStage: tracked.stage, trackedScore: tracked.score } : {}),
    };
  });
}

export async function openDeepSearchResumePreview(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<{ opened: boolean; name: string }> {
  const res = await page.eval<{ opened: boolean; name: string }>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const allCards = Array.from(document.querySelectorAll(".geeks-box .geek-card-item, .geek-card-list .geek-card-item"));
    const cards = allCards.filter((item) => !norm(item.querySelector(".geek-chat")?.textContent).includes("继续沟通"));
    if (cards.length === 0) return { opened: false, name: "" };
    let targetCard = null;
    if (typeof args.index === "number" && args.index >= 1) {
      targetCard = cards[args.index - 1] ?? null;
    } else if (args.name) {
      targetCard = cards.find((item) => {
        const name = norm(item.querySelector(".geek-name")?.textContent);
        return name === args.name || name.includes(args.name);
      }) ?? null;
    }
    if (!targetCard) return { opened: false, name: "" };
    const name = norm(targetCard.querySelector(".geek-name")?.textContent);
    const clickables = [
      targetCard.querySelector(".geek-name"),
      targetCard.querySelector("a.resume-btn-online"),
      targetCard.querySelector('a[href*="c-resume"]'),
      targetCard.querySelector(".geek-info, .geek-card-main, .card-content"),
    ];
    for (const el of clickables) {
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

export async function clickGreetDeepSearch(
  page: SafariPage,
  locator: CandidateLocator,
): Promise<{ name: string; message: string }> {
  const result = await page.eval<
    | { kind: 'empty' }
    | { kind: 'all_continue' }
    | { kind: 'not_found' }
    | { kind: 'no_btn'; name: string }
    | { kind: 'disabled'; name: string; label: string }
    | { kind: 'clicked'; name: string }
  >(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const allCards = Array.from(document.querySelectorAll(".geeks-box .geek-card-item, .geek-card-list .geek-card-item"));
    if (allCards.length === 0) return { kind: "empty" };
    const cards = allCards.filter((item) => !norm(item.querySelector(".geek-chat")?.textContent).includes("继续沟通"));
    if (cards.length === 0) return { kind: "all_continue" };
    let targetCard = null;
    if (typeof args.index === "number" && args.index >= 1) {
      targetCard = cards[args.index - 1] ?? null;
    } else if (args.name) {
      targetCard = cards.find((item) => {
        const name = norm(item.querySelector(".geek-name")?.textContent);
        return name === args.name || name.includes(args.name);
      }) ?? null;
    }
    if (!targetCard) return { kind: "not_found" };
    const name = norm(targetCard.querySelector(".geek-name")?.textContent);
    const btn =
      targetCard.querySelector(".geek-chat .btn-ai-v2") ||
      targetCard.querySelector(".geek-chat span[class*='btn-ai']");
    if (!(btn instanceof HTMLElement)) return { kind: "no_btn", name };
    const label = norm(btn.textContent);
    const cls = btn.className ?? "";
    if (!label.includes("打招呼") || /disabled|forbid|ban/i.test(cls) || btn.getAttribute("disabled") !== null) {
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
      throw new Error('深度搜索暂无候选人列表，请先触发「立即匹配」。');
    case 'all_continue':
      throw new Error('当前列表均为「继续沟通」状态，无待打招呼人选。');
    case 'not_found':
      throw new Error('未在可打招呼的深度搜索列表中找到目标候选人。');
    case 'no_btn':
      throw new Error(`候选人 ${result.name} 缺少「打招呼」按钮。`);
    case 'disabled':
      throw new Error(`候选人 ${result.name} 当前不可打招呼（${result.label || '已禁用'}）。`);
    case 'clicked':
      return { name: result.name, message: `已在深度搜索页对 ${result.name} 点击「打招呼」。` };
  }
}

async function triggerAiFormMatch(page: SafariPage): Promise<void> {
  assertQuotaAndInterval('deep_search_match', { isWriteAction: false });
  const before = await readSearchFormSnapshot(page);
  if (before.coreRequirements.length === 0) {
    throw new Error('深度搜索至少需要 1 条核心要求；请先使用 --core 添加。');
  }
  if (before.remainingCount !== null && before.remainingCount <= 0) {
    throw new Error(`今日匹配次数已用完：${before.remainingCountText || '0次'}`);
  }

  const clicked = await page.eval<{ ok: boolean; reason?: string }>(`
    const btn = document.querySelector(".ai-form-match-footer .btn-ai-match-v2");
    if (!(btn instanceof HTMLElement)) return { ok: false, reason: "missing_button" };
    const cls = String(btn.className || "");
    const st = getComputedStyle(btn);
    if (btn.getAttribute("disabled") !== null || /disabled|forbid|ban/i.test(cls) || st.pointerEvents === "none" || Number(st.opacity) < 0.3) {
      return { ok: false, reason: "disabled" };
    }
    btn.scrollIntoView({ block: "center", inline: "nearest" });
    btn.click();
    return { ok: true };
  `);
  if (!clicked.ok) throw new Error(`无法点击「立即匹配」：${clicked.reason ?? 'unknown'}`);

  await sleepRandom(1000, 1500);
  await page.waitFor(
    async () =>
      page.eval<boolean>(
        `
        const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
        const btnText = norm(document.querySelector(".ai-form-match-footer .btn-ai-match-v2")?.textContent);
        const countText = norm(document.querySelector(".ai-form-match-footer-text-count")?.textContent);
        const cards = document.querySelectorAll(".geeks-box .geek-card-item, .geek-card-list .geek-card-item").length;
        const stillMatching = /停止匹配|匹配中|加载中|生成中/.test(btnText);
        return !stillMatching && cards > 0 && (!args.beforeCount || (countText && countText !== args.beforeCount));
        `,
        { beforeCount: before.remainingCountText },
      ),
    35_000,
    350,
    600,
    '深度搜索匹配结果生成',
  );
  recordQuotaUsage('deep_search_match', {
    isWriteAction: false,
    target: before.selectedJob,
    detail: before.coreRequirements.join(' ; '),
  });
}

export async function runBossSearch(opts: BossSearchOptions = {}): Promise<string> {
  const jobKeyword = opts.jobKeyword?.trim();
  const hasFormEdit = opts.coreRequirements !== undefined || opts.bonusRequirements !== undefined;
  const shouldMatch = opts.match === true;

  return withBossSessionPage(async (page) => {
    await ensureDeepSearchPageReady(page);
    if (jobKeyword) {
      await selectAiFormJob(page, jobKeyword);
      await ensureInDeepSearchPage(page);
    }
    if (hasFormEdit) {
      await applyAiFormRequirementLists(page, {
        core: opts.coreRequirements,
        bonus: opts.bonusRequirements,
      });
      await ensureInDeepSearchPage(page);
    }
    if (shouldMatch) {
      await triggerAiFormMatch(page);
    }

    const snap = await readSearchFormSnapshot(page);
    const actionLine = shouldMatch
      ? '深度搜索：已触发「立即匹配」。'
      : hasFormEdit
        ? '深度搜索：已更新表单，未触发「立即匹配」。'
        : '深度搜索：当前表单（未触发「立即匹配」）。';

    const rawGeeks = shouldMatch ? (await readDeepSearchGeekList(page)).slice(0, 20) : [];
    const geeks = opts.excludeTracked ? rawGeeks.filter((g) => !g.trackedStage) : rawGeeks;

    if (opts.json) {
      return JSON.stringify(
        {
          action: actionLine,
          form: snap,
          matched: shouldMatch,
          candidates: geeks,
        },
        null,
        2,
      );
    }

    const lines = [
      actionLine,
      `职位：${snap.selectedJob || '未知职位'}`,
      `核心要求(${snap.coreRequirements.length})：${snap.coreRequirements.join('；') || '（空）'}`,
      `加分项(${snap.bonusRequirements.length})：${snap.bonusRequirements.join('；') || '（空）'}`,
      `今日匹配剩余：${snap.remainingCountText || '未知'}`,
      `匹配按钮：${snap.matchButtonText}${snap.matchButtonDisabled ? '（不可用）' : '（可用）'}`,
    ];

    if (shouldMatch) {
      lines.push('', `本次新增推荐简历（共 ${geeks.length} 人）`, '');
      for (const g of geeks) {
        const track = g.trackedStage
          ? `｜台账:${g.trackedStage}${g.trackedScore !== undefined ? `(${g.trackedScore}分)` : ''}`
          : '';
        lines.push(`${g.index}. ${g.name || '（无姓名）'}${track}`);
        if (g.meta) lines.push(`   概要：${g.meta}`);
        if (g.work) lines.push(`   经历：${g.work}`);
        if (g.edu) lines.push(`   教育：${g.edu}`);
        if (g.reason) lines.push(`   推荐：${g.reason}`);
      }
    }
    return lines.join('\n').trimEnd();
  });
}
