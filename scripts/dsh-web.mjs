#!/usr/bin/env node
/**
 * 一键启动 DeepSeek Harness + 招聘助手插件（dsh-plugin-boss-recruiter）
 *
 * 自动完成：
 *   1. 检查并按需构建 boss CLI（dist/cli/index.js）与 招聘助手前端（desk/dist）
 *   2. 在 ~/.dsh/profiles/<profile> 初始化基于官方 web 模板的配置（复用 ~/.dsh 凭证与会话）
 *   3. 无需全局 pnpm，自动把 packages/dsh-plugin-boss-recruiter 挂载到该 profile
 *   4. 启动真实 dsh web，并在同一端口同时提供 DSH 对话界面与 /boss-desk/ 招聘助手工作台
 *
 * 用法（任意目录）：
 *   boss-dsh
 *   boss-dsh --port 3788 --no-open
 *   boss-dsh --check-update
 *   boss-dsh --update [局域网地址或本地 .tar.gz 路径]
 *   boss-dsh --profile web --rebuild
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTART_EXIT_CODE,
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdaterPaths,
  installUpdateFromTarball,
} from '../packages/dsh-plugin-boss-recruiter/lib/updater.js';

const SCRIPT_REALPATH = realpathSync(fileURLToPath(import.meta.url));
const HERE = path.dirname(SCRIPT_REALPATH);
const ROOT = path.resolve(HERE, '..');
const PLUGIN_DIR = path.join(ROOT, 'packages', 'dsh-plugin-boss-recruiter');
const PLUGIN_NAME = 'dsh-plugin-boss-recruiter';

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function resolveAvailablePort(requested) {
  const base = Number.parseInt(String(requested), 10);
  if (!Number.isFinite(base) || base === 0) return '0';
  for (let p = base; p < base + 20; p += 1) {
    if (await isPortFree(p)) return String(p);
  }
  return '0';
}

function parseCliArgs(argv) {
  let profile = 'boss-web';
  let port = process.env.DSH_BOSS_PORT || '3788';
  let rebuild = false;
  let noOpen = false;
  let drySetup = false;
  let checkUpdate = false;
  let doUpdate = false;
  let updateSource = '';
  const passthrough = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg === '--port' && argv[i + 1]) {
      port = argv[++i];
    } else if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length);
    } else if (arg === '--rebuild') {
      rebuild = true;
    } else if (arg === '--no-open') {
      noOpen = true;
    } else if (arg === '--dry-setup') {
      drySetup = true;
    } else if (arg === '--check-update') {
      checkUpdate = true;
    } else if (arg === '--update') {
      doUpdate = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        updateSource = argv[++i];
      }
    } else if (arg.startsWith('--update=')) {
      doUpdate = true;
      updateSource = arg.slice('--update='.length);
    } else {
      passthrough.push(arg);
    }
  }
  return { profile, port, rebuild, noOpen, drySetup, checkUpdate, doUpdate, updateSource, passthrough };
}

function runSyncOrFail(cmd, args, cwd = ROOT, env = process.env) {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`命令执行失败（exit ${res.status}）: ${cmd} ${args.join(' ')}`);
  }
}

function ensureDshAvailable() {
  const res = spawnSync('dsh', ['--version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    console.error('❌ 未检测到 `dsh` 命令。请先安装 DeepSeek Harness：');
    console.error('   npm install -g @deepseek-ai/dsh');
    process.exit(1);
  }
  return (res.stdout || '').trim();
}

function ensureBuilt(rebuild) {
  const cliEntry = path.join(ROOT, 'dist', 'cli', 'index.js');
  const deskIndex = path.join(ROOT, 'desk', 'dist', 'index.html');
  if (rebuild || !existsSync(cliEntry)) {
    console.log('▸ 构建 boss CLI...');
    runSyncOrFail('npm', ['run', 'build'], ROOT);
  }
  if (rebuild || !existsSync(deskIndex)) {
    console.log('▸ 构建 招聘助手前端（desk/dist）...');
    runSyncOrFail('npm', ['--prefix', 'desk', 'run', 'build'], ROOT);
  }
}

function resolveDshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh');
}

function ensureProfileLinked(dshHome, profile) {
  const profileDir = path.join(dshHome, 'profiles', profile);
  const pkgPath = path.join(profileDir, 'package.json');

  if (!existsSync(pkgPath)) {
    console.log(`▸ 初始化 DSH profile「${profile}」（基于官方 web 模板）...`);
    const initArgs =
      profile === 'web'
        ? ['--profile', 'web', '--dump-config']
        : ['--profile', profile, '--from-default-profile', 'web', '--dump-config'];
    const initRes = spawnSync('dsh', initArgs, {
      cwd: ROOT,
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (initRes.status !== 0 || !existsSync(pkgPath)) {
      throw new Error(`初始化 profile 失败：\n${initRes.stderr || initRes.stdout}`);
    }
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  const expectedSpec = `link:${PLUGIN_DIR}`;
  let changed = false;

  if (pkg.dependencies[PLUGIN_NAME] !== expectedSpec) {
    pkg.dependencies[PLUGIN_NAME] = expectedSpec;
    changed = true;
  }
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (!pkg.dsh.profile.bundles.includes(PLUGIN_NAME)) {
    pkg.dsh.profile.bundles.push(PLUGIN_NAME);
    changed = true;
  }
  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }

  const nodeModulesDir = path.join(profileDir, 'node_modules');
  mkdirSync(nodeModulesDir, { recursive: true });
  const linkPath = path.join(nodeModulesDir, PLUGIN_NAME);

  let needLink = true;
  try {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink() && path.resolve(path.dirname(linkPath), readlinkSync(linkPath)) === PLUGIN_DIR) {
      needLink = false;
    } else {
      rmSync(linkPath, { recursive: true, force: true });
    }
  } catch {
    /* does not exist */
  }
  if (needLink) {
    symlinkSync(PLUGIN_DIR, linkPath, 'dir');
  }

  return profileDir;
}

