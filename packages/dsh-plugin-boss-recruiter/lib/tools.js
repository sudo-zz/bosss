import { defineTool } from '@deepseek-ai/dsh-tools';

const WRITE_TOOL_META = {
  boss_send_message: {
    label: '发送 Boss 聊天消息',
    enLabel: 'send a Boss Zhipin chat message',
    targetOf: (args) => String(args?.to || '当前聊天对象'),
    previewOf: (args, svc) => String(args?.text || svc.defaultReplyTemplate).slice(0, 120),
  },
  boss_greet_candidate: {
    label: '向候选人打招呼',
    enLabel: 'greet a Boss Zhipin candidate',
    targetOf: (args) => (args?.geekId ? `geekId:${args.geekId}` : `候选人 #${args?.index ?? '?'}`),
    previewOf: (args) => (args?.job ? `岗位：${args.job}` : '触发 Boss「打招呼」按钮'),
  },
  boss_chat_action: {
    label: '执行 Boss 聊天写操作',
    enLabel: 'run an outbound Boss Zhipin chat action',
    targetOf: (args) => String(args?.to || '当前聊天对象'),
    previewOf: (args) =>
      args?.remarkText ? `${args?.action}: ${String(args.remarkText).slice(0, 80)}` : String(args?.action || ''),
  },
};

const STANDARD_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    command: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    payloadJson: { type: 'string', required: true },
    manualInterventionRequired: { type: 'boolean', required: true },
    dryRun: { type: 'boolean', required: true },
  },
};

function renderStandardOutput(_args, value) {
  const lines = [value.summary];
  if (value.manualInterventionRequired) {
    lines.push(
      '[ACTION REQUIRED] Boss Zhipin requires manual login or security verification in your host macOS Safari window. Stop and ask the user to complete it before continuing.',
    );
  }
  if (value.payloadJson && value.payloadJson !== '{}') {
    lines.push('```json\n' + value.payloadJson + '\n```');
  }
  return [{ type: 'text', text: lines.join('\n\n') }];
}

