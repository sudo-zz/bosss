/**
 * 在线简历（c-resume iframe）读取与截图模块（Safari 版）。
 *
 * 优化：
 * 1. 优先直接提取同源 c-resume iframe 的结构化 DOM 文本并保存到 `~/.boss-cli/.cache/resumes/*.txt`
 *    —— 零 OCR 成本、零密钥依赖、速度极快。
 * 2. 若简历以 Canvas/图片方式渲染导致 DOM 文本不足，或调用方显式传 `--screenshot`，
 *    自动截取 Safari 窗口 PNG 保存到 `~/.boss-cli/.cache/resume-screenshots/`，
 *    交由多模态 Agent 直接看图评估（或仅在 `BOSS_RESUME_OCR=1` 时走百度 OCR）。
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FrameMeta, SafariPage } from '../browser/index.js';
import { sleepRandom } from '../browser/index.js';
import {
  ensureAppDataLayout,
  RESUME_ONLINE_DIR,
  RESUME_SCREENSHOTS_DIR,
  RESUME_TEXT_DIR,
} from '../config.js';
import { isResumeOcrEnabled, ocrResumePngToTextFile } from '../ocr/index.js';

export const C_RESUME_IFRAME_SELECTOR =
  'iframe[src*="c-resume"], iframe[src*="frame/c-resume"]' as const;

export type ExtractedResumeResult = {
  method: 'dom_text' | 'screenshot' | 'dom_and_screenshot' | 'ocr';
  text: string;
  textPath?: string;
  onlineResumePath?: string;
  screenshotPath?: string;
  screenshotError?: string;
  hasCanvas: boolean;
  frameUrl: string;
};

export function safeResumeScreenshotFileBase(name: string): string {
  const t = name.replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 64);
  return t.length > 0 ? t : 'candidate';
}

export async function findVisibleCResumeFrame(page: SafariPage): Promise<FrameMeta | null> {
  const frames = await page.listFrames();
  for (const f of frames) {
    if (!f.visible) continue;
    if (f.src.includes('c-resume') || f.url.includes('c-resume')) {
      return f;
    }
  }
  return null;
}

export async function waitForVisibleCResumeIframeReady(
  page: SafariPage,
  timeoutMs = 8_000,
): Promise<FrameMeta | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = await findVisibleCResumeFrame(page);
    if (frame) {
      const ready = await page
        .evalInFrame<boolean>(
          frame.target,
          `
          const okState = document.readyState === "complete" || document.readyState === "interactive";
          const h = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
          const textLen = (document.body?.innerText || "").trim().length;
          const hasCanvas = document.querySelectorAll("canvas").length > 0;
          return okState && (h > 100 || textLen > 40 || hasCanvas);
          `,
        )
        .catch(() => false);
      if (ready) {
        await sleepRandom(400, 750);
        return frame;
      }
    }
    await sleepRandom(160, 260);
  }
  return null;
}

const CLOSE_C_RESUME_BODY = `
  function hasCResumeIframe(root) {
    return Array.from(root.querySelectorAll("iframe")).some((iframe) => {
      const src = iframe.getAttribute("src") || "";
      return src.includes("c-resume") || src.includes("frame/c-resume");
    });
  }
  const closeSelectors = ".close-btn, .boss-popup__close, .boss-dialog__close, .drawer-close, .icon-close, .btn-quxiao";
  const wraps = Array.from(document.querySelectorAll(".dialog-lib-resume, .boss-popup__wrapper, .boss-dialog__wrapper, .dialog-container"));
  for (const w of wraps) {
    if (hasCResumeIframe(w)) {
      const c = w.querySelector(closeSelectors);
      if (c instanceof HTMLElement) { c.click(); return true; }
    }
  }
  const iframe = document.querySelector(args.sel);
  let node = iframe ? iframe.parentElement : null;
  for (let i = 0; i < 12 && node; i++) {
    const c = node.querySelector(closeSelectors);
    if (c instanceof HTMLElement) { c.click(); return true; }
    node = node.parentElement;
  }
  return false;
`;

export async function closeCResumePanel(page: SafariPage): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const res = await page.evalInAllFrames<boolean>(CLOSE_C_RESUME_BODY, {
      sel: C_RESUME_IFRAME_SELECTOR,
    });
    if (!res.some((r) => r.value === true)) {
      break;
    }
    await sleepRandom(200, 400);
  }
}

/**
 * 读取已打开的在线简历（DOM 文本优先 + 按需窗口截图），完成后自动关闭弹层。
 */
