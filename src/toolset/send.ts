import { SEND_AFTER_ENTER_MS, sleepRandom } from '../browser/index.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { evaluateWriteGuard, recordQuotaUsage } from '../common/safety.js';
import { upsertTrackedCandidate } from '../common/tracker.js';
import { runRequestAttachmentResume } from './action.js';
import { runOpenCandidateChat } from './chat.js';

export type SendChatMessageOptions = {
  text?: string;
  to?: string;
  exact?: boolean;
  requestResume?: boolean;
  confirm?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

function matchesTargetName(actual: string, expected: string, exact: boolean): boolean {
  const a = actual.replace(/\s+/g, ' ').trim();
  const e = expected.replace(/\s+/g, ' ').trim();
  if (!e) return true;
  return exact ? a === e : a.includes(e);
}

export async function runSendChatMessage(options: SendChatMessageOptions): Promise<string> {
  const messageText = (options.text ?? '').trim();
  const toName = (options.to ?? '').trim();
  const exact = options.exact === true;
  const requestResume = options.requestResume === true;

  if (!messageText) {
    throw new Error('请指定 --text <消息> 或 -t <消息>。');
  }

  return withBossSessionPage(async (page) => {
    const currentUrl = await page.url();
    if (!isBossChatIndexUrl(currentUrl)) {
      throw new Error('请先进入聊天列表页（/web/chat/index）并打开候选人聊天。');
    }

    const readContext = () =>
      page.eval<{ hasEditor: boolean; candidateName: string }>(`
        const editor = document.querySelector("#boss-chat-editor-input");
        const name = (document.querySelector(".base-info-single-container .name-box")?.textContent ?? "")
          .replace(/\\s+/g, " ")
          .trim();
        return { hasEditor: !!editor, candidateName: name || "当前会话候选人" };
      `);

    let context = await readContext();
    if (!toName && !context.hasEditor) {
      throw new Error('未找到聊天输入框（#boss-chat-editor-input），请先打开候选人会话或指定 --to <姓名>。');
    }

    const targetLabel = toName || context.candidateName;
    const retryParts = [
      toName ? `--to ${JSON.stringify(toName)}` : '',
      exact ? '--strict' : '',
      `-t ${JSON.stringify(messageText)}`,
      requestResume ? '--request-resume' : '',
      '--confirm',
    ].filter(Boolean);

    const guard = evaluateWriteGuard({
      action: 'send',
      actionLabel: requestResume ? '发送聊天消息并求简历' : '发送聊天消息',
      target: targetLabel,
      detail: messageText,
      confirm: options.confirm,
      dryRun: options.dryRun,
      retryHint: `boss send ${retryParts.join(' ')}`,
    });
    if (!guard.allowed) {
      return options.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
    }

    if (toName && !matchesTargetName(context.candidateName, toName, exact)) {
      await runOpenCandidateChat(page, toName, exact, { json: false });
      context = await readContext();
      if (!matchesTargetName(context.candidateName, toName, exact)) {
        throw new Error(`尝试切换会话失败：当前窗口候选人为「${context.candidateName}」，不匹配 --to「${toName}」。`);
      }
    }

    if (!context.hasEditor) {
      throw new Error(`未找到聊天输入框（#boss-chat-editor-input），当前候选人：${context.candidateName}`);
    }

    const filled = await page.eval<boolean>(
      `
      const el = document.querySelector("#boss-chat-editor-input");
      if (!(el instanceof HTMLElement)) return false;
      el.focus();
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc?.set) desc.set.call(el, args.text);
        else el.value = args.text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: args.text }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", keyCode: 65, which: 65, bubbles: true }));
        return true;
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      let ok = false;
      try {
        ok = document.execCommand("insertText", false, args.text);
      } catch {}
      if (!ok) {
        el.innerText = args.text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: args.text }));
      // Boss Vue 2 conversation-editor recalculates \`this.disabled\` inside handleKeyup for non-arrow keys
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", keyCode: 65, which: 65, bubbles: true }));
      return true;
      `,
      { text: messageText },
    );

    if (!filled) {
      throw new Error('无法向聊天输入框写入消息内容。');
    }

    await page
      .waitFor(
        async () =>
          page.eval<boolean>(`
            return Boolean(
              document.querySelector(".conversation-editor .submit-content .submit.active") ||
              document.querySelector(".chat-op .btn-send:not(.disabled)") ||
              document.querySelector("button.btn-send:not(.disabled)")
            );
          `),
        2_500,
        120,
        240,
        '发送按钮激活',
      )
      .catch(() => false);

    await sleepRandom(260, 520);

    const sent = await page.eval<{ method: string; ok: boolean }>(`
      const sendBtn =
        document.querySelector(".conversation-editor .submit-content .submit.active") ||
        document.querySelector(".conversation-editor .submit-content .submit") ||
        document.querySelector(".submit-content .submit") ||
        document.querySelector(".chat-op .btn-send:not(.disabled)") ||
        document.querySelector("button.btn-send:not(.disabled)") ||
        document.querySelector(".submit-content .btn-send") ||
        Array.from(document.querySelectorAll("button, .btn, .submit")).find((b) =>
          (b.textContent ?? "").replace(/\\s+/g, "") === "发送",
        );
      if (sendBtn instanceof HTMLElement) {
        sendBtn.click();
        return { method: "button", ok: true };
      }
      const el = document.querySelector("#boss-chat-editor-input");
      if (!(el instanceof HTMLElement)) return { method: "none", ok: false };
      el.focus();
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
      return { method: "enter", ok: true };
    `);

    if (!sent.ok) {
      throw new Error('未能定位发送按钮或触发发送事件。');
    }

    const cleared = await page
      .waitFor(
        async () =>
          page.eval<boolean>(`
            const el = document.querySelector("#boss-chat-editor-input");
            if (!el) return false;
            const remain = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.innerText) || "";
            return remain.replace(/\\s+/g, "") === "";
          `),
        4_500,
        150,
        280,
        '确认输入框清空（消息已提交发送）',
      )
      .then(() => true)
      .catch(() => false);

    if (!cleared) {
      throw new Error(
        `已点击发送（${sent.method}），但聊天输入框未清空，请检查 Safari 页面「发送」按钮状态或是否出现提示限制。`,
      );
    }

    await sleepRandom(SEND_AFTER_ENTER_MS.min, SEND_AFTER_ENTER_MS.max);
    recordQuotaUsage('send', {
      isWriteAction: true,
      target: context.candidateName,
      detail: messageText.slice(0, 80),
    });
    upsertTrackedCandidate({
      name: context.candidateName,
      stage: 'greeted',
      event: 'boss_sent_message',
    });

    let resumeResult = '';
    if (requestResume) {
      await sleepRandom(1200, 2400);
      resumeResult = await runRequestAttachmentResume(page, { skipGuard: true });
    }

    if (options.json) {
      return JSON.stringify(
        {
          executed: true,
          candidate: context.candidateName,
          text: messageText,
          method: sent.method,
          editorCleared: true,
          requestResumeResult: resumeResult || null,
        },
        null,
        2,
      );
    }

    return resumeResult
      ? `已向 ${context.candidateName} 发送消息：${messageText}\n${resumeResult}`
      : `已向 ${context.candidateName} 发送消息：${messageText}`;
  });
}