const opts = parseCliArgs(process.argv.slice(2));

if (opts.checkUpdate) {
  try {
    const res = await checkForUpdate(ROOT, opts.updateSource ? { sourceUrl: opts.updateSource } : {});
    console.log(`当前版本：v${res.currentVersion}`);
    console.log(`最新版本：v${res.latestVersion}（来源：${res.sourceLabel}）`);
    console.log(res.hasUpdate ? '状态：发现新版本，可运行 `boss-dsh --update` 安装更新（不影响已有简历与台账）' : '状态：已是最新版本');
    process.exit(0);
  } catch (error) {
    console.error(`❌ 检查更新失败：${error?.message || error}`);
    process.exit(1);
  }
}

if (opts.doUpdate) {
  try {
    let result;
    if (opts.updateSource && existsSync(opts.updateSource)) {
      console.log(`▸ 正在从本地安装包更新：${opts.updateSource}`);
      result = installUpdateFromTarball(path.resolve(opts.updateSource), { appRoot: ROOT });
    } else {
      console.log('▸ 正在检查并拉取最新版本（保留 ~/.boss-cli 简历与台账数据）...');
      result = await downloadAndInstallUpdate(ROOT, opts.updateSource ? { sourceUrl: opts.updateSource } : {});
    }
    console.log(`✓ 更新成功：v${result.previousVersion} → v${result.updatedVersion}`);
    console.log('✓ 已完整保留 ~/.boss-cli/ 中的本地简历、PDF、在线简历与台账数据。');
    console.log('▸ 运行 `boss-dsh` 即可启动新版本。');
    process.exit(0);
  } catch (error) {
    console.error(`❌ 更新失败：${error?.message || error}`);
    process.exit(1);
  }
}

const dshVersion = ensureDshAvailable();
ensureBuilt(opts.rebuild);

const dshHome = resolveDshHome();
const profileDir = ensureProfileLinked(dshHome, opts.profile);
const selectedPort = opts.drySetup ? String(opts.port) : await resolveAvailablePort(opts.port);
if (!opts.drySetup && selectedPort !== String(opts.port) && String(opts.port) !== '0') {
  console.log(`▸ 端口 ${opts.port} 已被占用，自动切换至空闲端口 ${selectedPort}`);
}

const dshArgs = ['--profile', opts.profile, '--port', selectedPort];
if (opts.noOpen) dshArgs.push('--no-open');
dshArgs.push(...opts.passthrough);

console.log('');
console.log(`招聘助手 × DeepSeek Harness (${dshVersion})`);
console.log(`  Profile : ${opts.profile} (${profileDir})`);
console.log(`  Plugin  : ${PLUGIN_NAME} -> ${PLUGIN_DIR}`);
console.log(`  Command : dsh ${dshArgs.join(' ')}`);
console.log('');

if (opts.drySetup) {
  console.log('✓ 仅准备环境模式（--dry-setup），未启动服务。');
  process.exit(0);
}

const child = spawn('dsh', dshArgs, {
  cwd: ROOT,
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: ['inherit', 'pipe', 'pipe'],
});

let bannerPrinted = false;
function forward(stream, chunk) {
  const text = chunk.toString('utf8');
  stream.write(text);
  if (!bannerPrinted) {
    const match = text.match(/https?:\/\/127\.0\.0\.1:(\d+)\/\?token=\S+/);
    if (match) {
      bannerPrinted = true;
      const origin = `http://127.0.0.1:${match[1]}`;
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  DSH AI 对话 & 模型设置 : ${match[0]}`);
      console.log(`  招聘助手工作台（同端口）: ${origin}/boss-desk/`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
    }
  }
}

child.stdout.on('data', (c) => forward(process.stdout, c));
child.stderr.on('data', (c) => forward(process.stderr, c));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
  });
}

child.on('exit', (code, signal) => {
  const { restartMarker, installAppDir } = getUpdaterPaths();
  const wantsRestart = code === RESTART_EXIT_CODE || existsSync(restartMarker);
  if (wantsRestart) {
    rmSync(restartMarker, { force: true });
    const nextScript = existsSync(path.join(installAppDir, 'scripts', 'dsh-web.mjs'))
      ? path.join(installAppDir, 'scripts', 'dsh-web.mjs')
      : SCRIPT_REALPATH;
    console.log('');
    console.log(`▸ 检测到更新重启指令，正在使用最新版本重启（端口 ${selectedPort}）...`);
    const nextArgs = ['--profile', opts.profile, '--port', selectedPort, '--no-open', ...opts.passthrough];
    const relaunched = spawn(process.execPath, [nextScript, ...nextArgs], {
      cwd: path.dirname(path.dirname(nextScript)),
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: 'inherit',
    });
    relaunched.on('exit', (c, s) => {
      if (s) process.kill(process.pid, s);
      process.exit(c ?? 0);
    });
    return;
  }
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
