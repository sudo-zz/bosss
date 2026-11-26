#!/usr/bin/env node
/**
 * 招聘助手本地展示工作台启动器（独立命令：boss-desk，零 DSH 依赖）
 *
 * 专配 WorkBuddy / 千问办公 / 豆包工作 等带浏览器分屏的桌面 Agent：
 *   - 左侧在你的 Agent 聊天框对话（调用 boss CLI 操作 Safari、写入简历与台账）
 *   - 右侧浏览器打开本工作台（默认 http://127.0.0.1:7788），自动监听 ~/.boss-cli/ 变化实时刷新
 *
 * 用法（任意目录）：
 *   boss-desk
 *   boss-desk --port 7788 --no-open
 *   boss-desk --check-update
 *   boss-desk --update [局域网地址或本地 .tar.gz 路径]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTART_EXIT_CODE,
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdaterPaths,
  installUpdateFromTarball,
  readAppVersionInfo,
} from './updater.mjs';

const SCRIPT_REALPATH = realpathSync(fileURLToPath(import.meta.url));
const HERE = path.dirname(SCRIPT_REALPATH);
const ROOT = path.resolve(HERE, '..');

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
  if (!Number.isFinite(base) || base <= 0) return '7788';
  for (let p = base; p < base + 20; p += 1) {
    if (await isPortFree(p)) return String(p);
  }
  return '0';
}

function parseCliArgs(argv) {
  let port = process.env.DESK_PORT || '7788';
  let noOpen = false;
  let rebuild = false;
  let checkUpdate = false;
  let doUpdate = false;
  let updateSource = '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      port = argv[++i];
    } else if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length);
    } else if (arg === '--no-open') {
      noOpen = true;
    } else if (arg === '--rebuild') {
      rebuild = true;
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
    }
  }
  return { port, noOpen, rebuild, checkUpdate, doUpdate, updateSource };
}

function ensureBuilt(rebuild) {
  const deskIndex = path.join(ROOT, 'desk', 'dist', 'index.html');
  if (!rebuild && existsSync(deskIndex)) return;
  if (!existsSync(path.join(ROOT, 'desk', 'package.json'))) {
    throw new Error(`未找到预构建前端目录：${deskIndex}`);
  }
  console.log('▸ 构建招聘助手前端（desk/dist）...');
  const res = spawnSync('npm', ['--prefix', 'desk', 'run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error('构建前端失败');
  }
}

const opts = parseCliArgs(process.argv.slice(2));

if (opts.checkUpdate) {
  try {
    const res = await checkForUpdate(ROOT, opts.updateSource ? { sourceUrl: opts.updateSource } : {});
    console.log(`当前版本：v${res.currentVersion}`);
    console.log(`最新版本：v${res.latestVersion}（来源：${res.sourceLabel}）`);
    console.log(
      res.hasUpdate
        ? '状态：发现新版本，可运行 `boss-desk --update` 安装更新（不影响已有简历与台账）'
        : '状态：已是最新版本',
    );
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
    console.log('▸ 运行 `boss-desk` 即可启动新版本。');
    process.exit(0);
  } catch (error) {
    console.error(`❌ 更新失败：${error?.message || error}`);
    process.exit(1);
  }
}

ensureBuilt(opts.rebuild);

const selectedPort = await resolveAvailablePort(opts.port);
if (selectedPort !== String(opts.port) && String(opts.port) !== '0') {
  console.log(`▸ 端口 ${opts.port} 已被占用，自动切换至空闲端口 ${selectedPort}`);
}

const { currentVersion } = readAppVersionInfo(ROOT);
const serverEntry = path.join(ROOT, 'desk', 'server', 'index.mjs');
const serverArgs = [serverEntry];
if (!opts.noOpen) serverArgs.push('--open');

console.log('');
console.log(`招聘助手 · 纯静态展示工作台 (v${currentVersion})`);
console.log(`  地址 : http://127.0.0.1:${selectedPort}`);
console.log('  模式 : 只读展示 + 实时监听 ~/.boss-cli/ 自动刷新（Boss/Safari 动作由你的 Agent 对话触发）');
console.log('');

const child = spawn(process.execPath, serverArgs, {
  cwd: ROOT,
  env: { ...process.env, DESK_PORT: selectedPort },
  stdio: 'inherit',
});

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
    const nextScript = existsSync(path.join(installAppDir, 'scripts', 'boss-desk.mjs'))
      ? path.join(installAppDir, 'scripts', 'boss-desk.mjs')
      : SCRIPT_REALPATH;
    console.log('');
    console.log(`▸ 检测到更新重启指令，正在使用最新版本重启（端口 ${selectedPort}）...`);
    const relaunched = spawn(process.execPath, [nextScript, '--port', selectedPort, '--no-open'], {
      cwd: path.dirname(path.dirname(nextScript)),
      env: process.env,
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
