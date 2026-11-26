import type { SafariPage } from '../browser/index.js';
import { GREET_PAYWALL_WAIT_MAX_MS, sleepRandom } from '../browser/index.js';
import { closeBossModalIfPresent, waitAndCloseBossModalIfPresent } from '../common/boss_modal.js';
import {
  closeBossPaywallPopupIfPresent,
  describeBossPaywallPopupIfPresent,
  waitForBossPaywallPopup,
} from '../common/boss_paywall_popup.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { evaluateWriteGuard, recordQuotaUsage } from '../common/safety.js';
import { upsertTrackedCandidate } from '../common/tracker.js';
import {
  clickGreetDeepSearch,
  ensureInDeepSearchPage,
  isBossChatAiFormUrl,
  selectAiFormJob,
} from './deep-search.js';
import {
  assertNormalSearchPageReady,
  clickGreetNormalSearch,
  isBossChatSearchUrl,
} from './normal-search.js';
import {
  assertRecommendPageReady,
  clickGreetRecommend,
  ensureInRecommendPage,
  isBossChatRecommendUrl,
  normalizeRecommendTab,
  resolveRecommendCandidate,
  selectRecommendJob,
  selectRecommendTab,
  type CandidateLocator,
  type RecommendTab,
} from './recommend.js';

const GREET_MODAL_CLEANUP_WAIT_MAX_MS = 3500;

async function assertNoGreetPaywallPopup(page: SafariPage): Promise<void> {
  if (await waitForBossPaywallPopup(page, GREET_PAYWALL_WAIT_MAX_MS)) {
    const paywall = await describeBossPaywallPopupIfPresent(page, 'greet');
    await closeBossPaywallPopupIfPresent(page);
    if (paywall) throw new Error(paywall);
    throw new Error('页面出现 VIP/付费购买弹层，打招呼可能需开通权益或充值直豆。');
  }
}

export type GreetOptions = {
  candidateTarget?: string;
  index?: number;
  geekId?: string;
  jobKeyword?: string;
  tab?: RecommendTab;
  confirm?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

export async function runRecommendGreet(options: GreetOptions): Promise<string> {
  const locator: CandidateLocator = {
    name: options.candidateTarget?.trim() || undefined,
    index: options.index,
    geekId: options.geekId?.trim() || undefined,
  };
  const kw = (options.jobKeyword ?? '').trim();

  if (!locator.name && locator.index === undefined && !locator.geekId) {
    throw new Error('请提供打招呼目标（姓名、--index <序号> 或 --geek-id <ID>）。');
  }

  return withBossSessionPage(async (page) => {
    await closeBossModalIfPresent(page);
    let url = await page.url();

    if (options.tab || (!isBossChatAiFormUrl(url) && !isBossChatRecommendUrl(url) && !isBossChatSearchUrl(url))) {
      const tab = normalizeRecommendTab(options.tab);
      await ensureInRecommendPage(page);
      await selectRecommendTab(page, tab);
      if (kw) {
        await selectRecommendJob(page, kw);
        await selectRecommendTab(page, tab);
      }
      url = await page.url();
    }

    let pageKind: 'deep-search' | 'recommend' | 'featured' | 'search';
    if (isBossChatAiFormUrl(url)) {
      pageKind = 'deep-search';
    } else if (isBossChatRecommendUrl(url)) {
      pageKind = options.tab ? normalizeRecommendTab(options.tab) : 'recommend';
    } else if (isBossChatSearchUrl(url)) {
      pageKind = 'search';
    } else {
      throw new Error(
        `当前不在推荐页(/web/chat/recommend)、深度搜索页(/web/chat/aiform)或常规搜索页(/web/chat/search)，无法打招呼。当前 URL：${url}`,
      );
    }

    let targetDisplay = locator.name || (locator.geekId ? `geekId:${locator.geekId}` : `序号 #${locator.index}`);
    if (pageKind === 'recommend' || pageKind === 'featured') {
      await assertRecommendPageReady(page, '打招呼');
      const resolved = await resolveRecommendCandidate(page, locator);
      if (resolved) {
        targetDisplay = `${resolved.name}${resolved.geekId ? ` (${resolved.geekId})` : ''}`;
      }
    }

    const retryArgs = [
      locator.name ? JSON.stringify(locator.name) : '',
      locator.index !== undefined ? `--index ${locator.index}` : '',
      locator.geekId ? `--geek-id ${locator.geekId}` : '',
      kw ? `--job ${JSON.stringify(kw)}` : '',
      pageKind === 'featured' ? '--tab featured' : '',
      '--confirm',
    ]
      .filter(Boolean)
      .join(' ');

    const guard = evaluateWriteGuard({
      action: 'greet',
      actionLabel: `在 ${pageKind} 页面向候选人打招呼`,
      target: targetDisplay,
      detail: kw ? `岗位：${kw}` : undefined,
      confirm: options.confirm,
      dryRun: options.dryRun,
      retryHint: `boss greet ${retryArgs}`,
    });
    if (!guard.allowed) {
      return options.json ? JSON.stringify(guard.dryRunPayload, null, 2) : guard.text;
    }

    let greetedName = locator.name ?? targetDisplay;
    let greetedGeekId = locator.geekId;
    let selectedJob = kw || undefined;
    let message = '';

    if (pageKind === 'deep-search') {
      await ensureInDeepSearchPage(page);
      if (kw) {
        selectedJob = await selectAiFormJob(page, kw);
        await ensureInDeepSearchPage(page);
      }
      const res = await clickGreetDeepSearch(page, locator);
      greetedName = res.name;
      message = res.message;
    } else if (pageKind === 'search') {
      await assertNormalSearchPageReady(page);
      const res = await clickGreetNormalSearch(page, locator);
      greetedName = res.name;
      message = res.message;
    } else {
      await assertRecommendPageReady(page, '打招呼');
      if (kw) {
        selectedJob = await selectRecommendJob(page, kw);
      }
      if (pageKind === 'featured') {
        await selectRecommendTab(page, 'featured');
      }
      const res = await clickGreetRecommend(page, locator);
      greetedName = res.name;
      greetedGeekId = res.geekId || greetedGeekId;
      message = res.message;
    }

    await assertNoGreetPaywallPopup(page);
    await sleepRandom(380, 900);
    await waitAndCloseBossModalIfPresent(page, GREET_MODAL_CLEANUP_WAIT_MAX_MS);

    recordQuotaUsage('greet', {
      isWriteAction: true,
      target: greetedName,
      detail: `${pageKind}${selectedJob ? `:${selectedJob}` : ''}`,
    });
    upsertTrackedCandidate({
      name: greetedName,
      geekId: greetedGeekId,
      job: selectedJob,
      source: pageKind,
      stage: 'greeted',
      event: 'boss_greeted',
    });

    if (options.json) {
      return JSON.stringify(
        {
          executed: true,
          source: pageKind,
          job: selectedJob ?? null,
          candidate: greetedName,
          geekId: greetedGeekId ?? null,
          message,
        },
        null,
        2,
      );
    }

    return [selectedJob ? `当前岗位：${selectedJob}` : '', message].filter(Boolean).join('\n');
  }, { ensureChatShell: false, ensureMenuList: false });
}
