import type { SafariPage } from '../browser/index.js';
import {
  CHAT_HISTORY_DIALOG_WAIT_MS,
  CHAT_HISTORY_TAB_SWITCH_MS,
  OPEN_CHAT_AFTER_ROW_CLICK_MS,
  OPEN_CHAT_SCROLL_GAP_MS,
  sleepRandom,
} from '../browser/index.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { findTrackedCandidate } from '../common/tracker.js';
import { ensureChatListReady, scrollChatListStep, scrollChatListToTop } from './list.js';

type ChatFrom = 'friend' | 'myself' | 'system' | 'unknown';

function chatRoleTag(from: ChatFrom): string {
  switch (from) {
    case 'friend':
      return '[candidate]';
    case 'myself':
      return '[you]';
    case 'system':
      return '[system]';
    default:
      return '[unknown]';
  }
}

export type ColleagueHistoryRecord = {
  action: string;
  operat: string;
};

export type ColleagueHistoryResult = {
  found: boolean;
  colleague: ColleagueHistoryRecord[];
  mine: ColleagueHistoryRecord[];
};

export type CandidateSummary = {
  name: string;
  gender: string;
  active: string;
  basicFacts: string[];
  recentExperience: string[];
  experienceTimelines: Array<{ time: string; detail: string }>;
  communicationPosition: string;
  expectation: string;
  remark: string;
  hasAttachmentBtnEnabled: boolean;
  avatarUrl: string;
};

export type ChatMessageItem = {
  time: string;
  from: ChatFrom;
  text: string;
};

export type ChatMessageSnapshot = {
  messages: ChatMessageItem[];
  hasFriendResumeAttachment: boolean;
  friendImages: string[];
};

async function waitForChatHistoryPanelReady(
  page: SafariPage,
  selectedTab?: string,
): Promise<void> {
  await page.waitFor(
    async () =>
      page.eval<boolean>(
        `
        function norm(v) { return (v ?? "").replace(/\\s+/g, " ").trim(); }
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        }
        const root = document.querySelector(".chat-history-process");
        if (!isVisible(root)) return false;
        if (args.tabLabel) {
          const selected = root.querySelector(".tab-hd span.selected");
          if (norm(selected?.textContent) !== args.tabLabel) return false;
        }
        return !!root.querySelector(".record");
        `,
        { tabLabel: selectedTab ?? null },
      ),
    10_000,
    180,
    320,
    '沟通记录弹窗渲染',
  );
}

async function closeChatHistoryPopup(page: SafariPage): Promise<void> {
  await page.eval<void>(`
    const root =
      document.querySelector(".boss-popup__wrapper.chat-history") ||
      document.querySelector(".boss-dialog__wrapper.chat-history");
    const c = root?.querySelector(".boss-popup__close") ?? document.querySelector(".boss-popup__close");
    if (c instanceof HTMLElement) c.click();
  `);
  await sleepRandom(220, 420);
}

