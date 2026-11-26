import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '../..');

export const DEFAULT_REPLY_TEMPLATE = [
  '你好，感谢投递，公司地点在奉贤区南上海科创中心,请问是否方便通勤？',
  '我们的面试流程是一轮线上初面 + 现场进行技术面试（需要携带电脑）,请问是否方便呢？',
  '可以的话麻烦发送一份附件简历过来，谢谢！',
].join('\n');

export const Config = z.object({
  cliPath: z
    .string()
    .default('')
    .description(
      'Optional path to boss CLI entry (dist/cli/index.js or boss binary). Empty auto-detects sibling repo dist or PATH.',
    ),
  deskDistDir: z
    .string()
    .default('')
    .description(
      'Optional built 招聘助手 (desk/dist) directory. Empty auto-detects bundled desk-dist or sibling repo desk/dist.',
    ),
  defaultReplyTemplate: z
    .string()
    .default(DEFAULT_REPLY_TEMPLATE)
    .description('Default resume-request & interview flow message template used when drafting or sending replies.'),
  maxDailySend: z
    .natural()
    .default(40)
    .description('Maximum outbound Boss chat messages allowed per day (BOSS_MAX_DAILY_SEND).'),
  maxDailyGreet: z
    .natural()
    .default(20)
    .description('Maximum outbound Boss greetings allowed per day (BOSS_MAX_DAILY_GREET).'),
  maxDailyPreview: z
    .natural()
    .default(30)
    .description('Maximum online resume previews allowed per day (BOSS_MAX_DAILY_PREVIEW).'),
  minWriteIntervalSec: z
    .natural()
    .default(10)
    .description('Minimum interval in seconds between outbound Boss write actions (BOSS_MIN_WRITE_INTERVAL_SEC).'),
  enableWebDesk: z
    .boolean()
    .default(true)
    .description('Mount the embedded 招聘助手 recruiting workbench UI on DSH WebServer when running `dsh web`.'),
  webDeskPath: z
    .string()
    .default('/boss-desk')
    .description('Mount path prefix on DSH WebServer (no trailing slash).'),
  cliTimeoutMs: z
    .natural()
    .default(180000)
    .description('Default timeout in milliseconds for Boss Safari CLI invocations.'),
});

function normalizePrefix(raw) {
  const trimmed = String(raw || '/boss-desk').trim();
  if (!trimmed || trimmed === '/') return '/boss-desk';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.replace(/\/+$/, '');
}

function safeReadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export class BossRecruiterService extends Service {
  static Config = Config;

  constructor(ctx, config) {
    super(ctx, 'bossRecruiter', true);
    this.config = config;
    this.bossHome = path.join(homedir(), '.boss-cli');
    mkdirSync(this.bossHome, { recursive: true });
    mkdirSync(path.join(this.bossHome, 'resumes', 'pdf'), { recursive: true });
    mkdirSync(path.join(this.bossHome, 'resumes', 'online'), { recursive: true });
    mkdirSync(path.join(this.bossHome, 'sourcing'), { recursive: true });
  }

  get webDeskPath() {
    return normalizePrefix(this.config.webDeskPath);
  }

  get defaultReplyTemplate() {
    return (this.config.defaultReplyTemplate || DEFAULT_REPLY_TEMPLATE).trim();
  }

  resolveCliInvocation() {
    const configured = (this.config.cliPath || '').trim();
    if (configured) {
      if (configured.endsWith('.js') || configured.endsWith('.mjs')) {
        return { command: process.execPath, prefixArgs: [configured], cwd: path.dirname(configured) };
      }
      return { command: configured, prefixArgs: [], cwd: process.cwd() };
    }

    const candidates = [
      path.join(REPO_ROOT, 'dist', 'cli', 'index.js'),
      path.join(PLUGIN_ROOT, 'node_modules', '@joohw', 'boss-cli', 'dist', 'cli', 'index.js'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { command: process.execPath, prefixArgs: [candidate], cwd: REPO_ROOT };
      }
    }
    return { command: 'boss', prefixArgs: [], cwd: process.cwd() };
  }

  resolveDeskDistDir() {
    const configured = (this.config.deskDistDir || '').trim();
    if (configured && existsSync(path.join(configured, 'index.html'))) {
      return configured;
    }
    const candidates = [
      path.join(PLUGIN_ROOT, 'desk-dist'),
      path.join(REPO_ROOT, 'desk', 'dist'),
    ];
    for (const dir of candidates) {
      if (existsSync(path.join(dir, 'index.html'))) {
        return dir;
      }
    }
    return null;
  }

  resolveRepoPaths() {
    const webDir = path.join(REPO_ROOT, 'web');
    const evalDir = (process.env.EVAL_DIR || '').trim();
    return {
      repoRoot: REPO_ROOT,
      bossHome: this.bossHome,
      pipelineFile: path.join(webDir, 'pipeline.json'),
      evalDataFile: path.join(webDir, 'data.js'),
      evalAssetsDir: path.join(webDir, 'assets'),
      buildScript: path.join(webDir, 'build.mjs'),
      resumePdfDir: path.join(this.bossHome, 'resumes', 'pdf'),
      resumeOnlineDir: path.join(this.bossHome, 'resumes', 'online'),
      resumeScreenshotDir: path.join(this.bossHome, '.cache', 'resume-screenshots'),
      resumeCacheDir: path.join(this.bossHome, '.cache', 'resumes'),
      sourcingDir: path.join(this.bossHome, 'sourcing'),
      evalPdfDirs: [path.join(webDir, 'pdfs'), ...(evalDir ? [path.join(evalDir, 'pdfs')] : [])],
      avatarDirs: [
        path.join(this.bossHome, 'avatars'),
        path.join(webDir, 'avatars'),
      ],
    };
  }

  buildCliEnv() {
    return {
      ...process.env,
      BOSS_MAX_DAILY_SEND: String(this.config.maxDailySend),
      BOSS_MAX_DAILY_GREET: String(this.config.maxDailyGreet),
      BOSS_MAX_DAILY_PREVIEW: String(this.config.maxDailyPreview),
      BOSS_MIN_WRITE_INTERVAL_SEC: String(this.config.minWriteIntervalSec),
    };
  }

  async runCli(args, options = {}) {
    if (process.platform !== 'darwin') {
      throw new Error('dsh-plugin-boss-recruiter requires macOS Safari.app (darwin host).');
    }
    const { command, prefixArgs, cwd } = this.resolveCliInvocation();
    const timeoutMs = options.timeoutMs ?? this.config.cliTimeoutMs ?? 180000;
    const signal = options.signal;

    return new Promise((resolvePromise, rejectPromise) => {
      const child = execFile(
        command,
        [...prefixArgs, ...args],
        {
          cwd,
          env: this.buildCliEnv(),
          maxBuffer: 12 * 1024 * 1024,
          timeout: timeoutMs,
          signal,
        },
        (error, stdout, stderr) => {
          const out = String(stdout || '').trim();
          const err = String(stderr || '').trim();
          if (error) {
            if (signal?.aborted || error.name === 'AbortError') {
              rejectPromise(new Error(`Boss CLI cancelled while running: boss ${args.join(' ')}`));
              return;
            }
            const parsedErr = tryParseLastJson(out) || tryParseLastJson(err);
            const message =
              parsedErr?.error ||
              parsedErr?.manualInterventionMessage ||
              err ||
              out ||
              error.message;
            const wrapped = new Error(`Boss CLI failed (${args[0] || 'cmd'}): ${message}`);
            wrapped.stdout = out;
            wrapped.stderr = err;
            wrapped.parsed = parsedErr;
            rejectPromise(wrapped);
            return;
          }
          const parsed = tryParseLastJson(out);
          resolvePromise({
            stdout: out,
            stderr: err,
            data: parsed,
          });
        },
      );
      child.on('error', () => {
        /* handled by execFile callback */
      });
    });
  }

  readQuota() {
    const file = path.join(this.bossHome, 'quota.json');
    const raw = safeReadJson(file);
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const counts = raw && raw.date === todayKey && raw.counts ? raw.counts : {};
    const limits = {
      greet: this.config.maxDailyGreet,
      send: this.config.maxDailySend,
      preview: this.config.maxDailyPreview,
      deep_search_match: 10,
      not_fit: 20,
      wechat: 15,
      request_resume: 30,
      agree_resume: 50,
      remark: 100,
    };
    const quotas = {};
    for (const [k, limit] of Object.entries(limits)) {
      const used = Number(counts[k] || 0);
      quotas[k] = { used, limit, remaining: Math.max(0, limit - used) };
    }
    return {
      date: todayKey,
      writeDefaultMode: 'dsh-approval-gated (dry-run or user-approved --confirm)',
      minWriteIntervalSec: this.config.minWriteIntervalSec,
      quotas,
      defaultReplyTemplate: this.defaultReplyTemplate,
    };
  }

  readTracker() {
    const file = path.join(this.bossHome, 'tracker.json');
    const raw = safeReadJson(file);
    if (!raw || typeof raw.candidates !== 'object') {
      return { version: 1, updatedAt: new Date().toISOString(), candidates: {} };
    }
    return raw;
  }

  readUnreadInspect() {
    return safeReadJson(path.join(this.bossHome, 'unread-inspect.json'));
  }

  readSourcingSnapshots() {
    const dir = path.join(this.bossHome, 'sourcing');
    if (!existsSync(dir)) return [];
    const out = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const snap = safeReadJson(path.join(dir, file));
      if (!snap || !Array.isArray(snap.candidates)) continue;
      const rawTab = String(snap.tab || '').toLowerCase();
      const tab = rawTab === 'featured' || rawTab === 'selected' || rawTab === '精选' ? 'featured' : 'recommend';
      for (const c of snap.candidates) {
        if (!c?.name) continue;
        out.push({
          ...c,
          sourceTab: tab,
          job: snap.job || '默认岗位',
          fetchedAt: snap.fetchedAt || '',
        });
      }
    }
    return out;
  }

  async rebuildPipelineIfAvailable(signal) {
    const { buildScript, repoRoot } = this.resolveRepoPaths();
    if (!existsSync(buildScript)) return false;
    await new Promise((resolvePromise, rejectPromise) => {
      execFile(
        process.execPath,
        [buildScript],
        { cwd: repoRoot, timeout: 120000, signal, maxBuffer: 8 * 1024 * 1024 },
        (error) => {
          if (error) rejectPromise(error);
          else resolvePromise();
        },
      );
    });
    return true;
  }
}

export function tryParseLastJson(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const idx = Math.max(trimmed.lastIndexOf('\n{'), trimmed.lastIndexOf('\n['));
    if (idx >= 0) {
      try {
        return JSON.parse(trimmed.slice(idx + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default BossRecruiterService;
