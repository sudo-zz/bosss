import type { SafariPage } from '../browser/index.js';
import { sleepRandom } from '../browser/index.js';
import { C_RESUME_IFRAME_SELECTOR } from './c_resume_capture.js';

const CLOSE_BOSS_MODAL_BODY = `
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) < 0.05) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 20 && rect.height >= 20;
  }

  function tryClickClose(root) {
    const closeBtn =
      root.querySelector(".boss-popup__close, .boss-dialog__close, .drawer-close") ||
      root.querySelector(".dialog-header .close") ||
      root.querySelector(".close-btn") ||
      root.querySelector(".icon-close");
    if (closeBtn instanceof HTMLElement) {
      closeBtn.click();
      return true;
    }
    return false;
  }

  const roots = Array.from(
    document.querySelectorAll(".boss-popup__wrapper, .boss-dialog__wrapper, .dialog-container"),
  );
  for (const root of roots) {
    if (!isVisible(root)) continue;
    if (tryClickClose(root)) return true;
  }

  const resumeIframe = document.querySelector(args.cResumeSel);
  if (resumeIframe instanceof HTMLElement && isVisible(resumeIframe)) {
    let node = resumeIframe.parentElement;
    for (let i = 0; i < 15 && node; i++) {
      if (tryClickClose(node)) return true;
      node = node.parentElement;
    }
  }

  return false;
`;

export async function closeBossModalIfPresent(page: SafariPage): Promise<boolean> {
  const results = await page.evalInAllFrames<boolean>(CLOSE_BOSS_MODAL_BODY, {
    cResumeSel: C_RESUME_IFRAME_SELECTOR,
  });
  if (results.some((r) => r.value === true)) {
    await sleepRandom(220, 450);
    return true;
  }
  return false;
}

export async function waitAndCloseBossModalIfPresent(
  page: SafariPage,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await closeBossModalIfPresent(page)) {
      return true;
    }
    await sleepRandom(160, 260);
  }
  return false;
}
