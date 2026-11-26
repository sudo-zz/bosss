import type { SafariPage } from '../browser/index.js';
import { ONLINE_RESUME_IFRAME_WAIT_MAX_MS, sleepRandom } from '../browser/index.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import {
  closeBossPaywallPopupIfPresent,
  describeBossPaywallPopupIfPresent,
  waitForCResumeIframeOrPaywall,
} from '../common/boss_paywall_popup.js';
import { extractOnlineResumeFromOpenIframe } from '../common/c_resume_capture.js';
import {
  assertQuotaAndInterval,
  evaluateWriteGuard,
  recordQuotaUsage,
} from '../common/safety.js';
import { upsertTrackedCandidate } from '../common/tracker.js';
import { runGetCommunicationHistory } from './chat.js';

export type ChatPageAction =
  | 'resume'
  | 'not-fit'
  | 'remark'
  | 'agree-resume'
  | 'request-attachment-resume'
  | 'history'
  | 'exchange-wechat';

export type ChatActionOptions = {
  action: ChatPageAction;
  remark?: string;
  confirm?: boolean;
  dryRun?: boolean;
  screenshot?: boolean;
  json?: boolean;
};

async function ensureInCandidateChat(page: SafariPage, actionLabel: string): Promise<string> {
  const currentUrl = await page.url();
  if (!isBossChatIndexUrl(currentUrl)) {
    throw new Error('请先进入聊天列表页（/web/chat/index）并打开候选人聊天。');
  }
  const candidateName = await page.eval<string>(`
    const root = document.querySelector(".base-info-single-container");
    if (!root) return "";
    return (root.querySelector(".name-box")?.textContent ?? "").replace(/\\s+/g, " ").trim() || "当前候选人";
  `);
  if (!candidateName) {
    throw new Error(`请先打开候选人聊天详情页，再执行“${actionLabel}”操作。`);
  }
  return candidateName;
}

