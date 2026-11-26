/**
 * macOS 本地 PDF 文本提取（PDFKit）的 Node 封装。
 *
 * - 源码 `scripts/pdf-text.swift`，首次使用时用 swiftc 编译到 `~/.boss-cli/bin/pdf-text`
 * - 纯本地、无网络，适合导入 51job / BOSS / 邮件附件里的文本型 PDF 简历
 * - 扫描件（无文本层）会返回空文本，调用方需自行降级到 OCR
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { APP_HOME } from '../config.js';

const execFileAsync = promisify(execFile);

const BIN_DIR = join(APP_HOME, 'bin');
const BIN_PATH = join(BIN_DIR, 'pdf-text');
const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_PATH = join(PKG_ROOT, 'scripts', 'pdf-text.swift');

export type PdfTextDoc = {
  file: string;
  pageCount: number;
  pages: Array<{ index: number; text: string }>;
  text: string;
  error?: string | null;
};

let buildPromise: Promise<string> | null = null;

function needsBuild(): boolean {
  if (!existsSync(BIN_PATH)) return true;
  if (!existsSync(SOURCE_PATH)) return false;
  try {
    return statSync(SOURCE_PATH).mtimeMs > statSync(BIN_PATH).mtimeMs;
  } catch {
    return true;
  }
}

async function ensureBinary(): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('PDF 文本提取仅支持 macOS（PDFKit）。');
  }
  if (!needsBuild()) return BIN_PATH;
  if (!buildPromise) {
    buildPromise = (async () => {
      mkdirSync(BIN_DIR, { recursive: true });
      if (!existsSync(SOURCE_PATH)) throw new Error(`PDF 抽取源码缺失：${SOURCE_PATH}`);
      try {
        await execFileAsync('swiftc', ['-O', SOURCE_PATH, '-o', BIN_PATH], { timeout: 180_000 });
      } catch (err) {
        buildPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`编译 PDF 抽取工具失败（需要 Xcode Command Line Tools）：${msg}`);
      }
      return BIN_PATH;
    })();
  }
  return buildPromise;
}

/** 批量提取 PDF 文本；单份失败时该条带 error，不影响其它文件 */
export async function extractPdfText(paths: string[]): Promise<PdfTextDoc[]> {
  if (paths.length === 0) return [];
  const bin = await ensureBinary();
  const { stdout } = await execFileAsync(bin, paths, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    const parsed = JSON.parse(stdout) as PdfTextDoc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`PDF 抽取输出解析失败：${String(stdout).slice(0, 200)}`);
  }
}