async function fetchColleagueChatHistoryData(page: SafariPage): Promise<ColleagueHistoryResult> {
  const clicked = await page.eval<boolean>(`
    function norm(v) { return (v ?? "").replace(/\\s+/g, " ").trim(); }
    const tooltips = Array.from(document.querySelectorAll(".chat-tooltip-custom"));
    for (const el of tooltips) {
      if (!norm(el.textContent).includes("沟通记录")) continue;
      const host = el.closest("span.icon") ?? el.closest("span") ?? el.parentElement;
      if (host instanceof HTMLElement) { host.click(); return true; }
      if (el instanceof HTMLElement) { el.click(); return true; }
    }
    const uses = Array.from(document.querySelectorAll("use"));
    for (const u of uses) {
      const h = u.getAttribute("href") || u.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
      if (h.includes("icon-chat-history")) {
        const p = u.closest("span.icon") ?? u.parentElement?.parentElement;
        if (p instanceof HTMLElement) { p.click(); return true; }
      }
    }
    return false;
  `);

  if (!clicked) {
    return { found: false, colleague: [], mine: [] };
  }

  await sleepRandom(CHAT_HISTORY_DIALOG_WAIT_MS.min, CHAT_HISTORY_DIALOG_WAIT_MS.max);
  await waitForChatHistoryPanelReady(page);

  const scrapeRows = () =>
    page.eval<ColleagueHistoryRecord[]>(`
      function norm(v) { return (v ?? "").replace(/\\s+/g, " ").trim(); }
      const root = document.querySelector(".chat-history-process");
      if (!root) return [];
      return Array.from(root.querySelectorAll(".record li"))
        .map((li) => ({
          action: norm(li.querySelector(".action")?.textContent),
          operat: norm(li.querySelector(".operat")?.textContent),
        }))
        .filter((x) => x.action || x.operat);
    `);

  const clickTab = (label: string) =>
    page.eval<void>(
      `
      function norm(v) { return (v ?? "").replace(/\\s+/g, " ").trim(); }
      const root = document.querySelector(".chat-history-process");
      if (!root) return;
      const spans = Array.from(root.querySelectorAll(".tab-hd span"));
      const sp = spans.find((s) => norm(s.textContent) === args.label);
      if (sp instanceof HTMLElement && !sp.classList.contains("selected")) sp.click();
      `,
      { label },
    );

  await clickTab('同事沟通');
  await sleepRandom(CHAT_HISTORY_TAB_SWITCH_MS.min, CHAT_HISTORY_TAB_SWITCH_MS.max);
  await waitForChatHistoryPanelReady(page, '同事沟通').catch(() => {});
  const colleague = await scrapeRows();

  await clickTab('我的沟通');
  await sleepRandom(CHAT_HISTORY_TAB_SWITCH_MS.min, CHAT_HISTORY_TAB_SWITCH_MS.max);
  await waitForChatHistoryPanelReady(page, '我的沟通').catch(() => {});
  const mine = await scrapeRows();

  await closeChatHistoryPopup(page);
  return { found: true, colleague, mine };
}

export async function runGetCommunicationHistory(
  page: SafariPage,
  opts: { json?: boolean } = {},
): Promise<string> {
  const currentUrl = await page.url();
  if (!isBossChatIndexUrl(currentUrl)) {
    throw new Error('请先进入聊天列表页（/web/chat/index）并打开候选人聊天。');
  }
  const hasDetail = await page.eval<boolean>(
    `return !!document.querySelector(".base-info-single-container");`,
  );
  if (!hasDetail) {
    throw new Error('请先打开候选人聊天详情页，再执行“沟通记录”操作。');
  }

  const data = await fetchColleagueChatHistoryData(page);
  if (opts.json) {
    return JSON.stringify(data, null, 2);
  }
  if (!data.found) {
    return '未找到「沟通记录」入口，或当前候选人暂无可读取记录。';
  }
  const fmt = (label: string, rows: ColleagueHistoryRecord[]): string[] => {
    const lines = [`[${label}]`];
    if (rows.length === 0) {
      lines.push('(暂无)');
      return lines;
    }
    rows.forEach((r, i) => {
      lines.push(`${i + 1}. ${[r.action, r.operat].filter(Boolean).join(' ｜ ')}`);
    });
    return lines;
  };
  return ['同事/我的沟通记录：', '', ...fmt('同事沟通', data.colleague), '', ...fmt('我的沟通', data.mine)].join('\n');
}

