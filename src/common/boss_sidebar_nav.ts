import type { SafariPage } from '../browser/index.js';
import { SIDEBAR_NAV_AFTER_CLICK_MS, sleepRandom } from '../browser/index.js';
import { describeManualInterventionUrl, isBossChatShellUrl } from './auth.js';

const SIDEBAR_NAV_WAIT_MS = 15_000;

/**
 * 点击 Boss 左侧 `.menu-list` 中的菜单项，并等待导航到给定 pathname（如 `/web/chat/job/list`）。
 */
export async function clickBossSidebarMenuToPath(
  page: SafariPage,
  menuLabel: string,
  targetPath: string,
): Promise<void> {
  const clicked = await page.eval<boolean>(
    `
    const norm = (v) => (v ?? "").replace(/\\s+/g, "");
    const links = Array.from(document.querySelectorAll(".menu-list a"));
    const target = links.find((a) => {
      const href = a.getAttribute("href") ?? "";
      if (href.includes(args.path)) return true;
      const text = norm(a.querySelector(".menu-item-content span")?.textContent ?? a.textContent);
      return text.includes(args.label);
    });
    if (!(target instanceof HTMLElement)) return false;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
    return true;
    `,
    { label: menuLabel, path: targetPath },
  );

  if (!clicked) {
    throw new Error(`未找到侧边栏菜单“${menuLabel}”，无法跳转到 ${targetPath}。`);
  }

  await sleepRandom(SIDEBAR_NAV_AFTER_CLICK_MS.min, SIDEBAR_NAV_AFTER_CLICK_MS.max);

  await page.waitFor(
    async () => {
      const url = await page.url();
      const intervention = describeManualInterventionUrl(url);
      if (intervention) {
        throw new Error(intervention);
      }
      if (!isBossChatShellUrl(url)) {
        throw new Error(`页面已离开招聘主壳（跳转至 ${url}），请确认 Safari 中 Boss 直聘仍处于登录状态。`);
      }
      const p = await page.eval<string>(
        `return window.location.pathname.replace(/\\/+$/, "") || "/";`,
      );
      return p === targetPath;
    },
    SIDEBAR_NAV_WAIT_MS,
    200,
    380,
    `跳转到 ${targetPath}`,
  );
}
