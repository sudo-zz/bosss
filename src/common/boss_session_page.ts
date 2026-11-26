/**
 * Boss B 端「主壳」Safari 会话管理器：
 * - 加本地会话文件锁（防止多命令并发冲突）
 * - 复用用户真实 Safari.app 中已登录的 Boss 直聘标签页
 * - 发现未登录 / 安全验证 / 403 页面时立即中止并交还人工处理
 * - 确认侧栏 `.menu-list` 稳定且未被 SPA 重定向踢出后再执行业务回调
 */
import {
  CONTEXT_DESTROY_RETRY_MS,
  openOrReuseBossTab,
  sleepRandom,
  type SafariPage,
} from '../browser/index.js';
import {
  BOSS_CHAT_INDEX_URL,
  describeManualInterventionUrl,
  isBossChatShellUrl,
  probeLoggedInFromPage,
} from './auth.js';
import { withBossSessionLock } from './boss_session_lock.js';

const MENU_LIST_MOUNT_TIMEOUT_MS = 20_000;

type MenuListSnapshot = {
  exists: boolean;
  signature: string;
};

export type BossSessionPageOptions = {
  ensureChatShell?: boolean;
  ensureMenuList?: boolean;
};

async function readMenuListSnapshot(page: SafariPage): Promise<MenuListSnapshot> {
  return page.eval<MenuListSnapshot>(`
    const root = document.querySelector(".menu-list");
    if (!root) return { exists: false, signature: "" };
    const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
    const links = Array.from(root.querySelectorAll("dl > dt > a"));
    const entries = links.map((a) => {
      const href = a.getAttribute("href") ?? "";
      const labelNode = a.querySelector(".menu-item-content span");
      const label = norm(labelNode?.textContent || a.textContent || "");
      return label + "::" + href;
    });
    return { exists: true, signature: entries.join("|") };
  `);
}

async function assertUrlIsStillBossChatShell(page: SafariPage): Promise<void> {
  const url = await page.url();
  const intervention = describeManualInterventionUrl(url);
  if (intervention) {
    throw new Error(intervention);
  }
  if (!isBossChatShellUrl(url)) {
    const loginProbe = await probeLoggedInFromPage(page).catch(() => ({ loggedIn: false, url }));
    if (!loginProbe.loggedIn) {
      throw new Error(
        `Boss 直聘当前未登录（页面已跳转至 ${url || '首页'}）。请运行 boss login 或在 Safari 窗口完成扫码登录后再试。`,
      );
    }
    throw new Error(`Boss 页面未停留在招聘沟通主壳，当前地址：${url}`);
  }
}

async function ensureBossChatShellUrlBeforeMenuList(page: SafariPage): Promise<void> {
  const currentUrl = await page.url();
  const intervention = describeManualInterventionUrl(currentUrl);
  if (intervention) {
    throw new Error(intervention);
  }
  if (isBossChatShellUrl(currentUrl)) {
    return;
  }
  await page.goto(BOSS_CHAT_INDEX_URL, { timeoutMs: 45_000 });
  await sleepRandom(500, 900);
  await assertUrlIsStillBossChatShell(page);
}

async function ensureMenuListMountedAfterLoad(page: SafariPage): Promise<void> {
  await page.waitFor(
    async () => {
      await assertUrlIsStillBossChatShell(page);
      const ready = await page
        .eval<boolean>(
          `return (document.readyState === "complete" || document.readyState === "interactive") && !!document.querySelector(".menu-list");`,
        )
        .catch(() => false);
      return ready;
    },
    MENU_LIST_MOUNT_TIMEOUT_MS,
    250,
    450,
    '等待 Boss 侧栏 .menu-list 加载（请确认已在 Safari 中登录 Boss 直聘招聘端）',
  );

  // SPA 鉴权接口通常在壳挂载后数百毫秒才返回并触发踢出跳转，短停顿后再次核验 URL
  await sleepRandom(600, 900);
  await assertUrlIsStillBossChatShell(page);

  const snap = await readMenuListSnapshot(page);
  if (!snap.exists || !snap.signature.trim()) {
    throw new Error('当前 Safari 页面未检测到已登录的 Boss 招聘端主界面（.menu-list 为空），请先在 Safari 完成登录。');
  }
}

export async function withBossSessionPage<T>(
  callback: (page: SafariPage) => Promise<T>,
  options: BossSessionPageOptions = {},
): Promise<T> {
  const shouldEnsureChatShell = options.ensureChatShell !== false;
  const shouldEnsureMenuList = options.ensureMenuList !== false;

  return withBossSessionLock(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const page = await openOrReuseBossTab({ targetUrl: BOSS_CHAT_INDEX_URL });

        const currentUrl = await page.url();
        const intervention = describeManualInterventionUrl(currentUrl);
        if (intervention) {
          throw new Error(intervention);
        }

        if (shouldEnsureChatShell) {
          await ensureBossChatShellUrlBeforeMenuList(page);
        }
        if (shouldEnsureMenuList) {
          await ensureMenuListMountedAfterLoad(page);
        }

        return await callback(page);
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /返回空结果|正在跳转|尚未就绪/.test(msg);
        if (attempt === 0 && transient) {
          await sleepRandom(CONTEXT_DESTROY_RETRY_MS.min, CONTEXT_DESTROY_RETRY_MS.max);
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}