async function markCandidateNotFitWithoutReason(
  page: SafariPage,
  opts: ChatActionOptions,
): Promise<string> {
  const candidateName = await ensureInCandidateChat(page, '不合适');
  const guard = evaluateWriteGuard({
    action: 'not_fit',
    actionLabel: '标记候选人「不合适」',
    target: candidateName,
    confirm: opts.confirm,
    dryRun: opts.dryRun,
    retryHint: 'boss action not-fit --confirm',
  });
  if (!guard.allowed) {
    return opts.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
  }

  const clicked = await page.eval<boolean>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim();
    const roots = Array.from(document.querySelectorAll(".operate-exchange-right .operate-icon-item, .operate-icon-item"));
    const target = roots.find((el) => norm(el.querySelector(".operate-btn")?.textContent || el.textContent).includes("不合适"));
    if (!target) return false;
    const btn = target.querySelector(".operate-btn");
    const host = btn instanceof HTMLElement ? btn : target;
    host.scrollIntoView({ block: "center", inline: "nearest" });
    ["mouseover", "mouseenter", "mousemove"].forEach((t) =>
      host.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })),
    );
    host.click();
    return true;
  `);
  if (!clicked) {
    throw new Error('未找到“不合适”按钮，无法执行操作。');
  }

  await sleepRandom(320, 720);
  recordQuotaUsage('not_fit', { isWriteAction: true, target: candidateName });
  upsertTrackedCandidate({ name: candidateName, stage: 'rejected', event: 'boss_not_fit' });
  const msg = `已对 ${candidateName} 点击「不合适」。`;
  return opts.json ? JSON.stringify({ executed: true, action: 'not-fit', candidate: candidateName, message: msg }, null, 2) : msg;
}

async function runExchangeWechat(page: SafariPage, opts: ChatActionOptions): Promise<string> {
  const candidateName = await ensureInCandidateChat(page, '换微信');
  const guard = evaluateWriteGuard({
    action: 'wechat',
    actionLabel: '向候选人发起「换微信」',
    target: candidateName,
    confirm: opts.confirm,
    dryRun: opts.dryRun,
    retryHint: 'boss action wechat --confirm',
  });
  if (!guard.allowed) {
    return opts.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
  }

  const availability = await page.eval<{ found: boolean; available: boolean }>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, "");
    const items = Array.from(document.querySelectorAll(".operate-exchange-left .operate-icon-item, .operate-icon-item"));
    const target = items.find((el) => norm(el.querySelector(".operate-btn")?.textContent).includes("换微信"));
    if (!target) return { found: false, available: false };
    const btn = target.querySelector(".operate-btn");
    const cls = [target.className ?? "", btn?.className ?? ""].join(" ");
    const disabled = /disabled|forbid|ban/i.test(cls) || btn?.getAttribute("disabled") !== null;
    if (!disabled) {
      const host = btn instanceof HTMLElement ? btn : target;
      host.scrollIntoView({ block: "center", inline: "nearest" });
      host.click();
    }
    return { found: true, available: !disabled };
  `);
  if (!availability.found) throw new Error('未找到“换微信”按钮。');
  if (!availability.available) throw new Error('当前“换微信”按钮不可用，请确认双方互动状态。');

  await sleepRandom(280, 520);
  await page.waitFor(
    async () =>
      page.eval<boolean>(`
        const tips = Array.from(document.querySelectorAll(".exchange-tooltip"));
        return tips.some((tip) => {
          if (!(tip instanceof HTMLElement)) return false;
          const st = window.getComputedStyle(tip);
          if (st.display === "none" || st.visibility === "hidden") return false;
          return (tip.textContent ?? "").replace(/\\s+/g, "").includes("交换微信") && !!tip.querySelector(".btn-box .boss-btn-primary");
        });
      `),
    10_000,
    180,
    300,
    '交换微信确认框出现',
  );

  const confirmed = await page.eval<boolean>(`
    const tips = Array.from(document.querySelectorAll(".exchange-tooltip"));
    for (const tip of tips) {
      if (!(tip instanceof HTMLElement)) continue;
      const st = window.getComputedStyle(tip);
      if (st.display === "none" || st.visibility === "hidden") continue;
      if (!(tip.textContent ?? "").replace(/\\s+/g, "").includes("交换微信")) continue;
      const primary = tip.querySelector(".btn-box .boss-btn-primary");
      if (primary instanceof HTMLElement && (primary.textContent ?? "").includes("确定")) {
        primary.click();
        return true;
      }
    }
    return false;
  `);
  if (!confirmed) throw new Error('已弹出交换微信确认框，但未点到「确定」按钮。');

  await sleepRandom(320, 720);
  recordQuotaUsage('wechat', { isWriteAction: true, target: candidateName });
  const msg = `已向 ${candidateName} 点击「换微信」并确认。`;
  return opts.json ? JSON.stringify({ executed: true, action: 'wechat', candidate: candidateName, message: msg }, null, 2) : msg;
}

