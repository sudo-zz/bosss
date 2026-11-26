import { basename, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ensureAppDataLayout, RESUME_OCR_DIR } from '../config.js';
import { baiduOcrImageBase64, isBaiduOcrConfigured } from './baidu_ocr.js';

/**
 * 是否对在线简历截图调用百度 OCR。
 *
 * 优化：默认关闭（Safari 驱动优先直接提取同源 DOM 简历文本，或输出截图路径供多模态 Agent 直接看图）。
 * 仅当显式设置 `BOSS_RESUME_OCR=1` / `true` 时启用百度 OCR。
 */
export function isResumeOcrEnabled(): boolean {
  const v = process.env.BOSS_RESUME_OCR?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

let ocrChain: Promise<unknown> = Promise.resolve();

/**
 * 对简历 PNG 调用百度 OCR，并将结果写入 `~/.boss-cli/.cache/ocr/`（与截图同名 `.txt`）。
 */
export async function ocrResumePngToTextFile(
  pngAbsPath: string,
): Promise<{ textPath: string; text: string }> {
  ensureAppDataLayout();
  if (!isBaiduOcrConfigured()) {
    throw new Error(
      '已显式开启百度简历 OCR（BOSS_RESUME_OCR=1），但未配置百度密钥：请设置 BOSS_BAIDU_API_KEY 与 BOSS_BAIDU_SECRET_KEY。',
    );
  }

  const base = basename(pngAbsPath).replace(/\.png$/i, '.txt');
  const textPath = join(RESUME_OCR_DIR, base);

  const run = async (): Promise<{ textPath: string; text: string }> => {
    const buf = await readFile(pngAbsPath);
    const text = await baiduOcrImageBase64(buf.toString('base64'));
    await writeFile(textPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    return { textPath, text };
  };

  const p = ocrChain.then(run);
  ocrChain = p.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[boss-cli] resume OCR chain reset after failure:', msg);
  });
  return p;
}
