/**
 * CLI 路由（macOS Safari 驱动 + Agent 筛选优化版）。
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  implBossSearch,
  implChatAction,
  implDoctor,
  implInspectUnread,
  implListCandidates,
  implListPositions,
  implListPositionsWithOptions,
  implLogin,
  implNormalSearch,
  implOpenChat,
  implOpenChatByIndex,
  implPreview,
  implQuota,
  implRecommend,
  implRecommendGreet,
  implSendMessage,
  implSetBaiduCredentials,
  implTracker,
  type ChatPageAction,
} from '../toolset/index.js';
import { printBossInteractiveBanner } from './banner.js';
import { printVersionInfo } from './version.js';

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

function die(msg: string): never {
  throw new CliError(msg);
}

export function isReadlineAbortError(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const err = e as { name?: string; code?: string };
  return err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

function splitShellLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function normalizeSubcommand(cmd: string): string {
  switch (cmd) {
    case 'list-candidates':
      return 'list';
    case 'open-chat':
      return 'chat';
    case 'send-message':
      return 'send';
    case 'list-positions':
      return 'positions';
    case 'status':
      return 'doctor';
    default:
      return cmd;
  }
}

function printHelp(): void {
  console.error(`boss-cli (Safari 招聘筛选定制版) — 驱动本机真实 Safari.app，服务 AI Agent 简历与面试人筛选

核心设计：
  • 浏览器：仅使用本机真实 Safari（复用日常登录态，不再启动 Chrome / CDP）
  • 安全模式：写操作默认预演（dry-run），需显式加 --confirm（或 BOSS_ALLOW_WRITE=1）才真正执行
  • 简历读取：优先直读在线简历 DOM 文本，必要时截取 Safari 窗口供多模态 Agent 看图（无需百度 OCR）

环境与登录：
  boss login
      在 Safari 中打开 Boss 直聘登录页（人工扫码登录）
  boss doctor [--json]
      自检 Safari Apple 事件 JS 权限、登录态、今日安全配额与台账统计
  boss quota [--json]
      查看今日各项操作配额使用情况

只读筛选与寻源（支持 --json）：
  boss positions [--json]
      读取当前职位列表（开放/待开放/已关闭）
  boss jd <岗位名称> [--refresh] [--json]
      抓取或读取缓存的岗位 JD（--refresh 强制刷新）
  boss recommend [岗位关键字] [--limit <N>] [--skip-viewed] [--skip-colleague] [--exclude-tracked] [--json]
      读取推荐候选人（输出含序号与 geekId）
  boss search [关键词] [--limit <N>] [--exclude-tracked] [--json]
      常规搜索牛人列表
  boss deep-search [岗位关键字] [--core <要求>] [--bonus <加分项>] [--clear-core] [--clear-bonus] [--match] [--exclude-tracked] [--json]
      管理深度搜索表单；显式加 --match 才会点击「立即匹配」
  boss preview [<姓名>] [--index <序号>] [--geek-id <ID>] [--screenshot] [--json]
      在推荐/深度搜索/常规搜索页读取候选人在线简历正文（默认不走百度 OCR）
  boss list [--unread] [--limit <N>] [--exclude-tracked] [--json]
      读取沟通列表（支持滚动加载与台账状态标记）
  boss inspect-unread [--max <N>] [--all] [--job <岗位关键字>] [--out <快照.json>] [--pause-every <N>] [--resume] [--json]
      以拟人节奏全量巡检会话：读取基础信息、完整对话并下载头像照片至 ~/.boss-cli/avatars/
      （默认只巡检「未读」，加 --all 巡检「全部」列表；--job 只筛某岗位；--out 写独立快照）
  boss chat <姓名> [--strict] [--json]
  boss chat [姓名] --index <序号> [--unread] [--strict] [--json]
      打开指定候选人会话并读取人才摘要 + 完整聊天记录
  boss action history [--json]
      读取当前会话候选人的「同事沟通 / 我的沟通」记录
  boss action resume [--screenshot] [--json]
      读取当前会话候选人的在线简历正文

本地候选人筛选台账（去重 / 评分 / 面试名单）：
  boss tracker list [--job <岗位>] [--stage <阶段>] [--min-score <分>] [--json]
  boss tracker get <姓名或ID> [--json]
  boss tracker upsert --name <姓名> [--geek-id <ID>] [--job <岗位>] [--stage <阶段>] [--score <0-100>] [--summary <摘要>] [--reason <理由>] [--notes <备注>] [--source <来源>] [--json]
  boss tracker stats [--job <岗位>] [--json]
  boss tracker export [--job <岗位>] [--stage <阶段>] [--out <文件.md|.json>] [--json]
      阶段可选：new | screened | shortlisted | greeted | replied | interview | rejected | hold

受控写操作（默认预演，需加 --confirm 才实际执行）：
  boss greet [<姓名>] [--index <序号>] [--geek-id <ID>] [--job <岗位>] [--confirm] [--json]
      在推荐 / 深度搜索 / 常规搜索页向候选人打招呼
  boss send [--to <姓名>] [--strict] -t <消息> [--request-resume] [--confirm] [--json]
      向指定（--to，自动切换并校验身份）或当前打开的会话发送消息
  boss action <not-fit|remark|agree-resume|request-attachment-resume|wechat> [--remark <备注>] [--confirm] [--json]
      执行会话动作
`);
}

const VALUE_OPTS = new Set([
  'index',
  'i',
  'geek-id',
  'limit',
  'max',
  'min-delay',
  'pause-every',
  'max-delay',
  'job',
  'j',
  'text',
  't',
  'to',
  'remark',
  'type',
  'action',
  'name',
  'stage',
  'score',
  'min-score',
  'summary',
  'reason',
  'notes',
  'source',
  'tab',
  'resume-pdf',
  'online-resume',
  'out',
  'api-key',
  'apikey',
  'secret-key',
  'secretkey',
]);

function parseOpts(argv: string[]): {
  rest: string[];
  flags: Set<string>;
  opts: Record<string, string>;
} {
  const rest: string[] = [];
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        opts[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (VALUE_OPTS.has(key) && next !== undefined && !next.startsWith('-')) {
        opts[key] = next;
        i += 1;
      } else {
        flags.add(key);
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const short = a.slice(1);
      const next = argv[i + 1];
      if (VALUE_OPTS.has(short) && next !== undefined && !next.startsWith('-')) {
        opts[short] = next;
        i += 1;
        continue;
      }
      if (!/^\d/.test(short)) {
        flags.add(short);
        continue;
      }
    }
    rest.push(a);
  }
  return { rest, flags, opts };
}

function parsePositiveInt(raw: string | undefined, label: string): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1) {
    die(`❌ ${label} 必须是正整数，当前值：${raw}`);
  }
  return n;
}

function parseNumberOpt(raw: string | undefined, label: string): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) {
    die(`❌ ${label} 必须是有效数字，当前值：${raw}`);
  }
  return n;
}

function splitRequirementArg(value: string): string[] {
  return value
    .split(/\r?\n|[;；]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseDeepSearchArgs(argv: string[]): {
  jobKeyword?: string;
  coreRequirements?: string[];
  bonusRequirements?: string[];
  match: boolean;
  excludeTracked: boolean;
  json: boolean;
} {
  const positional: string[] = [];
  const coreRequirements: string[] = [];
  const bonusRequirements: string[] = [];
  let jobKeyword = '';
  let match = false;
  let excludeTracked = false;
  let json = false;
  let coreSpecified = false;
  let bonusSpecified = false;

  const readVal = (i: number, key: string) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) die(`❌ deep-search 参数 ${key} 需要提供值`);
    return { value: next, nextIndex: i + 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--match') { match = true; continue; }
    if (arg === '--exclude-tracked') { excludeTracked = true; continue; }
    if (arg === '--json') { json = true; continue; }
    if (arg === '--clear-core') { coreSpecified = true; coreRequirements.length = 0; continue; }
    if (arg === '--clear-bonus') { bonusSpecified = true; bonusRequirements.length = 0; continue; }
    if (arg === '--job' || arg === '-j') {
      const r = readVal(i, arg);
      jobKeyword = r.value.trim();
      i = r.nextIndex;
      continue;
    }
    if (arg.startsWith('--job=')) { jobKeyword = arg.slice('--job='.length).trim(); continue; }
    if (arg === '--core' || arg === '-c') {
      const r = readVal(i, arg);
      coreSpecified = true;
      coreRequirements.push(...splitRequirementArg(r.value));
      i = r.nextIndex;
      continue;
    }
    if (arg.startsWith('--core=')) {
      coreSpecified = true;
      coreRequirements.push(...splitRequirementArg(arg.slice('--core='.length)));
      continue;
    }
    if (arg === '--bonus' || arg === '-b') {
      const r = readVal(i, arg);
      bonusSpecified = true;
      bonusRequirements.push(...splitRequirementArg(r.value));
      i = r.nextIndex;
      continue;
    }
    if (arg.startsWith('--bonus=')) {
      bonusSpecified = true;
      bonusRequirements.push(...splitRequirementArg(arg.slice('--bonus='.length)));
      continue;
    }
    if (arg.startsWith('-')) die(`❌ deep-search 不支持参数: ${arg}`);
    positional.push(arg);
  }

  if (!jobKeyword && positional.length > 0) {
    jobKeyword = positional.join(' ').trim();
  }
  return {
    jobKeyword: jobKeyword || undefined,
    coreRequirements: coreSpecified ? coreRequirements : undefined,
    bonusRequirements: bonusSpecified ? bonusRequirements : undefined,
    match,
    excludeTracked,
    json,
  };
}

function printStdout(text: string): void {
  const t = text.trimEnd();
  if (t.length > 0) console.log(t);
}

export async function executeCommand(argv: string[]): Promise<string> {
  if (argv.length === 0) die('❌ 空命令');

  const cmd = normalizeSubcommand(argv[0]!);
  const tail = argv.slice(1);

  if (cmd === '_baidu-keys') {
    const { rest, opts } = parseOpts(tail);
    const apiKey = (opts['api-key'] ?? opts.apikey ?? rest[0] ?? '').trim();
    const secretKey = (opts['secret-key'] ?? opts.secretkey ?? rest[1] ?? '').trim();
    if (!apiKey || !secretKey) {
      die('❌ 用法: _baidu-keys --api-key <KEY> --secret-key <SECRET>');
    }
    return implSetBaiduCredentials(apiKey, secretKey);
  }

  if (cmd === 'login') {
    return implLogin();
  }

  if (cmd === 'doctor') {
    const { flags } = parseOpts(tail);
    return implDoctor({ json: flags.has('json') });
  }

  if (cmd === 'quota') {
    const { flags } = parseOpts(tail);
    return implQuota({ json: flags.has('json') });
  }

  if (cmd === 'tracker') {
    const subRaw = (tail[0] ?? 'list').toLowerCase();
    const hasExplicitSub = ['list', 'get', 'upsert', 'stats', 'export'].includes(subRaw);
    const subcommand = (hasExplicitSub ? subRaw : 'list') as
      | 'list'
      | 'get'
      | 'upsert'
      | 'stats'
      | 'export';
    const { rest, flags, opts } = parseOpts(hasExplicitSub ? tail.slice(1) : tail);
    return implTracker({
      subcommand,
      target: rest.join(' ').trim() || undefined,
      name: opts.name,
      geekId: opts['geek-id'],
      job: opts.job ?? opts.j,
      source: opts.source,
      stage: opts.stage,
      score: parseNumberOpt(opts.score, '--score'),
      minScore: parseNumberOpt(opts['min-score'], '--min-score'),
      summary: opts.summary,
      reason: opts.reason,
      notes: opts.notes,
      resumePdfPath: opts['resume-pdf'],
      onlineResumePath: opts['online-resume'],
      outPath: opts.out,
      json: flags.has('json'),
    });
  }

  if (cmd === 'list') {
    const { flags, opts } = parseOpts(tail);
    return implListCandidates({
      unreadOnly: flags.has('unread'),
      limit: parsePositiveInt(opts.limit, '--limit'),
      excludeTracked: flags.has('exclude-tracked'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'inspect-unread') {
    const { flags, opts } = parseOpts(tail);
    return implInspectUnread({
      max: parsePositiveInt(opts.max, '--max'),
      resume: flags.has('resume'),
      all: flags.has('all'),
      jobFilter: (opts.job ?? '').trim() || undefined,
      outFile: (opts.out ?? '').trim() || undefined,
      pauseEvery: parsePositiveInt(opts['pause-every'], '--pause-every'),
      minDelayMs: parsePositiveInt(opts['min-delay'], '--min-delay'),
      maxDelayMs: parsePositiveInt(opts['max-delay'], '--max-delay'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'chat') {
    const { rest, flags, opts } = parseOpts(tail);
    const nameArg = rest.join(' ').trim();
    const exact = flags.has('strict');
    const json = flags.has('json');
    const index = parsePositiveInt(opts.index ?? opts.i, '--index');
    if (index !== undefined) {
      return implOpenChatByIndex({
        index,
        unreadOnly: flags.has('unread'),
        expectedName: nameArg || undefined,
        exact,
        json,
      });
    }
    if (flags.has('unread')) {
      die('❌ chat 只有配合 --index 时才支持 --unread。用法: chat --index <序号> --unread');
    }
    if (!nameArg) {
      die('❌ 用法: chat <姓名> [--strict] [--json]；或 chat [姓名] --index <序号> [--unread]');
    }
    return implOpenChat(nameArg, exact, { json });
  }

  if (cmd === 'action') {
    const { rest, flags, opts } = parseOpts(tail);
    const raw = (rest[0] ?? opts.type ?? opts.action ?? '').trim().toLowerCase();
    const actionMap: Record<string, ChatPageAction> = {
      resume: 'resume',
      'not-fit': 'not-fit',
      remark: 'remark',
      'agree-resume': 'agree-resume',
      'request-attachment-resume': 'request-attachment-resume',
      'ask-attachment-resume': 'request-attachment-resume',
      'ask-resume': 'request-attachment-resume',
      history: 'history',
      'chat-history': 'history',
      wechat: 'exchange-wechat',
      'exchange-wechat': 'exchange-wechat',
    };
    const action = actionMap[raw];
    if (!action) {
      die('❌ 用法: action <resume|history|not-fit|remark|agree-resume|request-attachment-resume|wechat> [--remark <备注>] [--confirm]');
    }
    const remark = (opts.remark ?? '').trim();
    if (action === 'remark' && !remark) {
      die('❌ 当操作为 remark 时，必须提供 --remark <备注内容>。');
    }
    return implChatAction({
      action,
      remark,
      confirm: flags.has('confirm'),
      dryRun: flags.has('dry-run'),
      screenshot: flags.has('screenshot'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'send') {
    const { rest, flags, opts } = parseOpts(tail);
    const text = (opts.text ?? opts.t ?? '').trim();
    const to = (opts.to ?? rest.join(' ')).trim() || undefined;
    if (!text) {
      die('❌ 用法: send [--to <姓名>] [--strict] -t <消息> [--request-resume] [--confirm] [--json]');
    }
    return implSendMessage({
      text,
      to,
      exact: flags.has('strict'),
      requestResume: flags.has('request-resume'),
      confirm: flags.has('confirm'),
      dryRun: flags.has('dry-run'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'positions') {
    const { flags } = parseOpts(tail);
    return implListPositions({ json: flags.has('json') });
  }

  if (cmd === 'jd') {
    const { flags, rest } = parseOpts(tail);
    const detailName = rest.join(' ').trim();
    if (!detailName) die('❌ 用法: jd <岗位名称> [--refresh] [--json]');
    return implListPositionsWithOptions({
      detail: true,
      detailName,
      refresh: flags.has('refresh'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'deep-search' || cmd === 'deepsearch') {
    return implBossSearch(parseDeepSearchArgs(tail));
  }

  if (cmd === 'search') {
    const { rest, flags, opts } = parseOpts(tail);
    return implNormalSearch({
      keyword: rest.join(' ').trim() || undefined,
      limit: parsePositiveInt(opts.limit, '--limit'),
      excludeTracked: flags.has('exclude-tracked'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'preview') {
    const { rest, flags, opts } = parseOpts(tail);
    return implPreview({
      candidateTarget: rest.join(' ').trim() || undefined,
      index: parsePositiveInt(opts.index ?? opts.i, '--index'),
      geekId: opts['geek-id'],
      tab: opts.tab as 'recommend' | 'featured' | undefined,
      jobKeyword: (opts.job ?? opts.j)?.trim() || undefined,
      screenshot: flags.has('screenshot'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'recommend') {
    const { rest, flags, opts } = parseOpts(tail);
    return implRecommend({
      jobKeyword: (opts.job ?? opts.j ?? rest.join(' ')).trim() || undefined,
      tab: opts.tab as 'recommend' | 'featured' | undefined,
      limit: parsePositiveInt(opts.limit, '--limit'),
      skipViewed: flags.has('skip-viewed'),
      skipColleague: flags.has('skip-colleague'),
      excludeTracked: flags.has('exclude-tracked'),
      syncTracker: flags.has('sync-tracker'),
      json: flags.has('json'),
    });
  }

  if (cmd === 'greet') {
    const { rest, flags, opts } = parseOpts(tail);
    return implRecommendGreet({
      candidateTarget: rest.join(' ').trim() || undefined,
      index: parsePositiveInt(opts.index ?? opts.i, '--index'),
      geekId: opts['geek-id'],
      jobKeyword: (opts.job ?? opts.j)?.trim() || undefined,
      tab: opts.tab as 'recommend' | 'featured' | undefined,
      confirm: flags.has('confirm'),
      dryRun: flags.has('dry-run'),
      json: flags.has('json'),
    });
  }

  die(`❌ 未知命令 “${argv[0]}”。输入 boss help 查看用法。`);
}

export async function runOneCommand(argv: string[]): Promise<void> {
  if (argv.length === 0) return;
  try {
    const text = await executeCommand(argv);
    printStdout(text);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

async function runInteractiveLoop(): Promise<void> {
  const rl = createInterface({ input, output, terminal: true });
  printBossInteractiveBanner();
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('boss> ');
      } catch (e) {
        if (isReadlineAbortError(e)) break;
        throw e;
      }
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(exit|quit)$/i.test(trimmed)) break;
      if (/^help$/i.test(trimmed)) {
        printHelp();
        continue;
      }
      if (/^(version|ver|-v|--version)$/i.test(trimmed)) {
        await printVersionInfo();
        continue;
      }
      try {
        const text = await executeCommand(splitShellLine(trimmed));
        printStdout(text);
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
      }
    }
  } finally {
    rl.close();
  }
}

export async function runCli(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    if (process.env.npm_lifecycle_event === 'dev') {
      await runInteractiveLoop();
      return;
    }
    printHelp();
    return;
  }

  if (['version', 'ver', '-v', '--version'].includes(argv[0]!)) {
    await printVersionInfo();
    return;
  }

  if (['help', '--help', '-h'].includes(argv[0]!)) {
    printHelp();
    return;
  }

  await runOneCommand(argv);
}
