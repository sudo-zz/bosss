import type { SafariPage } from '../browser/index.js';
import {
  GREET_PAYWALL_WAIT_MAX_MS,
  ONLINE_RESUME_IFRAME_WAIT_MAX_MS,
  sleepRandom,
} from '../browser/index.js';
import { findVisibleCResumeFrame } from './c_resume_capture.js';

const HAS_PAYWALL_BODY = `
  const roots = Array.from(
    document.querySelectorAll(".boss-popup__wrapper, .boss-dialog__wrapper"),
  );
  for (const root of roots) {
    if (!(root instanceof HTMLElement)) continue;
    const st = window.getComputedStyle(root);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) < 0.05) continue;
    const rect = root.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    const hasVipUi = root.querySelector(
      ".block-vip2, .vip2-layout, .payment-layout-v2, .rights-table-vip, .qrcode-v1, .pay-wrap-qrcode-v1, .panel-deadline",
    );
    const text = (root.textContent || "").replace(/\\s+/g, " ");
    const hasPayText =
      /VIP账号|商品需付|直豆|扫码支付|请使用.*支付宝|请使用.*微信|增值服务协议|VIP\\s*\\d+项|限时特惠|直豆抵扣/.test(
        text,
      );
    if (hasVipUi || hasPayText) return true;
  }
  return false;
`;

export async function detectBossPaywallPopup(page: SafariPage): Promise<boolean> {
  return page.eval<boolean>(HAS_PAYWALL_BODY);
}

export async function waitForCResumeIframeOrPaywall(
  page: SafariPage,
  timeoutMs: number = ONLINE_RESUME_IFRAME_WAIT_MAX_MS,
): Promise<'iframe' | 'paywall' | 'neither'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await detectBossPaywallPopup(page)) {
      return 'paywall';
    }
    const found = await findVisibleCResumeFrame(page);
    if (found) {
      return 'iframe';
    }
    await sleepRandom(180, 280);
  }
  return 'neither';
}

export async function waitForBossPaywallPopup(
  page: SafariPage,
  timeoutMs: number = GREET_PAYWALL_WAIT_MAX_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await detectBossPaywallPopup(page)) {
      return true;
    }
    await sleepRandom(180, 280);
  }
  return false;
}

export async function closeBossPaywallPopupIfPresent(page: SafariPage): Promise<boolean> {
  const closed = await page.eval<boolean>(`
    const roots = Array.from(
      document.querySelectorAll(".boss-popup__wrapper, .boss-dialog__wrapper"),
    );
    for (const root of roots) {
      if (!(root instanceof HTMLElement)) continue;
      const st = window.getComputedStyle(root);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) < 0.05) continue;
      const rect = root.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      const hasVipUi = root.querySelector(
        ".block-vip2, .vip2-layout, .payment-layout-v2, .rights-table-vip, .qrcode-v1, .pay-wrap-qrcode-v1, .panel-deadline",
      );
      const text = (root.textContent || "").replace(/\\s+/g, " ");
      const hasPayText =
        /VIP账号|商品需付|直豆|扫码支付|请使用.*支付宝|请使用.*微信|增值服务协议|VIP\\s*\\d+项|限时特惠|直豆抵扣/.test(
          text,
        );
      if (!hasVipUi && !hasPayText) continue;
      const closeBtn = root.querySelector(
        ".boss-popup__close, .boss-dialog__close, .drawer-close, .icon-close",
      );
      if (closeBtn instanceof HTMLElement) {
        closeBtn.click();
        return true;
      }
    }
    return false;
  `);
  if (closed) {
    await sleepRandom(220, 450);
  }
  return closed;
}

export async function describeBossPaywallPopupIfPresent(
  page: SafariPage,
  purpose: 'resume' | 'greet' = 'resume',
): Promise<string | null> {
  const msg = await page.eval<string | null>(`
    const roots = Array.from(
      document.querySelectorAll(".boss-popup__wrapper, .boss-dialog__wrapper"),
    );
    for (const root of roots) {
      if (!(root instanceof HTMLElement)) continue;
      const st = window.getComputedStyle(root);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) < 0.05) continue;
      const rect = root.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      const hasVipUi = root.querySelector(
        ".block-vip2, .vip2-layout, .payment-layout-v2, .rights-table-vip, .qrcode-v1, .pay-wrap-qrcode-v1, .panel-deadline",
      );
      const text = (root.textContent || "").replace(/\\s+/g, " ");
      const hasPayText =
        /VIP账号|商品需付|直豆|扫码支付|请使用.*支付宝|请使用.*微信|增值服务协议|VIP\\s*\\d+项|限时特惠|直豆抵扣/.test(
          text,
        );
      if (!hasVipUi && !hasPayText) continue;
      const h = root.querySelector("h3.title, h4.title, .card-header .title");
      const title = (h?.textContent || "").replace(/\\s+/g, " ").trim();
      if (title) {
        return "页面出现付费弹层（" + title + "），可能需开通 VIP 或购买权益后才能查看在线简历。";
      }
      return "页面出现 VIP/付费购买弹层，可能需开通权益后才能查看在线简历。";
    }
    return null;
  `);
  if (!msg || purpose === 'resume') {
    return msg;
  }
  return msg.replace(/后才能查看在线简历/g, '后才能完成打招呼');
}