export async function extractOnlineResumeFromOpenIframe(
  page: SafariPage,
  opts: { candidateLabel: string; prefix: 'preview' | 'online-resume'; screenshot?: boolean },
): Promise<ExtractedResumeResult> {
  ensureAppDataLayout();
  const frame = await waitForVisibleCResumeIframeReady(page);
  if (!frame) {
    await closeCResumePanel(page);
    throw new Error('在线简历 iframe 已出现，但内容未在预期时间内渲染完成。');
  }

  const scraped = await page.evalInFrame<{ text: string; hasCanvas: boolean }>(
    frame.target,
    `
    const hasCanvas = document.querySelectorAll("canvas").length > 0;
    const raw = (document.body?.innerText || "")
      .replace(/\\r\\n/g, "\\n")
      .split("\\n")
      .map((line) => line.replace(/[ \\t]+/g, " ").trim())
      .filter(Boolean)
      .join("\\n");
    return { text: raw, hasCanvas };
    `,
  );

  const ts = Date.now();
  const base = `${opts.prefix}-${safeResumeScreenshotFileBase(opts.candidateLabel)}-${ts}`;
  let text = scraped.text.trim();
  let textPath: string | undefined;

  if (text.length > 0) {
    textPath = join(RESUME_TEXT_DIR, `${base}.txt`);
    await writeFile(textPath, `${text}\n`, 'utf8');
  }

  const needScreenshot =
    opts.screenshot === true || text.length < 60 || scraped.hasCanvas || isResumeOcrEnabled();

  let screenshotPath: string | undefined;
  let screenshotError: string | undefined;
  let method: ExtractedResumeResult['method'] = 'dom_text';

  if (needScreenshot) {
    const absPng = join(RESUME_SCREENSHOTS_DIR, `${base}.png`);
    const shot = await page.captureWindowScreenshot(absPng);
    if (shot.ok) {
      screenshotPath = absPng;
      method = text.length >= 60 ? 'dom_and_screenshot' : 'screenshot';

      if (isResumeOcrEnabled() && text.length < 60) {
        const ocr = await ocrResumePngToTextFile(absPng);
        text = ocr.text;
        textPath = ocr.textPath;
        method = 'ocr';
      }
    } else {
      screenshotError = shot.error;
    }
  }

  await sleepRandom(500, 900);
  await closeCResumePanel(page);

  // 转存结构化在线简历到本地持久化目录 ~/.boss-cli/resumes/online/，供工作台离线随时点开查看
  const safeName = safeResumeScreenshotFileBase(opts.candidateLabel);
  const onlineResumePath = join(RESUME_ONLINE_DIR, `${safeName}.json`);
  const structuredPayload = {
    candidate: opts.candidateLabel,
    capturedAt: new Date().toISOString(),
    source: opts.prefix,
    method,
    text,
    textPath: textPath ?? null,
    screenshotPath: screenshotPath ?? null,
    hasCanvas: scraped.hasCanvas,
    frameUrl: frame.url || frame.src,
  };
  await writeFile(onlineResumePath, `${JSON.stringify(structuredPayload, null, 2)}\n`, 'utf8');
  if (text.length > 0) {
    await writeFile(
      join(RESUME_ONLINE_DIR, `${safeName}.md`),
      `# ${opts.candidateLabel} · Boss 在线简历\n\n- 抓取时间：${structuredPayload.capturedAt}\n- 读取方式：${method}\n\n---\n\n${text}\n`,
      'utf8',
    );
  }

  return {
    method,
    text,
    textPath,
    onlineResumePath,
    screenshotPath,
    screenshotError,
    hasCanvas: scraped.hasCanvas,
    frameUrl: frame.url || frame.src,
  };
}
