import type { SafariPage } from '../browser/index.js';
import { describeManualInterventionUrl } from './auth.js';

export type EnsurePageOptions = {
  name: string;
  targetUrl: string;
  matches: (url: string) => boolean;
  timeoutMs?: number;
};

export async function ensurePage(page: SafariPage, opts: EnsurePageOptions): Promise<void> {
  const startUrl = await page.url();
  const blockedStart = describeManualInterventionUrl(startUrl);
  if (blockedStart) {
    throw new Error(blockedStart);
  }

  if (!opts.matches(startUrl)) {
    await page.goto(opts.targetUrl, {
      timeoutMs: opts.timeoutMs ?? 45_000,
    });
  }

  const currentUrl = await page.url();
  const blockedAfter = describeManualInterventionUrl(currentUrl);
  if (blockedAfter) {
    throw new Error(blockedAfter);
  }

  if (!opts.matches(currentUrl)) {
    throw new Error(
      `进入${opts.name}失败。起始页面：${startUrl || 'unknown'}；当前页面：${currentUrl || 'unknown'}；目标页面：${opts.targetUrl}`,
    );
  }
}
