/**
 * 图片裁剪工具（macOS CoreGraphics）的 Node 封装。
 *
 * 用于把 Safari 整窗截图裁成「纯在线简历区域」，既让截图视图干净，
 * 也让 OCR 少受左侧导航与右侧聊天面板干扰。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { APP_HOME } from '../config.js';

const execFileAsync = promisify(execFile);

const BIN_DIR = join(APP_HOME, 'bin');
const BIN_PATH = join(BIN_DIR, 'image-crop');
const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_PATH = join(PKG_ROOT, 'scripts', 'image-crop.swift');

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
  if (process.platform !== 'darwin') throw new Error('图片裁剪仅支持 macOS。');
  if (!needsBuild()) return BIN_PATH;
  if (!buildPromise) {
    buildPromise = (async () => {
      mkdirSync(BIN_DIR, { recursive: true });
      if (!existsSync(SOURCE_PATH)) throw new Error(`裁剪工具源码缺失：${SOURCE_PATH}`);
      try {
        await execFileAsync('swiftc', ['-O', SOURCE_PATH, '-o', BIN_PATH], { timeout: 180_000 });
      } catch (err) {
        buildPromise = null;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`编译图片裁剪工具失败：${msg}`);
      }
      return BIN_PATH;
    })();
  }
  return buildPromise;
}

export type ImageSize = { width: number; height: number };

/** 读取 PNG 像素尺寸（sips，macOS 自带） */
export async function readImageSize(absPath: string): Promise<ImageSize | null> {
  try {
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', absPath], {
      timeout: 10_000,
    });
    const w = /pixelWidth:\s*(\d+)/.exec(stdout)?.[1];
    const h = /pixelHeight:\s*(\d+)/.exec(stdout)?.[1];
    if (!w || !h) return null;
    return { width: Number(w), height: Number(h) };
  } catch {
    return null;
  }
}

/**
 * 用给定像素矩形裁剪图片并原地替换。
 * 越界或裁得过小时返回失败，调用方保留原图。
 */
export async function cropImageInPlace(
  absPath: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ ok: boolean; width?: number; height?: number; error?: string }> {
  try {
    const bin = await ensureBinary();
    const tmp = `${absPath}.crop.png`;
    await execFileAsync(
      bin,
      [
        absPath,
        tmp,
        String(Math.round(rect.x)),
        String(Math.round(rect.y)),
        String(Math.round(rect.width)),
        String(Math.round(rect.height)),
      ],
      { timeout: 20_000 },
    );
    renameSync(tmp, absPath);
    const size = await readImageSize(absPath);
    return { ok: true, width: size?.width, height: size?.height };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