export async function fetchCandidateSummary(
  page: SafariPage,
  expectedName: string,
  exactMatch: boolean,
): Promise<CandidateSummary> {
  return page.eval<CandidateSummary>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const matches = (value) => args.exact ? value === args.targetName : value.includes(args.targetName);
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const roots = Array.from(document.querySelectorAll(".base-info-single-container")).filter(isVisible);
    const root = roots.find((el) => matches(norm(el.querySelector(".name-box")?.textContent)));
    if (!root) {
      const visibleNames = roots.map((el) => norm(el.querySelector(".name-box")?.textContent)).filter(Boolean).join(", ");
      throw new Error("未找到目标候选人详情容器：" + args.targetName + "；当前可见详情：" + (visibleNames || "空"));
    }
    const name = norm(root.querySelector(".name-box")?.textContent);
    const genderUse = root.querySelector(".name-contet use");
    const genderHref = genderUse ? (genderUse.getAttribute("href") || genderUse.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "") : "";
    const gender = genderHref.includes("women") ? "女" : genderHref.includes("men") ? "男" : "";
    const onlineImg = root.querySelector(".online-info-img img");
    const active = norm(root.querySelector(".high-light-orange.active-time span")?.textContent) || (onlineImg ? "在线中" : "");
    const basicFacts = Array.from(root.querySelectorAll(".base-info-single-detial > div"))
      .filter((el) => !el.classList.contains("name-contet") && !el.classList.contains("active-time") && !el.classList.contains("online-info-img"))
      .map((el) => norm(el.textContent))
      .filter((v) => v.length > 0);
    const times = Array.from(root.querySelectorAll(".experience-content.time-list .time-content .time"))
      .map((el) => norm(el.textContent));
    const details = Array.from(root.querySelectorAll(".experience-content.detail-list .work-content .value"))
      .map((el) => norm(el.textContent));
    const experienceTimelines = [];
    const recentExperience = [];
    const maxLen = Math.max(times.length, details.length);
    for (let i = 0; i < maxLen; i++) {
      const t = times[i] || "";
      const d = details[i] || "";
      if (!t && !d) continue;
      experienceTimelines.push({ time: t, detail: d });
      recentExperience.push(t && d ? (t + "｜" + d) : (d || t));
    }
    const communicationPosition = norm(root.querySelector(".position-item .position-name")?.textContent);
    const expectation = norm(root.querySelector(".position-item.expect .value.job")?.textContent);
    const remark = norm(root.querySelector(".label-remark-content .remark span:last-child")?.textContent);
    const fileBtn = root.querySelector(".resume-btn-file");
    const hasAttachmentBtnEnabled = !!fileBtn && !fileBtn.classList.contains("disabled");

    const selectedRow = Array.from(document.querySelectorAll(".geek-item.selected")).find(isVisible);
    const avatarCandidates = [
      selectedRow?.querySelector(".figure img.image-square, .figure img, img.image-square"),
      root.querySelector(".avatar img, .geek-avatar img, img.avatar"),
    ];
    let avatarUrl = "";
    for (const img of avatarCandidates) {
      if (!img) continue;
      const src = img.getAttribute("src") || img.currentSrc || "";
      if (src && !src.startsWith("data:") && !src.includes("/beijin/icon/") && !src.includes("icon-")) {
        avatarUrl = src;
        break;
      }
    }
    return {
      name,
      gender,
      active,
      basicFacts,
      recentExperience,
      experienceTimelines,
      communicationPosition,
      expectation,
      remark,
      hasAttachmentBtnEnabled,
      avatarUrl,
    };
    `,
    { targetName: expectedName, exact: exactMatch },
  );
}

export async function waitForOpenedCandidateChat(
  page: SafariPage,
  expectedName: string,
  exact = true,
): Promise<void> {
  await page.waitFor(
    async () =>
      page.eval<boolean>(
        `
        const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
        const matches = (value) => args.exact ? value === args.name : value.includes(args.name);
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const selected = Array.from(document.querySelectorAll(".geek-item.selected")).find(isVisible);
        const selectedName = norm(selected?.querySelector(".geek-name")?.textContent);
        const root = Array.from(document.querySelectorAll(".base-info-single-container")).find(isVisible);
        const detailName = norm(root?.querySelector(".name-box")?.textContent);
        return matches(selectedName) && matches(detailName);
        `,
        { name: expectedName, exact },
      ),
    15_000,
    180,
    340,
    `候选人「${expectedName}」聊天详情面板加载`,
  );

  await page.waitFor(
    async () =>
      page.eval<boolean>(`
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const lists = Array.from(document.querySelectorAll(".chat-message-list")).filter(isVisible);
        const list = lists[lists.length - 1];
        if (!list) return false;
        const items = list.querySelectorAll(".message-item");
        if (!items || items.length === 0) return false;
        return Array.from(items).some((item) => {
          const hasImg = !!item.querySelector(".item-friend img");
          const txt =
            item.querySelector(".item-friend .text span")?.textContent ??
            item.querySelector(".item-myself .text span")?.textContent ??
            item.querySelector(".item-system .message-card-top-title")?.textContent ??
            item.querySelector(".item-friend .message-card-top-title")?.textContent ??
            "";
          return hasImg || txt.replace(/\\s+/g, " ").trim().length > 0;
        });
      `),
    18_000,
    200,
    360,
    '聊天消息列表加载',
  );
}

export async function scrapeCurrentChatMessages(page: SafariPage): Promise<ChatMessageSnapshot> {
  return page.eval<ChatMessageSnapshot>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const isUpsell = (text) => norm(text).indexOf("优先提醒") !== -1;
    const lists = Array.from(document.querySelectorAll(".chat-message-list")).filter(isVisible);
    const list = lists[lists.length - 1];
    if (!list) throw new Error("未找到可见聊天消息列表（.chat-message-list）。");

    const items = Array.from(list.querySelectorAll(".message-item"));
    let currentTime = "";
    const messages = [];
    const friendImages = [];
    let hasFriendResumeAttachment = false;
    for (const item of items) {
      const timeNode = item.querySelector(".message-time .time");
      if (timeNode) {
        const t = norm(timeNode.textContent);
        if (t) currentTime = t;
      }
      const friendRoot = item.querySelector(".item-friend");
      let friendText = "";
      if (friendRoot) {
        const imgs = Array.from(friendRoot.querySelectorAll(".text img, .img-wrap img, img.image-message"));
        for (const img of imgs) {
          const src = img.getAttribute("src") || img.currentSrc || "";
          if (src && !src.startsWith("data:") && !src.includes("avatar")) {
            friendImages.push(src);
          }
        }
        friendText = norm(friendRoot.querySelector(".text > span")?.textContent);
        if (!friendText) {
          const resumeIcon = friendRoot.querySelector(".resume-icon");
          const title = norm(friendRoot.querySelector(".message-card-top-title")?.textContent);
          const cardBtn = norm(friendRoot.querySelector(".message-card-buttons .card-btn")?.textContent);
          // 「对方想发送附件简历，您是否同意」只是交换请求卡，不代表已收到附件
          const isExchangeRequest = /想发送附件简历|是否同意/.test(title + cardBtn);
          if (!isExchangeRequest && (resumeIcon || /附件简历|点击预览/.test(title + cardBtn))) {
            hasFriendResumeAttachment = true;
          }
          const parts = [title, cardBtn].filter(Boolean);
          friendText = parts.length ? parts.join(" · ") : norm(friendRoot.querySelector(".text")?.textContent);
        }
        if (!friendText && friendImages.length > 0) {
          friendText = "[图片消息]";
        }
      }
      const myselfText = norm(item.querySelector(".item-myself .text span")?.textContent);
      const systemText =
        norm(item.querySelector(".item-system .message-card-top-title")?.textContent) ||
        norm(item.querySelector(".item-system .text span")?.textContent);
      if (friendText) {
        messages.push({ text: friendText, time: currentTime, from: "friend" });
      } else if (myselfText) {
        messages.push({ text: myselfText, time: currentTime, from: "myself" });
      } else if (systemText && !isUpsell(systemText)) {
        messages.push({ text: systemText, time: currentTime, from: "system" });
      }
    }
    return { messages, hasFriendResumeAttachment, friendImages: Array.from(new Set(friendImages)) };
  `);
}

