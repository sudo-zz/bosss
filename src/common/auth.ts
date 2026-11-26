/**
 * Boss 直聘 URL 约定与登录/安全校验状态探测（SafariPage 版本）。
 */
import type { SafariPage } from '../browser/index.js';
import { PROBE_LOGIN_POLL_MS, sleepRandom } from '../browser/index.js';

export const BOSS_ZHIPIN_HOME = 'https://www.zhipin.com/';
export const BOSS_CHAT_INDEX_URL = 'https://www.zhipin.com/web/chat/index';
export const BOSS_LOGIN_URL = 'https://www.zhipin.com/web/user/?ka=header-login';

export function isBossZhipinSiteUrl(url: string): boolean {
  if (!url || url === 'about:blank') return false;
  try {
    return new URL(url).hostname.includes('zhipin.com');
  } catch {
    return false;
  }
}

export function isBossChatIndexUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/web/chat/index';
  } catch {
    return false;
  }
}

export function isBossChatShellUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p === '/web/chat' || p.startsWith('/web/chat/');
  } catch {
    return false;
  }
}

export function isWebUserLoginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    return u.pathname.includes('/web/user/');
  } catch {
    return false;
  }
}

/**
 * 识别 Boss 登录页、安全校验页或封禁提示页。
 * 命中后立即中止并交还人工在 Safari 中处理，不做任何绕过。
 */
export function describeManualInterventionUrl(url: string): string | null {
  if (!url) return null;
  if (/\/web\/user\/safe\/verify|\/web\/passport\/.*(?:verify|security)/i.test(url)) {
    return `Boss 页面当前处于安全验证页（${url}）。请在 Safari 窗口中手动完成验证后，再重新执行命令。`;
  }
  if (/\/web\/common\/403\.html|\/web\/passport\/.*403\.html/i.test(url)) {
    return `Boss 页面提示访问受限/403（${url}）。请暂停自动化操作并在 Safari 中确认账号状态。`;
  }
  if (isWebUserLoginUrl(url)) {
    return `Boss 当前未登录（${url}）。请在 Safari 窗口中完成登录（或先运行 boss login）后再重试。`;
  }
  return null;
}

export type ProbeLoggedInSignals = {
  hasNickname: boolean;
  navLoginCta: boolean;
  hasLogoutHint: boolean;
};

export async function probeLoggedInFromPage(
  page: SafariPage,
): Promise<{ loggedIn: boolean; url: string }> {
  const url = await page.url();
  if (!url || url === 'about:blank' || isWebUserLoginUrl(url)) {
    return { loggedIn: false, url: url || '' };
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    const s = await page.eval<ProbeLoggedInSignals>(`
      function isNick(t) {
        const str = (t || "").replace(/\\s+/g, " ").trim();
        if (str.length < 2 || str.length > 64) return false;
        return !/^(我要登录|登录|注册|登录\\/注册)$/u.test(str);
      }
      const nickSelectors = [
        ".user-name", "span.user-name", "[class*='user-name']",
        ".label-name", ".nav-user .name", ".nav-user-name", "a.nav-user"
      ];
      let hasNickname = false;
      for (const sel of nickSelectors) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          if (isNick(el.textContent || "")) { hasNickname = true; break; }
        }
        if (hasNickname) break;
      }
      const navText = Array.from(document.querySelectorAll("header, .nav-header, .nav-wrap, .top-header, #header, .header-nav"))
        .map((e) => e.innerText || "")
        .join(" ");
      const navLoginCta = /我要登录|登录\\/注册/.test(navText);
      const bodyText = document.body ? document.body.innerText || "" : "";
      const hasLogoutHint =
        /\\b退出登录\\b/u.test(bodyText) ||
        !!document.querySelector("a[href*='logout'], a[href*='signout']");
      return { hasNickname, navLoginCta, hasLogoutHint };
    `);
    if (s.hasNickname || s.hasLogoutHint) {
      return { loggedIn: true, url };
    }
    if (s.navLoginCta) {
      return { loggedIn: false, url };
    }
    if (attempt < 14) {
      await sleepRandom(PROBE_LOGIN_POLL_MS.min, PROBE_LOGIN_POLL_MS.max);
    }
  }
  return { loggedIn: false, url };
}
