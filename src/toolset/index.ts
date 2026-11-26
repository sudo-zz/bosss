/** 业务实现聚合出口：impl* 供 CLI 与外部模块调用 */
import { withBossSessionPage } from '../common/boss_session_page.js';
import {
  runChatActionOnCurrentConversation,
  type ChatActionOptions,
  type ChatPageAction,
} from './action.js';
import { runOpenCandidateChat, runOpenCandidateChatByIndex } from './chat.js';
import { runBossSearch, type BossSearchOptions, type DeepSearchGeekItem } from './deep-search.js';
import { runRecommendGreet, type GreetOptions } from './greet.js';
import { runListOpenPositions, type ListOpenPositionsDeps } from './jd.js';
import { runGetCandidateList, type ListCandidatesOptions } from './list.js';
import { runDoctor, runLogin } from './login.js';
import { runNormalSearch, type NormalSearchOptions } from './normal-search.js';
import { runPreview, type PreviewOptions } from './preview.js';
import { runRecommend, type RecommendOptions } from './recommend.js';
import { runSendChatMessage, type SendChatMessageOptions } from './send.js';
import { runQuotaCommand, runTrackerCommand } from './tracker.js';
import { runInspectUnread, type InspectUnreadOptions } from './inspect_unread.js';

export type { ChatActionOptions, ChatPageAction, DeepSearchGeekItem };

export async function implLogin(): Promise<string> {
  return runLogin();
}

export async function implDoctor(opts: { json?: boolean } = {}): Promise<string> {
  return runDoctor(opts);
}

export function implQuota(opts: { json?: boolean } = {}): string {
  return runQuotaCommand(opts);
}

export async function implTracker(
  params: Parameters<typeof runTrackerCommand>[0],
): Promise<string> {
  return runTrackerCommand(params);
}

export async function implListCandidates(opts: ListCandidatesOptions = {}): Promise<string> {
  return runGetCandidateList(opts);
}

export async function implOpenChat(
  candidateName: string,
  exact: boolean,
  opts: { json?: boolean } = {},
): Promise<string> {
  return withBossSessionPage((page) => runOpenCandidateChat(page, candidateName, exact, opts));
}

export async function implOpenChatByIndex(params: {
  index: number;
  unreadOnly?: boolean;
  expectedName?: string;
  exact?: boolean;
  json?: boolean;
}): Promise<string> {
  return withBossSessionPage((page) =>
    runOpenCandidateChatByIndex(page, {
      index: params.index,
      filter: params.unreadOnly ? 'unread' : 'all',
      expectedName: params.expectedName,
      exact: params.exact,
      json: params.json,
    }),
  );
}

export async function implChatAction(params: ChatActionOptions): Promise<string> {
  return withBossSessionPage((page) => runChatActionOnCurrentConversation(page, params));
}

export async function implSendMessage(params: SendChatMessageOptions): Promise<string> {
  return runSendChatMessage(params);
}

export async function implListPositions(opts: { json?: boolean } = {}): Promise<string> {
  return runListOpenPositions({ json: opts.json });
}

export async function implListPositionsWithOptions(opts: ListOpenPositionsDeps): Promise<string> {
  return runListOpenPositions(opts);
}

export async function implBossSearch(opts: BossSearchOptions = {}): Promise<string> {
  return runBossSearch(opts);
}

export async function implNormalSearch(opts: NormalSearchOptions = {}): Promise<string> {
  return runNormalSearch(opts);
}

export async function implRecommend(opts: RecommendOptions = {}): Promise<string> {
  return runRecommend(opts);
}

export async function implPreview(opts: PreviewOptions): Promise<string> {
  return runPreview(opts);
}

export async function implRecommendGreet(opts: GreetOptions): Promise<string> {
  return runRecommendGreet(opts);
}

export async function implInspectUnread(opts: InspectUnreadOptions = {}): Promise<string> {
  return runInspectUnread(opts);
}

export { implSetBaiduCredentials } from './baidu_credentials.js';