function truncateJson(data, maxChars = 28000) {
  const raw = typeof data === 'string' ? data : JSON.stringify(data ?? {}, null, 2);
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n... (truncated, total ${raw.length} chars)`;
}

function detectManualIntervention(parsed, rawText) {
  if (parsed && typeof parsed === 'object') {
    if (parsed.manualInterventionRequired === true) return true;
    if (parsed.loggedInShell === false) return true;
  }
  const text = String(rawText || '');
  return /安全验证|滑块|验证码|请先.*登录|403|manualIntervention/i.test(text);
}

async function execBossJson(svc, args, signal, summaryFn, dryRun = false) {
  const { stdout, data } = await svc.runCli(args, { signal });
  const manualInterventionRequired = detectManualIntervention(data, stdout);
  const payload = data ?? { rawOutput: stdout };
  const summary = summaryFn(payload, stdout);
  return {
    ok: !manualInterventionRequired && payload?.ok !== false,
    command: `boss ${args.join(' ')}`,
    summary,
    payloadJson: truncateJson(payload),
    manualInterventionRequired,
    dryRun: Boolean(dryRun || payload?.dryRun === true),
  };
}

export const name = 'boss-recruiter-tools';
export const inject = ['tools', 'bossRecruiter'];

export function apply(ctx) {
  const svc = ctx.bossRecruiter;

  // Native DeepSeek Harness pre-execute approval gate for all outbound Boss write tools.
  // When dryRun !== true, DSH pops up its native approval card (Web/TUI/Desktop) and fails closed if unattended.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const meta = WRITE_TOOL_META[exec.name];
    if (!meta) return next();
    const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {};
    if (args.dryRun === true) {
      return next();
    }
    const target = meta.targetOf(args);
    const preview = meta.previewOf(args, svc);
    return {
      kind: 'ask',
      reason: `Boss Zhipin outbound write (${exec.name}) -> ${target}${preview ? ` | ${preview}` : ''}`,
      displayReason: {
        en: `Allow ${meta.enLabel} to "${target}" via host macOS Safari?${preview ? ` (${preview})` : ''}`,
        zh: `允许通过本机 Safari 向「${target}」${meta.label}吗？${preview ? `（${preview}）` : ''}`,
      },
    };
  });

  // Optionally contribute concise system-prompt guidance if systemPrompt service is present.
  ctx.inject(['systemPrompt'], (spCtx) => {
    const order =
      typeof spCtx.systemPrompt.getSectionOrder === 'function'
        ? spCtx.systemPrompt.getSectionOrder('TOOL_MISC')
        : 600;
    spCtx.systemPrompt.section({
      name: 'plugin:boss-safari-recruiter',
      order,
      text: [
        'Boss Zhipin Safari Recruiter plugin (`boss_*` tools) is active on macOS.',
        '- Always run `boss_doctor` first to confirm Safari & Boss login readiness. Never attempt to bypass login walls, CAPTCHAs, or 403 pages — stop and ask the user to resolve them in Safari.',
        '- Screen candidates with read-only tools first, persist evaluations with `boss_tracker_upsert`, and only call `boss_preview_resume` for shortlisted candidates to preserve daily preview quota.',
        '- All outbound write tools (`boss_send_message`, `boss_greet_candidate`, `boss_chat_action`) require user approval (or `dryRun: true` to rehearse). For complete SOP and scoring rubrics, invoke the `boss-safari-recruiter` skill.',
      ].join('\n'),
    });
  });

  const tools = [
    defineTool({
      name: 'boss_doctor',
      description:
        'Check macOS Safari status, "Allow JavaScript from Apple Events" permission, Boss Zhipin login session, and today\'s write quota. Always run this first.',
      parameters: {},
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: () => ({
        card: 'generic',
        title: '检查本机 Safari 与 Boss 登录状态',
        kind: 'read',
      }),
      async execute(_args, exec) {
        const res = await execBossJson(
          svc,
          ['doctor', '--json'],
          exec.signal,
          (data) =>
            data?.loggedInShell
              ? `Safari 已就绪：${data?.bossTab?.title || 'Boss 直聘已登录'}`
              : `Safari 未完全就绪：${data?.manualInterventionMessage || '请先在 Safari 登录 Boss 直聘'}`,
        );
        return res;
      },
    }),

    defineTool({
      name: 'boss_quota',
      description:
        'Read today\'s remaining Boss Zhipin safety quotas (send/greet/preview/etc.), minimum write interval, and configured default reply template without touching Safari.',
      parameters: {},
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => true,
      presentCall: () => ({
        card: 'generic',
        title: '查看今日 Boss 安全配额与默认话术',
        kind: 'read',
      }),
      async execute() {
        const quota = svc.readQuota();
        return {
          ok: true,
          command: 'boss quota --json',
          summary: `今日配额（${quota.date}）：发消息 ${quota.quotas.send.used}/${quota.quotas.send.limit}，打招呼 ${quota.quotas.greet.used}/${quota.quotas.greet.limit}，在线简历 ${quota.quotas.preview.used}/${quota.quotas.preview.limit}，最小写间隔 ${quota.minWriteIntervalSec}s。`,
          payloadJson: truncateJson(quota),
          manualInterventionRequired: false,
          dryRun: false,
        };
      },
    }),

    defineTool({
      name: 'boss_positions',
      description: 'List all active recruiting job positions on the currently logged-in Boss Zhipin account.',
      parameters: {},
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: () => ({
        card: 'generic',
        title: '读取 Boss 在招岗位列表',
        kind: 'read',
      }),
      execute: (_args, exec) =>
        execBossJson(svc, ['positions', '--json'], exec.signal, (data) => {
          const count = Array.isArray(data?.positions) ? data.positions.length : Array.isArray(data) ? data.length : '?';
          return `已读取在招岗位列表（${count} 个岗位）。`;
        }),
    }),

    defineTool({
      name: 'boss_jd',
      description: 'Fetch the full job description (JD), salary band, city/location, and requirements for a Boss job position.',
      parameters: {
        position: {
          type: 'string',
          required: true,
          description: 'Job position title or keyword (e.g. "AI应用开发工程师").',
        },
        refresh: {
          type: 'boolean',
          description: 'If true, bypass local cache and force re-fetch from Safari.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `读取岗位 JD：${args.position}`,
        kind: 'read',
        rawInput: args.position,
      }),
      execute: (args, exec) => {
        const cliArgs = ['jd', args.position, '--json'];
        if (args.refresh) cliArgs.push('--refresh');
        return execBossJson(svc, cliArgs, exec.signal, () => `已获取岗位「${args.position}」JD 详情。`);
      },
    }),

    defineTool({
      name: 'boss_list_chats',
      description: 'List Boss Zhipin chat conversations in the inbox (supports unread-only, limit, and excluding already-tracked candidates).',
      parameters: {
        unreadOnly: {
          type: 'boolean',
          description: 'If true, only list unread chat conversations.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of chats to return (default 30, max 100).',
        },
        excludeTracked: {
          type: 'boolean',
          description: 'If true, exclude candidates already recorded in ~/.boss-cli/tracker.json.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: args.unreadOnly ? '读取 Boss 未读会话列表' : '读取 Boss 聊天会话列表',
        kind: 'read',
        rawInput: args,
      }),
      execute: (args, exec) => {
        const cliArgs = ['list', '--json'];
        if (args.unreadOnly) cliArgs.push('--unread');
        if (typeof args.limit === 'number') cliArgs.push('--limit', String(Math.max(1, Math.min(100, args.limit))));
        if (args.excludeTracked) cliArgs.push('--exclude-tracked');
        return execBossJson(svc, cliArgs, exec.signal, (data) => {
          const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
          return `已读取 ${items.length} 条 Boss 会话记录。`;
        });
      },
    }),

    defineTool({
      name: 'boss_inspect_unread',
      description:
        'Human-paced inbox inspector: iterates unread (or all) chats in host Safari, collects candidate profiles, message histories, and downloads avatars/image resumes to ~/.boss-cli/avatars/.',
      parameters: {
        max: {
          type: 'integer',
          description: 'Maximum conversations to inspect (default 30).',
        },
        all: {
          type: 'boolean',
          description: 'If true, inspect the "all" chat tab instead of unread-only.',
        },
        job: {
          type: 'string',
          description: 'Optional job title keyword filter.',
        },
        resume: {
          type: 'boolean',
          description: 'If true, resume from the existing unread-inspect snapshot without re-reading already-inspected threads.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      timeoutMs: 600000,
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `拟人化巡检 Boss ${args.all ? '全部' : '未读'}消息${args.job ? `（${args.job}）` : ''}`,
        kind: 'read',
        rawInput: args,
      }),
      execute: (args, exec) => {
        const cliArgs = ['inspect-unread', '--json'];
        if (typeof args.max === 'number') cliArgs.push('--max', String(Math.max(1, Math.min(100, args.max))));
        if (args.all) cliArgs.push('--all');
        if (args.job) cliArgs.push('--job', args.job);
        if (args.resume) cliArgs.push('--resume');
        return execBossJson(svc, cliArgs, exec.signal, (data) => {
          const count = Array.isArray(data?.candidates) ? data.candidates.length : '?';
          return `已完成未读消息巡检，采集到 ${count} 位候选人信息。`;
        });
      },
    }),

    defineTool({
      name: 'boss_read_chat',
      description:
        'Open a specific Boss Zhipin chat conversation by candidate name or 1-based list index, reading recent messages and optional colleague contact history.',
      parameters: {
        name: {
          type: 'string',
          description: 'Candidate name to open (preferred over index when known).',
        },
        index: {
          type: 'integer',
          description: '1-based index from boss_list_chats (used if name is omitted).',
        },
        unreadOnly: {
          type: 'boolean',
          description: 'Whether the index refers to the unread-only filtered list.',
        },
        strict: {
          type: 'boolean',
          description: 'Require exact candidate name match.',
        },
        includeHistory: {
          type: 'boolean',
          description: 'If true, also query colleague contact history to avoid duplicate outreach.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `读取候选人聊天记录：${args.name || `#${args.index ?? '?'}`}`,
        kind: 'read',
        rawInput: args,
      }),
      async execute(args, exec) {
        const cliArgs = ['chat'];
        if (args.name) cliArgs.push(args.name);
        if (typeof args.index === 'number') cliArgs.push('--index', String(args.index));
        if (args.unreadOnly && typeof args.index === 'number') cliArgs.push('--unread');
        if (args.strict) cliArgs.push('--strict');
        cliArgs.push('--json');
        const main = await execBossJson(
          svc,
          cliArgs,
          exec.signal,
          () => `已读取候选人「${args.name || `#${args.index ?? '?'}`}」聊天记录。`,
        );
        if (!args.includeHistory || main.manualInterventionRequired) return main;
        try {
          const hist = await svc.runCli(['action', 'history', '--json'], { signal: exec.signal });
          const merged = {
            chat: JSON.parse(main.payloadJson),
            colleagueHistory: hist.data ?? hist.stdout,
          };
          return {
            ...main,
            summary: `${main.summary}（已附带同事联系记录）`,
            payloadJson: truncateJson(merged),
          };
        } catch {
          return main;
        }
      },
    }),

    defineTool({
      name: 'boss_recommend',
      description:
        'Fetch candidates from Boss Zhipin "推荐牛人" -> "推荐" (recommend) or "精选" (featured) tabs by job position (excludes "最新"). Supports syncing straight into ~/.boss-cli/tracker.json with source and position tags.',
      parameters: {
        position: {
          type: 'string',
          required: true,
          description: 'Target job position name.',
        },
        tab: {
          type: 'string',
          enum: ['recommend', 'featured'],
          description: 'Source tab under 推荐牛人: "recommend" (推荐) or "featured" (精选). Default "recommend".',
        },
        limit: {
          type: 'integer',
          description: 'Maximum candidate cards to collect (default 30).',
        },
        skipViewed: {
          type: 'boolean',
          description: 'Skip already-viewed candidates (default true).',
        },
        skipColleague: {
          type: 'boolean',
          description: 'Skip candidates already contacted by colleagues (default true).',
        },
        excludeTracked: {
          type: 'boolean',
          description: 'Exclude candidates already recorded in local tracker (default true).',
        },
        syncTracker: {
          type: 'boolean',
          description: 'If true, write fetched candidates into local tracker with job + source tags (default true).',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `浏览${args.tab === 'featured' ? '精选牛人' : '推荐牛人'}：${args.position}`,
        kind: 'search',
        rawInput: args,
      }),
      execute: (args, exec) => {
        const tab = args.tab === 'featured' ? 'featured' : 'recommend';
        const cliArgs = ['recommend', args.position, '--tab', tab, '--json'];
        cliArgs.push('--limit', String(Math.max(1, Math.min(80, args.limit ?? 30))));
        if (args.skipViewed !== false) cliArgs.push('--skip-viewed');
        if (args.skipColleague !== false) cliArgs.push('--skip-colleague');
        if (args.excludeTracked !== false) cliArgs.push('--exclude-tracked');
        if (args.syncTracker !== false) cliArgs.push('--sync-tracker');
        return execBossJson(svc, cliArgs, exec.signal, (data) => {
          const count = Array.isArray(data?.candidates) ? data.candidates.length : Array.isArray(data) ? data.length : '?';
          return `已拉取岗位「${args.position}」的${tab === 'featured' ? '精选牛人' : '推荐牛人'} ${count} 位。`;
        });
      },
    }),

    defineTool({
      name: 'boss_search_candidates',
      description: 'Search Boss Zhipin candidates by technical/role keyword (read-only card summaries).',
      parameters: {
        keyword: {
          type: 'string',
          required: true,
          description: 'Search keyword (e.g. "LangGraph", "MCP", "React Python").',
        },
        limit: {
          type: 'integer',
          description: 'Maximum results (default 30).',
        },
        excludeTracked: {
          type: 'boolean',
          description: 'Exclude candidates already in local tracker (default true).',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `关键词搜索候选人：${args.keyword}`,
        kind: 'search',
        rawInput: args,
      }),
      execute: (args, exec) => {
        const cliArgs = ['search', args.keyword, '--json'];
        cliArgs.push('--limit', String(Math.max(1, Math.min(80, args.limit ?? 30))));
        if (args.excludeTracked !== false) cliArgs.push('--exclude-tracked');
        return execBossJson(svc, cliArgs, exec.signal, (data) => {
          const count = Array.isArray(data?.candidates) ? data.candidates.length : Array.isArray(data) ? data.length : '?';
          return `关键词「${args.keyword}」共搜到 ${count} 位候选人。`;
        });
      },
    }),

    defineTool({
      name: 'boss_preview_resume',
      description:
        'Open and extract a shortlisted candidate\'s online resume (consumes daily preview quota; call only on high-potential candidates after card/chat screening).',
      parameters: {
        name: {
          type: 'string',
          description: 'Optional candidate name.',
        },
        geekId: {
          type: 'string',
          description: 'Candidate geekId from recommend/search.',
        },
        index: {
          type: 'integer',
          description: '1-based index on the current list (used when geekId is omitted).',
        },
        tab: {
          type: 'string',
          enum: ['recommend', 'featured'],
          description: 'Source tab under 推荐牛人 when previewing a recommend/featured candidate.',
        },
        job: {
          type: 'string',
          description: 'Optional job title to select before opening preview.',
        },
        fromChat: {
          type: 'boolean',
          description: 'If true, read the online resume panel of the currently open chat (`boss action resume`).',
        },
        screenshot: {
          type: 'boolean',
          description: 'If true, also capture a Safari window screenshot for multimodal inspection.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: args.fromChat
          ? '查看当前聊天候选人在线简历'
          : `查看候选人在线简历：${args.name || args.geekId || `#${args.index ?? '?'}`}`,
        kind: 'read',
        rawInput: args,
      }),
      execute: (args, exec) => {
        if (args.fromChat) {
          const chatArgs = ['action', 'resume', '--json'];
          if (args.screenshot) chatArgs.push('--screenshot');
          return execBossJson(svc, chatArgs, exec.signal, () => '已提取当前聊天对象的在线简历并转存本地。');
        }
        const cliArgs = ['preview'];
        if (args.name) cliArgs.push(args.name);
        if (args.geekId) cliArgs.push('--geek-id', args.geekId);
        else if (typeof args.index === 'number') cliArgs.push('--index', String(args.index));
        if (args.tab) cliArgs.push('--tab', args.tab);
        if (args.job) cliArgs.push('--job', args.job);
        if (args.screenshot) cliArgs.push('--screenshot');
        cliArgs.push('--json');
        return execBossJson(
          svc,
          cliArgs,
          exec.signal,
          () => `已提取候选人（${args.name || args.geekId || `#${args.index ?? '?'}`}）在线简历并转存本地。`,
        );
      },
    }),

    defineTool({
      name: 'boss_tracker_query',
      description:
        'Query the local candidate screening tracker (~/.boss-cli/tracker.json) by job, stage, or minimum score. Fast local read, does not touch Safari.',
      parameters: {
        job: {
          type: 'string',
          description: 'Optional substring filter on job title.',
        },
        stage: {
          type: 'string',
          enum: ['new', 'screened', 'shortlisted', 'greeted', 'replied', 'interview', 'hold', 'rejected'],
          description: 'Optional pipeline stage filter.',
        },
        minScore: {
          type: 'number',
          description: 'Optional minimum score filter (0-100).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum rows to return (default 50).',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => true,
      presentCall: (args) => ({
        card: 'generic',
        title: '查询本地候选人台账',
        kind: 'read',
        rawInput: args,
      }),
      async execute(args) {
        const store = svc.readTracker();
        const all = Object.values(store.candidates || {});
        const jobNeedle = (args.job || '').trim().toLowerCase();
        const filtered = all
          .filter((c) => {
            if (jobNeedle && !String(c.job || '').toLowerCase().includes(jobNeedle)) return false;
            if (args.stage && c.stage !== args.stage) return false;
            if (typeof args.minScore === 'number' && (typeof c.score !== 'number' || c.score < args.minScore)) {
              return false;
            }
            return true;
          })
          .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const byStage = {};
        for (const c of filtered) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
        const limit = Math.max(1, Math.min(200, args.limit ?? 50));
        return {
          ok: true,
          command: 'boss tracker list --json',
          summary: `本地台账共命中 ${filtered.length} 位候选人（总计 ${all.length} 位），当前返回前 ${Math.min(limit, filtered.length)} 位。`,
          payloadJson: truncateJson({
            totalMatched: filtered.length,
            totalInStore: all.length,
            byStage,
            candidates: filtered.slice(0, limit),
          }),
          manualInterventionRequired: false,
          dryRun: false,
        };
      },
    }),

    defineTool({
      name: 'boss_tracker_upsert',
      description:
        'Create or update a candidate record in the local screening tracker (~/.boss-cli/tracker.json) with stage, score (0-100), summary, reason, and notes.',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'Candidate full name.',
        },
        job: {
          type: 'string',
          description: 'Target job title.',
        },
        geekId: {
          type: 'string',
          description: 'Optional Boss geekId for stable deduplication.',
        },
        stage: {
          type: 'string',
          required: true,
          enum: ['new', 'screened', 'shortlisted', 'greeted', 'replied', 'interview', 'hold', 'rejected'],
          description: 'Pipeline stage.',
        },
        score: {
          type: 'number',
          description: 'Match score from 0 to 100.',
        },
        summary: {
          type: 'string',
          description: 'One-line candidate highlight summary.',
        },
        reason: {
          type: 'string',
          description: 'Evaluation rationale and risks.',
        },
        notes: {
          type: 'string',
          description: 'Optional interview questions or follow-up notes.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `写入候选人台账：${args.name} → ${args.stage}${typeof args.score === 'number' ? ` (${args.score}分)` : ''}`,
        kind: 'edit',
        rawInput: args,
      }),
      async execute(args, exec) {
        const cliArgs = ['tracker', 'upsert', '--name', args.name, '--stage', args.stage, '--json'];
        if (args.job) cliArgs.push('--job', args.job);
        if (args.geekId) cliArgs.push('--geek-id', args.geekId);
        if (typeof args.score === 'number') cliArgs.push('--score', String(Math.round(args.score)));
        if (args.summary) cliArgs.push('--summary', args.summary);
        if (args.reason) cliArgs.push('--reason', args.reason);
        if (args.notes) cliArgs.push('--notes', args.notes);
        return execBossJson(
          svc,
          cliArgs,
          exec.signal,
          () => `已将「${args.name}」写入本地台账（阶段：${args.stage}${typeof args.score === 'number' ? `，评分：${Math.round(args.score)}` : ''}）。`,
        );
      },
    }),

    defineTool({
      name: 'boss_send_message',
      description:
        'Send a chat message to a Boss Zhipin candidate via host macOS Safari. Protected by DSH native user approval card unless dryRun=true. Uses configured defaultReplyTemplate if text is omitted.',
      parameters: {
        to: {
          type: 'string',
          required: true,
          description: 'Exact candidate name to verify and send to (`--to <name> --strict`).',
        },
        text: {
          type: 'string',
          description: 'Message body to send. Omit to use the configured default resume-request template.',
        },
        requestResume: {
          type: 'boolean',
          description: 'If true, also click Boss "求简历" after sending the message.',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, rehearse without actually sending or asking for write approval.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `${args.dryRun ? '[预演] ' : ''}向「${args.to}」发送 Boss 消息`,
        kind: 'execute',
        rawInput: {
          to: args.to,
          text: args.text || svc.defaultReplyTemplate,
          requestResume: Boolean(args.requestResume),
          dryRun: Boolean(args.dryRun),
        },
      }),
      execute: (args, exec) => {
        const body = (args.text || svc.defaultReplyTemplate).trim();
        const cliArgs = ['send', '--to', args.to, '--strict', '-t', body, '--json'];
        if (args.requestResume) cliArgs.push('--request-resume');
        if (args.dryRun) cliArgs.push('--dry-run');
        else cliArgs.push('--confirm');
        return execBossJson(
          svc,
          cliArgs,
          exec.signal,
          () =>
            args.dryRun
              ? `[预演完成] 未实际发送给「${args.to}」。`
              : `已向候选人「${args.to}」发送消息。`,
          Boolean(args.dryRun),
        );
      },
    }),

    defineTool({
      name: 'boss_greet_candidate',
      description:
        'Click "打招呼" (greet) on a Boss Zhipin candidate from the recommend/search list. Protected by DSH native user approval card unless dryRun=true.',
      parameters: {
        name: {
          type: 'string',
          description: 'Optional candidate name.',
        },
        geekId: {
          type: 'string',
          description: 'Candidate geekId (preferred when available).',
        },
        index: {
          type: 'integer',
          description: '1-based index on current recommend/search list.',
        },
        job: {
          type: 'string',
          description: 'Optional job position keyword.',
        },
        tab: {
          type: 'string',
          enum: ['recommend', 'featured'],
          description: 'Optional Boss recommend tab ("recommend" for 推荐, "featured" for 精选; excludes 最新).',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, rehearse without clicking greet.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `${args.dryRun ? '[预演] ' : ''}向候选人打招呼：${args.name || args.geekId || `#${args.index ?? '?'}`}`,
        kind: 'execute',
        rawInput: args,
      }),
      execute: (args, exec) => {
        const cliArgs = ['greet'];
        if (args.name) cliArgs.push(args.name);
        if (args.geekId) cliArgs.push('--geek-id', args.geekId);
        else if (typeof args.index === 'number') cliArgs.push('--index', String(args.index));
        if (args.job) cliArgs.push('--job', args.job);
        if (args.tab === 'featured' || args.tab === 'recommend') cliArgs.push('--tab', args.tab);
        if (args.dryRun) cliArgs.push('--dry-run');
        else cliArgs.push('--confirm');
        cliArgs.push('--json');
        return execBossJson(
          svc,
          cliArgs,
          exec.signal,
          () =>
            args.dryRun
              ? `[预演完成] 未实际打招呼（${args.name || args.geekId || `#${args.index ?? '?'}`}）。`
              : `已向候选人（${args.name || args.geekId || `#${args.index ?? '?'}`}）发起打招呼。`,
          Boolean(args.dryRun),
        );
      },
    }),

    defineTool({
      name: 'boss_chat_action',
      description:
        'Run an outbound Boss chat toolbar action (request attachment resume, agree resume, request WeChat, mark not-fit, or add remark). Protected by DSH native user approval card unless dryRun=true.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['request-attachment-resume', 'agree-resume', 'wechat', 'not-fit', 'remark'],
          description: 'Chat toolbar action to execute.',
        },
        to: {
          type: 'string',
          description: 'Candidate name to switch to first before running the action.',
        },
        remarkText: {
          type: 'string',
          description: 'Remark text (required when action is "remark").',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, rehearse without executing the write action.',
        },
      },
      output: { schema: STANDARD_OUTPUT_SCHEMA, render: renderStandardOutput },
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: `${args.dryRun ? '[预演] ' : ''}Boss 聊天操作：${args.action}${args.to ? `（${args.to}）` : ''}`,
        kind: 'execute',
        rawInput: args,
      }),
      async execute(args, exec) {
        if (args.to && !args.dryRun) {
          await svc.runCli(['chat', args.to, '--strict', '--json'], { signal: exec.signal });
        }
        const cliArgs = ['action', args.action, '--json'];
        if (args.action === 'remark' && args.remarkText) {
          cliArgs.push('--remark', args.remarkText);
        }
        if (args.dryRun) cliArgs.push('--dry-run');
        else cliArgs.push('--confirm');
        return execBossJson(
          svc,
          cliArgs,
          exec.signal,
          () =>
            args.dryRun
              ? `[预演完成] 未实际执行 ${args.action}。`
              : `已执行 Boss 聊天操作：${args.action}。`,
          Boolean(args.dryRun),
        );
      },
    }),
  ];

  for (const tool of tools) {
    ctx.tools.register(tool);
  }
}
