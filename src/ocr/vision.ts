/**
 * macOS 本地 OCR 工具（Vision framework）的 Node 封装。
 *
 * - 源码 `scripts/vision-ocr.swift`，首次使用时用 swiftc 编译到 `~/.boss-cli/bin/vision-ocr`
 * - 源码更新后自动重新编译
 * - 纯本地、无网络、无密钥，中文识别质量足以还原 BOSS 在线简历正文
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { APP_HOME } from '../config.js';

const execFileAsync = promisify(execFile);

const BIN_DIR = join(APP_HOME, 'bin');
const BIN_PATH = join(BIN_DIR, 'vision-ocr');
const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_PATH = join(PKG_ROOT, 'scripts', 'vision-ocr.swift');

export type OcrLine = {
  text: string;
  /** 归一化左边距 0~1 */
  x: number;
  /** 归一化顶部距离 0~1 */
  y: number;
  w: number;
  h: number;
  conf: number;
};

export type OcrPage = {
  file: string;
  width: number;
  height: number;
  lines: OcrLine[];
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
    throw new Error('本地 OCR 仅支持 macOS（Vision framework）。');
  }
  if (!needsBuild()) return BIN_PATH;
  if (!buildPromise) {
    buildPromise = (async () => {
      mkdirSync(BIN_DIR, { recursive: true });
      if (!existsSync(SOURCE_PATH)) {
        throw new Error(`OCR 源码缺失：${SOURCE_PATH}`);
      }
      try {
        await execFileAsync('swiftc', ['-O', SOURCE_PATH, '-o', BIN_PATH], { timeout: 180_000 });
      } catch (err) {
        buildPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `编译本地 OCR 失败（需要 Xcode Command Line Tools，可执行 xcode-select --install）：${msg}`,
        );
      }
      return BIN_PATH;
    })();
  }
  return buildPromise;
}

/** 对若干张图片做本地 OCR，返回按阅读顺序排好的行坐标。 */
export async function ocrImages(paths: string[]): Promise<OcrPage[]> {
  if (paths.length === 0) return [];
  const bin = await ensureBinary();
  const { stdout } = await execFileAsync(bin, paths, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  try {
    const parsed = JSON.parse(stdout) as OcrPage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`本地 OCR 输出解析失败：${String(stdout).slice(0, 200)}`);
  }
}

export function isLocalOcrAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SOURCE_PATH);
}