export async function runRequestAttachmentResume(
  page: SafariPage,
  opts: { confirm?: boolean; dryRun?: boolean; json?: boolean; skipGuard?: boolean } = {},
): Promise<string> {
  const candidateName = await ensureInCandidateChat(page, '求简历');
  if (!opts.skipGuard) {
    const guard = evaluateWriteGuard({
      action: 'request_resume',
      actionLabel: '向候选人发起「求简历」',
      target: candidateName,
      confirm: opts.confirm,
      dryRun: opts.dryRun,
      retryHint: 'boss action request-attachment-resume --confirm',
    });
    if (!guard.allowed) {
      return opts.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
    }
  }

  const availability = await page.eval<{ found: boolean; available: boolean }>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, "");
    const items = Array.from(document.querySelectorAll(".operate-exchange-left .operate-icon-item, .operate-icon-item"));
    const target = items.find((el) => norm(el.querySelector(".operate-btn")?.textContent).includes("求简历"));
    if (!target) return { found: false, available: false };
    const btn = target.querySelector(".operate-btn");
    const cls = [target.className ?? "", btn?.className ?? ""].join(" ");
    const disabled = /disabled|forbid|ban/i.test(cls) || btn?.getAttribute("disabled") !== null;
    if (!disabled) {
      const host = btn instanceof HTMLElement ? btn : target;
      host.scrollIntoView({ block: "center", inline: "nearest" });
      host.click();
    }
    return { found: true, available: !disabled };
  `);
  if (!availability.found) throw new Error('未找到「求简历」按钮。');
  if (!availability.available) {
    throw new Error('当前「求简历」不可用（Boss 要求双方各至少发送一条消息后才可请求附件简历）。');
  }

  await sleepRandom(280, 520);
  await page.waitFor(
    async () =>
      page.eval<boolean>(`
        const tips = Array.from(document.querySelectorAll(".exchange-tooltip"));
        return tips.some((tip) => {
          if (!(tip instanceof HTMLElement)) return false;
          const st = window.getComputedStyle(tip);
          if (st.display === "none" || st.visibility === "hidden") return false;
          return (tip.textContent ?? "").replace(/\\s+/g, "").includes("索取简历") && !!tip.querySelector(".btn-box .boss-btn-primary");
        });
      `),
    10_000,
    180,
    300,
    '求简历确认框出现',
  );

  const confirmed = await page.eval<boolean>(`
    const tips = Array.from(document.querySelectorAll(".exchange-tooltip"));
    for (const tip of tips) {
      if (!(tip instanceof HTMLElement)) continue;
      const st = window.getComputedStyle(tip);
      if (st.display === "none" || st.visibility === "hidden") continue;
      if (!(tip.textContent ?? "").replace(/\\s+/g, "").includes("索取简历")) continue;
      const primary = tip.querySelector(".btn-box .boss-btn-primary");
      if (primary instanceof HTMLElement && (primary.textContent ?? "").includes("确定")) {
        primary.click();
        return true;
      }
    }
    return false;
  `);
  if (!confirmed) throw new Error('已弹出求简历确认框，但未点到「确定」按钮。');

  await sleepRandom(320, 720);
  recordQuotaUsage('request_resume', { isWriteAction: !opts.skipGuard, target: candidateName });
  const msg = `已对 ${candidateName} 点击「求简历」并确认。`;
  return opts.json ? JSON.stringify({ executed: true, action: 'request-attachment-resume', candidate: candidateName, message: msg }, null, 2) : msg;
}

async function updateCandidateRemark(
  page: SafariPage,
  remarkText: string,
  opts: ChatActionOptions,
): Promise<string> {
  const nextRemark = remarkText.trim();
  if (!nextRemark) throw new Error('备注内容不能为空。');
  if (nextRemark.length > 120) throw new Error(`备注内容过长（${nextRemark.length}/120），请缩短后重试。`);

  const candidateName = await ensureInCandidateChat(page, '备注');
  const guard = evaluateWriteGuard({
    action: 'remark',
    actionLabel: '更新 Boss 候选人备注',
    target: candidateName,
    detail: nextRemark,
    confirm: opts.confirm,
    dryRun: opts.dryRun,
    retryHint: `boss action remark --remark ${JSON.stringify(nextRemark)} --confirm`,
  });
  if (!guard.allowed) {
    return opts.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
  }

  const openedMore = await page.eval<boolean>(`
    const popovers = Array.from(document.querySelectorAll(".rightbar-item .popover"))
      .filter((el) => !!el.querySelector(".popover-wrap.rightbar-more-tooltip"));
    if (popovers.length === 0) return false;
    const popover = popovers[popovers.length - 1];
    const host = popover.querySelector(".icon") || popover;
    if (!(host instanceof HTMLElement)) return false;
    host.click();
    return true;
  `);
  if (!openedMore) throw new Error('未找到右侧“更多”按钮，无法打开备注菜单。');

  await sleepRandom(160, 320);
  const clickedRemark = await page.eval<boolean>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim();
    const wraps = Array.from(document.querySelectorAll(".popover-wrap.rightbar-more-tooltip"));
    for (let i = wraps.length - 1; i >= 0; i--) {
      const items = Array.from(wraps[i].querySelectorAll(".more-list .item"));
      const item = items.find((el) => norm(el.textContent).includes("备注"));
      if (item instanceof HTMLElement) { item.click(); return true; }
    }
    return false;
  `);
  if (!clickedRemark) throw new Error('未找到“备注”菜单项。');

  const textareaSel =
    '.boss-dialog__wrapper.dialog-default-v2 .dialog-geek-remark textarea.input, ' +
    '.boss-popup__wrapper.dialog-default-v2 .dialog-geek-remark textarea.input';

  await page.waitFor(
    async () =>
      page.eval<boolean>(`return !!document.querySelector(args.sel);`, { sel: textareaSel }),
    10_000,
    180,
    300,
    '备注输入弹窗出现',
  );
  await sleepRandom(220, 420);

  const filled = await page.eval<boolean>(
    `
    const el = document.querySelector(args.sel);
    if (!(el instanceof HTMLTextAreaElement)) return false;
    el.focus();
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (desc?.set) desc.set.call(el, args.text);
    else el.value = args.text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: args.text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return (el.value ?? "").trim() === args.text;
    `,
    { sel: textareaSel, text: nextRemark },
  );
  if (!filled) throw new Error('备注输入未生效，请重试。');

  await sleepRandom(180, 320);
  const confirmed = await page.eval<boolean>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, "").trim();
    const wrappers = Array.from(document.querySelectorAll(".dialog-default-v2"))
      .filter((el) => !!el.querySelector(".dialog-geek-remark"));
    if (wrappers.length === 0) return false;
    const wrapper = wrappers[wrappers.length - 1];
    const buttons = Array.from(wrapper.querySelectorAll(".boss-dialog__footer .boss-dialog__button, .boss-btn"));
    const confirmBtn = buttons.find((el) => norm(el.textContent).includes("确认"));
    if (!(confirmBtn instanceof HTMLElement)) return false;
    confirmBtn.click();
    return true;
  `);
  if (!confirmed) throw new Error('已填写备注，但未找到“确认”按钮。');

  await sleepRandom(220, 480);
  recordQuotaUsage('remark', { isWriteAction: true, target: candidateName, detail: nextRemark });
  upsertTrackedCandidate({ name: candidateName, notes: nextRemark, event: 'boss_remark', eventDetail: nextRemark });
  const msg = `已更新 ${candidateName} 备注：${nextRemark}`;
  return opts.json ? JSON.stringify({ executed: true, action: 'remark', candidate: candidateName, remark: nextRemark, message: msg }, null, 2) : msg;
}

async function runIncomingResumeCardAction(
  page: SafariPage,
  opts: ChatActionOptions,
): Promise<string> {
  const candidateName = await ensureInCandidateChat(page, '同意接收附件简历');
  const guard = evaluateWriteGuard({
    action: 'agree_resume',
    actionLabel: '同意接收候选人附件简历',
    target: candidateName,
    confirm: opts.confirm,
    dryRun: opts.dryRun,
    retryHint: 'boss action agree-resume --confirm',
  });
  if (!guard.allowed) {
    return opts.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
  }

  const result = await page.eval<{ kind: 'clicked' | 'already_handled' | 'not_found' }>(`
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const isDisabled = (el) => {
      const cls = el.className ?? "";
      if (/disabled|forbid|ban/i.test(cls) || el.getAttribute("disabled") !== null) return true;
      const st = window.getComputedStyle(el);
      return st.pointerEvents === "none" || Number(st.opacity) < 0.35;
    };
    const items = Array.from(document.querySelectorAll(".chat-message-list .message-item"));
    for (let i = items.length - 1; i >= 0; i--) {
      const friend = items[i].querySelector(".item-friend");
      if (!friend) continue;
      const title = norm(friend.querySelector(".message-card-top-title")?.textContent);
      if (!title || !title.includes("附件简历")) continue;
      const buttons = Array.from(friend.querySelectorAll(".message-card-buttons .card-btn"));
      for (const btn of buttons) {
        const t = norm(btn.textContent);
        if (!(t === "同意" || t.startsWith("同意"))) continue;
        if (isDisabled(btn)) return { kind: "already_handled" };
        if (btn instanceof HTMLElement) {
          btn.scrollIntoView({ block: "center", inline: "nearest" });
          btn.click();
          return { kind: "clicked" };
        }
      }
    }
    return { kind: "not_found" };
  `);

  if (result.kind === 'not_found') {
    throw new Error('未找到待处理的「对方发送附件简历」确认卡片。');
  }
  if (result.kind === 'already_handled') {
    const msg = '对方发来的附件简历请求已处理（同意按钮已禁用）。';
    return opts.json ? JSON.stringify({ executed: false, alreadyHandled: true, message: msg }, null, 2) : msg;
  }

  await sleepRandom(350, 750);
  recordQuotaUsage('agree_resume', { isWriteAction: true, target: candidateName });
  const msg = `已对 ${candidateName} 点击「同意」，接受对方发送的附件简历。`;
  return opts.json ? JSON.stringify({ executed: true, action: 'agree-resume', candidate: candidateName, message: msg }, null, 2) : msg;
}

async function runOnlineResumeInChat(page: SafariPage, opts: ChatActionOptions): Promise<string> {
  const candidateName = await ensureInCandidateChat(page, '在线简历');
  assertQuotaAndInterval('preview', { isWriteAction: false });

  const opened = await page.eval<boolean>(`
    const a = document.querySelector("a.resume-btn-online");
    if (!(a instanceof HTMLElement) || a.classList.contains("disabled")) return false;
    a.scrollIntoView({ block: "center", inline: "nearest" });
    a.click();
    return true;
  `);
  if (!opened) {
    throw new Error('未找到在线简历入口（a.resume-btn-online），或按钮当前不可用。');
  }

  const outcome = await waitForCResumeIframeOrPaywall(page, ONLINE_RESUME_IFRAME_WAIT_MAX_MS);
  if (outcome !== 'iframe') {
    const paywall = await describeBossPaywallPopupIfPresent(page, 'resume');
    await closeBossPaywallPopupIfPresent(page);
    if (paywall) throw new Error(paywall);
    throw new Error('点击在线简历后未检测到 c-resume iframe 出现。');
  }

  const extracted = await extractOnlineResumeFromOpenIframe(page, {
    candidateLabel: candidateName,
    prefix: 'online-resume',
    screenshot: opts.screenshot,
  });

  recordQuotaUsage('preview', { isWriteAction: false, target: candidateName, detail: 'chat-resume' });
  upsertTrackedCandidate({
    name: candidateName,
    source: 'message',
    hasViewed: true,
    resumeTextPath: extracted.textPath,
    onlineResumePath: extracted.onlineResumePath,
    resumeScreenshotPath: extracted.screenshotPath,
    event: 'viewed_resume',
  });

  if (opts.json) {
    return JSON.stringify({ candidate: candidateName, ...extracted }, null, 2);
  }

  const lines: string[] = [`在线简历读取成功（${candidateName}，方式：${extracted.method}）`];
  if (extracted.textPath) lines.push(`简历文本文件：${extracted.textPath}`);
  if (extracted.screenshotPath) lines.push(`简历窗口截图：${extracted.screenshotPath}`);
  if (extracted.screenshotError) lines.push(`截图提示：${extracted.screenshotError}`);
  if (extracted.text) {
    lines.push('', '在线简历正文：', '', extracted.text);
  } else {
    lines.push('', '（DOM 未提取到文本，请直接查看上方截图文件）');
  }
  return lines.join('\n');
}

export async function runChatActionOnCurrentConversation(
  page: SafariPage,
  options: ChatActionOptions,
): Promise<string> {
  switch (options.action) {
    case 'not-fit':
      return markCandidateNotFitWithoutReason(page, options);
    case 'remark':
      return updateCandidateRemark(page, options.remark ?? '', options);
    case 'resume':
      return runOnlineResumeInChat(page, options);
    case 'agree-resume':
      return runIncomingResumeCardAction(page, options);
    case 'request-attachment-resume':
      return runRequestAttachmentResume(page, options);
    case 'exchange-wechat':
      return runExchangeWechat(page, options);
    case 'history':
      return runGetCommunicationHistory(page, { json: options.json });
    default: {
      const _x: never = options.action;
      throw new Error(`未知的 chat action: ${String(_x)}`);
    }
  }
}