async function renderOpenedCandidateChat(
  page: SafariPage,
  foundName: string,
  opts: { exact?: boolean; json?: boolean } = {},
): Promise<string> {
  await waitForOpenedCandidateChat(page, foundName, opts.exact ?? true);
  const scraped = await scrapeCurrentChatMessages(page);
  const summary = await fetchCandidateSummary(page, foundName, opts.exact ?? true);
  const tracked = findTrackedCandidate({
    name: summary.name || foundName,
    job: summary.communicationPosition,
  });

  if (opts.json) {
    return JSON.stringify(
      {
        candidate: summary,
        hasFriendResumeAttachment: scraped.hasFriendResumeAttachment,
        friendImages: scraped.friendImages,
        tracked: tracked
          ? { id: tracked.id, stage: tracked.stage, score: tracked.score, reason: tracked.reason }
          : null,
        messages: scraped.messages,
      },
      null,
      2,
    );
  }

  const detailLines = scraped.messages.map((m) => {
    const tag = chatRoleTag(m.from);
    const timePart = m.time ? ` ${m.time}` : '';
    return `${tag}${timePart} ${m.text}`.trimEnd();
  });

  const out: string[] = [
    `成功进入候选人聊天：${summary.name || foundName}`,
    `简历获取状态: ${scraped.hasFriendResumeAttachment ? '已获取' : '未获取'}`,
  ];
  if (summary.avatarUrl) out.push(`头像URL: ${summary.avatarUrl}`);
  if (tracked) {
    out.push(
      `本地台账状态: ${tracked.stage}${tracked.score !== undefined ? `（${tracked.score}分）` : ''}${tracked.reason ? `｜${tracked.reason}` : ''}`,
    );
  }
  const summaryLines: string[] = [`姓名: ${summary.name || foundName}`];
  if (summary.active) summaryLines.push(`活跃状态: ${summary.active}`);
  if (summary.basicFacts.length > 0) summaryLines.push(`基本信息: ${summary.basicFacts.join(' / ')}`);
  if (summary.communicationPosition) summaryLines.push(`沟通职位: ${summary.communicationPosition}`);
  if (summary.expectation) summaryLines.push(`期望: ${summary.expectation}`);
  if (summary.recentExperience.length > 0) {
    summaryLines.push('近期经历:');
    summary.recentExperience.forEach((it, idx) => summaryLines.push(`${idx + 1}. ${it}`));
  }
  out.push('', '人才摘要：', '', ...summaryLines);
  if (summary.remark) out.push('', `备注: ${summary.remark}`);
  out.push('', '完整聊天消息：', '', ...(detailLines.length > 0 ? detailLines : ['(暂无)']));
  return out.join('\n');
}

