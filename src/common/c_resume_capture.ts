/**
 * 在线简历（c-resume iframe）读取与截图模块（Safari 版）。
 *
 * 采集策略（优先级从高到低）：
 * 1. 同源 iframe 的 DOM 文本 —— 零成本、内容最全（DOM 版在线简历）。
 * 2. Canvas 版在线简历：真实键盘 PageDown 逐屏滚动 + 窗口截图，交给本地 Vision OCR 还原文字。
 * 3. OCR 结果按行坐标结构化成「姓名 / 期望 / 个人优势 / 工作经历 / 项目 / 教育 / 技能」，
 *    工作台用自有模板渲染，不再依赖模糊截图。
 */
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FrameMeta, SafariPage } from '../browser/index.js';
import { sleepRandom } from '../browser/index.js';
import {
  ensureAppDataLayout,
  RESUME_ONLINE_DIR,
  RESUME_SCREENSHOTS_DIR,
  RESUME_TEXT_DIR,
} from '../config.js';
import { cropImageInPlace, readImageSize } from '../media/crop_image.js';
import { isResumeOcrEnabled, ocrResumePngToTextFile } from '../ocr/index.js';
import { ocrImages, type OcrLine } from '../ocr/vision.js';
import {
  hasStructuredContent,
  parseResumeOcrLines,
  parseResumeText,
  structuredToPlainText,
  type OnlineResumeStructured,
} from '../resume/parse_online_resume.js';

export const C_RESUME_IFRAME_SELECTOR =
  'iframe[src*="c-resume"], iframe[src*="frame/c-resume"]' as const;

/** 最多采集多少屏（防止超长简历把时间拖长） */
const MAX_SCREENS = 8;
/** PageDown 键码 */
const KEY_PAGE_DOWN = 121;

export type ExtractedResumeResult = {
  method: 'dom_text' | 'screenshot' | 'dom_and_screenshot' | 'ocr';
  text: string;
  textPath?: string;
  onlineResumePath?: string;
  screenshotPath?: string;
  screenshotPaths?: string[];
  screenshotError?: string;
  hasCanvas: boolean;
  frameUrl: string;
  structured?: OnlineResumeStructured;
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
 * 长简历滚到底后，画布可能只有轻微变化（阴影/滚动条），截图 hash 不同但内容重复。
 * 这里按行文本重合度判断：某屏 80% 以上的行已出现过，就从该屏起截断。
 */
function trimRepeatedScreens(pages: OcrLine[][]): OcrLine[][] {
  const key = (t: string) => t.replace(/[\s·•.,，。、|｜:：;；()（）\[\]【】]/g, '').toLowerCase();
  const kept: OcrLine[][] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const keys = page.map((l) => key(l.text)).filter((k) => k.length > 1);
    if (keys.length === 0) continue;
    const dup = keys.filter((k) => seen.has(k)).length;
    if (kept.length > 0 && dup / keys.length > 0.8) break;
    for (const k of keys) seen.add(k);
    kept.push(page);
  }
  return kept.length > 0 ? kept : pages;
}

async function fileHash(path: string): Promise<string> {
  try {
    const buf = await readFile(path);
    return createHash('md5').update(buf).digest('hex');
  } catch {
    return '';
  }
}

/** 把 OCR 行按屏顺序还原成可读文本 */
function ocrLinesToText(pages: OcrLine[][]): string {
  return pages
    .map((lines) => lines.map((l) => l.text.trim()).filter(Boolean).join('\n'))
    .join('\n');
}

/**
 * Canvas 简历：真实键盘滚动 + 逐屏截图，直到画面不再变化。
 */
