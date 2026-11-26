/**
 * 在线简历预览（Safari 版）：
 * - 支持推荐页、深度搜索页、常规搜索页
 * - 支持按姓名、`--index <序号>` 或 `--geek-id <ID>` 精准定位
 * - 优先提取同源 DOM 简历文本（零 OCR 费用），必要时或加 `--screenshot` 时截取 Safari 窗口供多模态 Agent 识图
 * - 自动计入每日简历查看配额并写入本地台账
 */
import { ONLINE_RESUME_IFRAME_WAIT_MAX_MS } from '../browser/index.js';
import {
  closeBossPaywallPopupIfPresent,
  describeBossPaywallPopupIfPresent,
  waitForCResumeIframeOrPaywall,
} from '../common/boss_paywall_popup.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { extractOnlineResumeFromOpenIframe } from '../common/c_resume_capture.js';
import { assertQuotaAndInterval, recordQuotaUsage } from '../common/safety.js';
import { upsertTrackedCandidate } from '../common/tracker.js';
import {
  ensureInDeepSearchPage,
  isBossChatAiFormUrl,
  openDeepSearchResumePreview,
  readAiFormSelectedJobLabel,
} from './deep-search.js';
import {
  assertNormalSearchPageReady,
  isBossChatSearchUrl,
  openNormalSearchResumePreview,
  readNormalSearchSelectedJobLabel,
} from './normal-search.js';
import {
  assertRecommendPageReady,
  ensureInRecommendPage,
  isBossChatRecommendUrl,
  normalizeRecommendTab,
  openRecommendResumePreview,
  selectRecommendJob,
  selectRecommendTab,
  type CandidateLocator,
  type RecommendTab,
} from './recommend.js';

export type PreviewOptions = {
  candidateTarget?: string;
  index?: number;
  geekId?: string;
  tab?: RecommendTab;
  jobKeyword?: string;
  screenshot?: boolean;
  json?: boolean;
};

export async function runPreview(options: PreviewOptions): Promise<string> {
  const locator: CandidateLocator = {
    name: options.candidateTarget?.trim() || undefined,
    index: options.index,
    geekId: options.geekId?.trim() || undefined,
  };
  if (!locator.name && locator.index === undefined && !locator.geekId) {
    throw new Error('请提供候选人姓名、--index <序号> 或 --geek-id <ID>。');
  }

  assertQuotaAndInterval('preview', { isWriteAction: false });

  return withBossSessionPage(async (page) => {
    let url = await page.url();
    let jobLabel = '当前列表';
    let source = 'recommend';
    let opened = false;
    let resolvedName = locator.name ?? `index:${locator.index ?? ''}`;
    let resolvedGeekId = locator.geekId;

    // 若显式指定了推荐/精选来源或当前不在任何列表页但指定了 tab/job，自动切到推荐牛人页并选定标签与岗位
    if (options.tab || (!isBossChatAiFormUrl(url) && !isBossChatRecommendUrl(url) && !isBossChatSearchUrl(url))) {
      const tab = normalizeRecommendTab(options.tab);
      source = tab;
      await ensureInRecommendPage(page);
      await selectRecommendTab(page, tab);
      if (options.jobKeyword?.trim()) {
        jobLabel = await selectRecommendJob(page, options.jobKeyword.trim());
        await selectRecommendTab(page, tab);
      }
      url = await page.url();
    }

    if (isBossChatAiFormUrl(url)) {
      source = 'deep-search';
      await ensureInDeepSearchPage(page);
      jobLabel = await readAiFormSelectedJobLabel(page);
      const res = await openDeepSearchResumePreview(page, locator);
      opened = res.opened;
      if (res.name) resolvedName = res.name;
    } else if (isBossChatRecommendUrl(url)) {
      source = options.tab ? normalizeRecommendTab(options.tab) : 'recommend';
      await assertRecommendPageReady(page, '预览候选人');
      const res = await openRecommendResumePreview(page, locator);
      opened = res.opened;
      if (res.name) resolvedName = res.name;
      if (res.geekId) resolvedGeekId = res.geekId;
    } else if (isBossChatSearchUrl(url)) {
      source = 'search';
      await assertNormalSearchPageReady(page);
      jobLabel = await readNormalSearchSelectedJobLabel(page);
      const res = await openNormalSearchResumePreview(page, locator);
      opened = res.opened;
      if (res.name) resolvedName = res.name;
    } else {
      throw new Error('当前不在推荐列表页、深度搜索页或常规搜索页，无法预览候选人。');
    }

    if (!opened) {
      throw new Error('未在当前列表中找到该候选人，或点击未能打开简历预览。');
    }

    const outcome = await waitForCResumeIframeOrPaywall(page, ONLINE_RESUME_IFRAME_WAIT_MAX_MS);
    if (outcome !== 'iframe') {
      const paywall = await describeBossPaywallPopupIfPresent(page, 'resume');
      await closeBossPaywallPopupIfPresent(page);
      if (paywall) throw new Error(paywall);
      throw new Error('点击后未出现在线简历 iframe（c-resume）。');
    }

    const extracted = await extractOnlineResumeFromOpenIframe(page, {
      candidateLabel: resolvedName,
      prefix: 'preview',
      screenshot: options.screenshot,
    });

    recordQuotaUsage('preview', { isWriteAction: false, target: resolvedName, detail: source });
    upsertTrackedCandidate({
      name: resolvedName,
      geekId: resolvedGeekId,
      job: jobLabel !== '当前列表' ? jobLabel : options.jobKeyword?.trim() || undefined,
      source,
      hasViewed: true,
      resumeTextPath: extracted.textPath,
      onlineResumePath: extracted.onlineResumePath,
      resumeScreenshotPath: extracted.screenshotPath,
      event: 'previewed_resume',
    });

    if (options.json) {
      return JSON.stringify(
        {
          job: jobLabel,
          source,
          candidate: resolvedName,
          geekId: resolvedGeekId ?? null,
          ...extracted,
        },
        null,
        2,
      );
    }

    const lines: string[] = [
      `当前岗位：${jobLabel}`,
      `候选人：${resolvedName}${resolvedGeekId ? `（geekId: ${resolvedGeekId}）` : ''}`,
      `读取方式：${extracted.method}`,
    ];
    if (extracted.textPath) lines.push(`简历文本文件：${extracted.textPath}`);
    if (extracted.screenshotPath) lines.push(`简历窗口截图：${extracted.screenshotPath}`);
    if (extracted.screenshotError) lines.push(`截图提示：${extracted.screenshotError}`);
    if (extracted.text) {
      lines.push('', '在线简历正文：', '', extracted.text);
    } else {
      lines.push('', '（未从 DOM 提取到正文文本，请直接查看上方截图文件）');
    }
    lines.push('', '说明：平台对在线简历每日可查看次数有限，已自动记录到本地配额与候选人台账。');
    return lines.join('\n');
  }, { ensureChatShell: false, ensureMenuList: false });
}