export async function runOpenCandidateChatByIndex(
  page: SafariPage,
  params: {
    index: number;
    filter?: 'all' | 'unread';
    expectedName?: string;
    exact?: boolean;
    json?: boolean;
  },
): Promise<string> {
  if (!Number.isInteger(params.index) || params.index < 1) {
    throw new Error(`聊天列表序号必须是从 1 开始的整数，当前值：${params.index}`);
  }
  const filter = params.filter ?? 'all';
  const expectedName = params.expectedName?.trim() ?? '';
  const exact = params.exact === true;

  await ensureChatListReady(page, filter);
  if (!isBossChatIndexUrl(await page.url())) {
    throw new Error('当前不在沟通列表页（/web/chat/index），无法打开候选人聊天。');
  }

  const rowInfo = await page.eval<{ total: number; name: string }>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const wraps = Array.from(document.querySelectorAll(".geek-item-wrap"));
    const total = wraps.length;
    const wrap = wraps[args.rowIndex - 1];
    if (!wrap) return { total, name: "" };
    const name = norm(wrap.querySelector(".geek-name")?.textContent);
    if (args.expectedName) {
      const matched = args.exact ? name === args.expectedName : name.includes(args.expectedName);
      if (!matched) {
        throw new Error("聊天列表序号 " + args.rowIndex + " 的候选人是「" + name + "」，与指定姓名「" + args.expectedName + "」不匹配。");
      }
    }
    const row = wrap.querySelector(".geek-item") || wrap;
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
      row.click();
    }
    return { total, name };
    `,
    { rowIndex: params.index, expectedName, exact },
  );

  if (!rowInfo.name) {
    throw new Error(
      `聊天列表序号 ${params.index} 不存在；当前${filter === 'unread' ? '未读' : '全部'}列表共 ${rowInfo.total} 条。`,
    );
  }

  await sleepRandom(OPEN_CHAT_AFTER_ROW_CLICK_MS.min, OPEN_CHAT_AFTER_ROW_CLICK_MS.max);
  return renderOpenedCandidateChat(page, rowInfo.name, { exact: true, json: params.json });
}

export async function runOpenCandidateChat(
  page: SafariPage,
  candidateName: string,
  exact = false,
  opts: { json?: boolean } = {},
): Promise<string> {
  const targetName = candidateName.trim();
  await ensureChatListReady(page);
  if (!isBossChatIndexUrl(await page.url())) {
    throw new Error('当前不在沟通列表页（/web/chat/index），无法打开候选人聊天。');
  }

  // 当前右侧已打开的就是目标候选人时直接复用，避免每次都从头滚动会话列表
  // （批量发消息场景下这一步能把「逐个找人」的耗时从分钟级降到秒级）
  const openedName = await page.eval<string>(`
    const el = document.querySelector(".base-info-single-container .name-box");
    return (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
  `);
  if (openedName) {
    const hit = exact ? openedName === targetName : openedName.includes(targetName);
    if (hit) {
      return renderOpenedCandidateChat(page, openedName, { exact: true, json: opts.json });
    }
  }

  await scrollChatListToTop(page);
  let foundName = '';
  let lastScrollHeight = 0;
  let staleAtEnd = 0;
  const maxScrollRounds = 240;

  for (let round = 0; round < maxScrollRounds; round++) {
    const clicked = await page.eval<{ found: boolean; name: string }>(
      `
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const matches = (v) => args.exact ? v === args.targetName : v.includes(args.targetName);
      const wraps = Array.from(document.querySelectorAll(".geek-item-wrap"));
      const target = wraps.find((w) => matches(norm(w.querySelector(".geek-name")?.textContent)));
      if (!target) return { found: false, name: "" };
      const name = norm(target.querySelector(".geek-name")?.textContent);
      const row = target.querySelector(".geek-item") || target;
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
        row.click();
      }
      return { found: true, name };
      `,
      { targetName, exact },
    );

    if (clicked.found) {
      foundName = clicked.name;
      break;
    }

    const scrollState = await scrollChatListStep(page);
    if (!scrollState.moved || scrollState.atEnd) {
      await sleepRandom(650, 1050);
      if (scrollState.scrollHeight > lastScrollHeight) {
        lastScrollHeight = scrollState.scrollHeight;
        staleAtEnd = 0;
      } else {
        staleAtEnd += 1;
        if (staleAtEnd >= 2) break;
      }
      continue;
    }
    lastScrollHeight = scrollState.scrollHeight;
    staleAtEnd = 0;
    await sleepRandom(OPEN_CHAT_SCROLL_GAP_MS.min, OPEN_CHAT_SCROLL_GAP_MS.max);
  }

  if (!foundName) {
    throw new Error(`未在聊天列表中找到候选人：${targetName}`);
  }

  await sleepRandom(OPEN_CHAT_AFTER_ROW_CLICK_MS.min, OPEN_CHAT_AFTER_ROW_CLICK_MS.max);
  return renderOpenedCandidateChat(page, foundName, { exact: true, json: opts.json });
}