async function captureScrollingScreens(
  page: SafariPage,
  base: string,
  frame: FrameMeta,
): Promise<{ files: string[]; error?: string }> {
  const files: string[] = [];
  let prevHash = '';
  let lastError: string | undefined;

  // Canvas 渲染器要等首屏绘制完才响应键盘；先等一拍，再让画布拿到焦点
  await sleepRandom(1400, 1900);
  for (let attempt = 0; attempt < 3; attempt++) {
    const active = await page
      .evalInFrame<string>(
        frame.target,
        `
        const el = document.querySelector("canvas") || document.scrollingElement || document.body;
        try {
          el.tabIndex = 0;
          el.focus({ preventScroll: true });
        } catch (e) {}
        return document.activeElement ? document.activeElement.tagName : "";
        `,
      )
      .catch(() => '');
    if (active === 'CANVAS') break;
    await sleepRandom(500, 800);
  }

  // 记录 iframe 在页面里的位置，用于把整窗截图裁成纯简历区域
  const geo = await page
    .eval<{ x: number; y: number; w: number; h: number; vw: number; vh: number } | null>(
      `
      const ifr = document.querySelector('iframe[src*="c-resume"]');
      if (!ifr) return null;
      const r = ifr.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
      `,
    )
    .catch(() => null);

  // 打开弹层时简历默认在顶部，直接用 PageDown 逐屏下翻（Home 键会干扰部分渲染器，不使用）
  await sleepRandom(400, 700);

  for (let i = 0; i < MAX_SCREENS; i++) {
    const abs = join(RESUME_SCREENSHOTS_DIR, `${base}-p${i + 1}.png`);
    const shot = await page.captureWindowScreenshot(abs);
    if (!shot.ok) {
      lastError = shot.error;
      break;
    }

    // 裁剪到简历 iframe 区域：截图更干净，OCR 也不受左右侧栏干扰
    if (geo && geo.vw > 0 && geo.w > 50 && geo.h > 50) {
      const size = await readImageSize(abs);
      if (size) {
        const ratio = size.width / geo.vw;
        const topOffset = size.height - geo.vh * ratio;
        const cropY = topOffset + geo.y * ratio;
        if (topOffset >= 0 && topOffset < size.height * 0.35) {
          await cropImageInPlace(abs, {
            x: geo.x * ratio,
            y: cropY,
            width: geo.w * ratio,
            height: Math.min(geo.h * ratio, size.height - cropY),
          });
        }
      }
    }

    const hash = await fileHash(abs);
    if (hash && hash === prevHash) {
      // 滚不动了（已到底或内容不可滚动）
      await unlink(abs).catch(() => undefined);
      break;
    }
    files.push(abs);
    prevHash = hash;
    if (i === MAX_SCREENS - 1) break;
    await page.pressKey(KEY_PAGE_DOWN);
    await sleepRandom(700, 1000);
  }
  return { files, error: lastError };
}

/**
 * 读取已打开的在线简历（DOM 文本优先，Canvas 走滚动截图 + 本地 OCR），完成后自动关闭弹层。
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

  const hasDomText = text.length >= 80;
  let screenshotPath: string | undefined;
  let screenshotPaths: string[] | undefined;
  let screenshotError: string | undefined;
  let method: ExtractedResumeResult['method'] = hasDomText ? 'dom_text' : 'screenshot';
  let structured: OnlineResumeStructured | undefined;

  if (hasDomText) {
    structured = parseResumeText(text);
    if (opts.screenshot === true) {
      const absPng = join(RESUME_SCREENSHOTS_DIR, `${base}.png`);
      const shot = await page.captureWindowScreenshot(absPng);
      if (shot.ok) {
        screenshotPath = absPng;
        method = 'dom_and_screenshot';
      }
    }
  } else {
    // Canvas / 图片型简历：滚动逐屏截图 + 本地 OCR
    const shots = await captureScrollingScreens(page, base, frame);
    screenshotPaths = shots.files;
    screenshotError = shots.error;
    screenshotPath = shots.files[0];

    if (shots.files.length > 0) {
      try {
        const pages = await ocrImages(shots.files);
        const ocrPages = trimRepeatedScreens(pages.map((p) => p.lines));
        const rawText = ocrLinesToText(ocrPages);
        structured = parseResumeOcrLines(ocrPages, { candidateName: opts.candidateLabel });
        // 原始 OCR 行有跨屏重复，落盘时改用结构化还原后的干净文本
        text = hasStructuredContent(structured) ? structuredToPlainText(structured) : rawText;
        if (text.trim().length > 0) {
          textPath = join(RESUME_TEXT_DIR, `${base}.txt`);
          await writeFile(textPath, `${text}\n`, 'utf8');
          method = 'ocr';
        }
      } catch {
        // 本地 OCR 不可用时回落到百度 OCR（需配置）
        if (isResumeOcrEnabled() && shots.files[0]) {
          try {
            const ocr = await ocrResumePngToTextFile(shots.files[0]);
            text = ocr.text;
            textPath = ocr.textPath;
            method = 'ocr';
            structured = parseResumeText(text);
          } catch {
            // 忽略，保留截图
          }
        }
      }
    }
  }

  await sleepRandom(400, 700);
  await closeCResumePanel(page);

  // 转存结构化在线简历到 ~/.boss-cli/resumes/online/，供工作台离线查看
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
    screenshotPaths: screenshotPaths ?? null,
    hasCanvas: scraped.hasCanvas,
    frameUrl: frame.url || frame.src,
    structured: hasStructuredContent(structured) ? structured : null,
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
    screenshotPaths,
    screenshotError,
    hasCanvas: scraped.hasCanvas,
    frameUrl: frame.url || frame.src,
    structured,
  };
}
