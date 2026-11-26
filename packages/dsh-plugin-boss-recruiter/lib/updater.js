/**
 * 招聘助手安全自更新模块（零数据影响）
 *
 * 原则：
 *   - 仅替换程序目录（~/.boss-recruiter/app），绝对不触碰 ~/.boss-cli/（简历 PDF、在线简历、台账、头像、配额）与 ~/.dsh/（模型凭证与对话）
 *   - 绝不覆盖开发者本地 Git 源码仓库（检测到 .git 时默认阻止覆盖源码）
 *   - 支持 3 种更新来源：
 *       1. 局域网更新服务（`npm run release:serve` 提供的 http://<IP>:8788）
 *       2. GitHub Releases（默认 sudo-zz/bosss；支持本机 gh 登录态或只读 Token）
 *       3. 离线压缩包（上传/传入 boss-recruiter-v*-darwin.tar.gz）
 *   - 原子目录切换 + 失败自动回滚 + SHA-256 校验
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const DEFAULT_GITHUB_REPO = 'sudo-zz/bosss';
export const RESTART_EXIT_CODE = 75;

export function getUpdaterPaths() {
  const home = homedir();
  const bossHome = path.join(home, '.boss-cli');
  const installRoot = process.env.BOSS_RECRUITER_HOME?.trim() || path.join(home, '.boss-recruiter');
  return {
    bossHome,
    configFile: path.join(bossHome, 'update-config.json'),
    installRoot,
    installAppDir: path.join(installRoot, 'app'),
    restartMarker: path.join(installRoot, '.restart-requested'),
  };
}

function safeReadJson(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readUpdateConfig() {
  const { configFile } = getUpdaterPaths();
  const raw = safeReadJson(configFile) || {};
  return {
    sourceUrl: String(process.env.BOSS_UPDATE_URL || raw.sourceUrl || '').trim(),
    githubRepo: String(raw.githubRepo || DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO,
    githubToken: String(raw.githubToken || '').trim(),
  };
}

export function saveUpdateConfig(patch = {}) {
  const { bossHome, configFile } = getUpdaterPaths();
  mkdirSync(bossHome, { recursive: true });
  const prev = safeReadJson(configFile) || {};
  const next = {
    sourceUrl: patch.sourceUrl !== undefined ? String(patch.sourceUrl || '').trim() : String(prev.sourceUrl || '').trim(),
    githubRepo:
      patch.githubRepo !== undefined
        ? String(patch.githubRepo || DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO
        : String(prev.githubRepo || DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO,
    githubToken:
      patch.githubToken !== undefined ? String(patch.githubToken || '').trim() : String(prev.githubToken || '').trim(),
  };
  writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return next;
}

export function maskConfig(cfg) {
  const token = cfg.githubToken || '';
  return {
    sourceUrl: cfg.sourceUrl || '',
    githubRepo: cfg.githubRepo || DEFAULT_GITHUB_REPO,
    hasToken: Boolean(token),
    tokenHint: token ? `${token.slice(0, 4)}••••${token.slice(-3)}` : '',
  };
}

export function readAppVersionInfo(appRoot) {
  const rootPkg = safeReadJson(path.join(appRoot, 'package.json')) || {};
  const pluginPkg =
    safeReadJson(path.join(appRoot, 'packages', 'dsh-plugin-boss-recruiter', 'package.json')) || {};
  return {
    currentVersion: String(rootPkg.version || '0.0.0').replace(/^v/i, ''),
    pluginVersion: String(pluginPkg.version || '0.0.0').replace(/^v/i, ''),
  };
}

/** 比较版本字符串（如 0.8.0-dsh vs 0.8.1-dsh）。返回 1 表示 a > b，-1 表示 a < b，0 表示相等。 */
export function compareVersions(aRaw, bRaw) {
  const parse = (raw) => {
    const clean = String(raw || '').trim().replace(/^v/i, '');
    const [core = '0.0.0', pre = ''] = clean.split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] || 0, nums[1] || 0, nums[2] || 0], pre };
  };
  const a = parse(aRaw);
  const b = parse(bRaw);
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i] ? 1 : -1;
  }
  if (a.pre === b.pre) return 0;
  return a.pre.localeCompare(b.pre) > 0 ? 1 : -1;
}

export function getUpdateStatus(appRoot) {
  const { installAppDir, bossHome } = getUpdaterPaths();
  const { currentVersion, pluginVersion } = readAppVersionInfo(appRoot);
  const isDevRepo = existsSync(path.join(appRoot, '.git'));
  const isInstalledBundle = path.resolve(appRoot) === path.resolve(installAppDir);
  const cfg = readUpdateConfig();

  return {
    currentVersion,
    pluginVersion,
    appRoot,
    installAppDir,
    dataDir: bossHome,
    isDevRepo,
    isInstalledBundle,
    canSelfUpdate: !isDevRepo,
    config: maskConfig(cfg),
  };
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function parseSha256Sums(text, assetName) {
  if (!text || !assetName) return '';
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && path.basename(m[2].trim()) === assetName) {
      return m[1].toLowerCase();
    }
  }
  return '';
}

async function fetchJsonWithTimeout(url, headers = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'boss-recruiter-updater', ...headers },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function tryGhReleaseLatest(repo) {
  try {
    const out = execFileSync('gh', ['api', `repos/${repo}/releases/latest`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export async function checkForUpdate(appRoot, overrides = {}) {
  const status = getUpdateStatus(appRoot);
  const saved = readUpdateConfig();
  const sourceUrl = String(overrides.sourceUrl ?? saved.sourceUrl ?? '').trim();
  const githubRepo = String(overrides.githubRepo ?? saved.githubRepo ?? DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO;
  const githubToken = String(
    overrides.githubToken ?? saved.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '',
  ).trim();

  // 1. 局域网 / 自定义 HTTP 更新源（推荐：人事电脑零 GitHub 登录）
  if (sourceUrl) {
    const manifestUrl = sourceUrl.endsWith('.json')
      ? sourceUrl
      : `${sourceUrl.replace(/\/+$/, '')}/latest.json`;
    let resp;
    try {
      resp = await fetchJsonWithTimeout(manifestUrl, { Accept: 'application/json' });
    } catch (error) {
      throw new Error(`无法连接更新地址 ${manifestUrl}：${error?.message || error}`);
    }
    if (!resp.ok || !resp.json) {
      throw new Error(`更新源返回异常（HTTP ${resp.status}）：${manifestUrl}`);
    }
    const m = resp.json;
    const latestVersion = String(m.version || '').replace(/^v/i, '');
    if (!latestVersion || !m.assetName) {
      throw new Error(`更新清单 latest.json 格式不完整（缺少 version 或 assetName）`);
    }
    const baseDir = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
    const downloadUrl = m.downloadUrl
      ? new URL(m.downloadUrl, baseDir).toString()
      : new URL(m.assetName, baseDir).toString();
    const hasUpdate = compareVersions(latestVersion, status.currentVersion) > 0;
    return {
      ok: true,
      channel: 'custom-url',
      sourceLabel: manifestUrl,
      currentVersion: status.currentVersion,
      latestVersion,
      pluginVersion: m.pluginVersion || '',
      hasUpdate,
      publishedAt: m.publishedAt || '',
      assetName: m.assetName,
      downloadUrl,
      sha256: String(m.sha256 || '').toLowerCase(),
      size: Number(m.size || 0),
      notes: String(m.notes || ''),
      canSelfUpdate: status.canSelfUpdate,
      isDevRepo: status.isDevRepo,
    };
  }

  // 2. GitHub Releases 更新源
  const apiUrl = `https://api.github.com/repos/${githubRepo}/releases/latest`;
  let release = null;
  let authMode = 'public';

  if (githubToken) {
    const resp = await fetchJsonWithTimeout(apiUrl, {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
    });
    if (resp.ok && resp.json) {
      release = resp.json;
      authMode = 'token';
    } else {
      throw new Error(`GitHub Release 检查失败（HTTP ${resp.status}），请确认 Token 拥有 repo 读取权限。`);
    }
  } else {
    // 先试公开访问，若私有仓库返回 404/401/403，再尝试本机 gh CLI
    const resp = await fetchJsonWithTimeout(apiUrl, { Accept: 'application/vnd.github+json' }).catch(() => ({
      ok: false,
      status: 0,
      json: null,
    }));
    if (resp.ok && resp.json) {
      release = resp.json;
      authMode = 'public';
    } else {
      const ghRelease = tryGhReleaseLatest(githubRepo);
      if (ghRelease) {
        release = ghRelease;
        authMode = 'gh';
      } else {
        const err = new Error(
          `仓库 ${githubRepo} 为私有仓库或当前无法直连 GitHub。请在下方填入「局域网更新地址」（如开发机运行 npm run release:serve 后的地址）或 GitHub Token，也可直接拖入新版 .tar.gz 安装包离线更新。`,
        );
        err.needAuth = true;
        throw err;
      }
    }
  }

  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const bundleAsset = assets.find((a) => /^boss-recruiter-v.*-darwin\.tar\.gz$/i.test(String(a.name || '')));
  if (!bundleAsset) {
    throw new Error(`GitHub Release ${release.tag_name || ''} 中未找到 macOS 安装包（boss-recruiter-v*-darwin.tar.gz）`);
  }

  // 尝试读取 SHA256SUMS.txt
  let expectedSha256 = '';
  const digest = String(bundleAsset.digest || '');
  if (digest.startsWith('sha256:')) {
    expectedSha256 = digest.slice('sha256:'.length).toLowerCase();
  } else {
    const sumsAsset = assets.find((a) => String(a.name || '') === 'SHA256SUMS.txt');
    if (sumsAsset && authMode !== 'gh') {
      const sumHeaders = authMode === 'token' ? { Authorization: `Bearer ${githubToken}`, Accept: 'application/octet-stream' } : {};
      const sumUrl = authMode === 'token' ? sumsAsset.url : sumsAsset.browser_download_url;
      const sumResp = await fetchJsonWithTimeout(sumUrl, sumHeaders).catch(() => null);
      if (sumResp?.ok && sumResp.text) {
        expectedSha256 = parseSha256Sums(sumResp.text, bundleAsset.name);
      }
    }
  }

  const hasUpdate = compareVersions(latestVersion, status.currentVersion) > 0;
  return {
    ok: true,
    channel: `github-${authMode}`,
    sourceLabel: `GitHub ${githubRepo}`,
    releaseTag: release.tag_name || '',
    releaseUrl: release.html_url || '',
    currentVersion: status.currentVersion,
    latestVersion,
    hasUpdate,
    publishedAt: release.published_at || '',
    assetName: bundleAsset.name,
    downloadUrl: bundleAsset.browser_download_url || '',
    assetApiUrl: bundleAsset.url || '',
    sha256: expectedSha256,
    size: Number(bundleAsset.size || 0),
    notes: String(release.body || ''),
    canSelfUpdate: status.canSelfUpdate,
    isDevRepo: status.isDevRepo,
  };
}

function findExtractedAppDir(extractDir) {
  const direct = path.join(extractDir, 'app');
  if (existsSync(path.join(direct, 'package.json'))) return direct;
  for (const entry of readdirSync(extractDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(extractDir, entry.name, 'app');
    if (existsSync(path.join(nested, 'package.json'))) return nested;
  }
  return null;
}

function assertValidBundleApp(appDir) {
  const required = [
    'package.json',
    'dist/cli/index.js',
    'desk/dist/index.html',
    'scripts/dsh-web.mjs',
    'packages/dsh-plugin-boss-recruiter/package.json',
  ];
  for (const rel of required) {
    if (!existsSync(path.join(appDir, rel))) {
      throw new Error(`更新包结构不完整，缺少必要文件：${rel}`);
    }
  }
  // 防御检查：禁止更新包携带候选人隐私或覆盖用户数据目录
  for (const forbidden of ['web/pipeline.json', 'data/tracker.json']) {
    if (existsSync(path.join(appDir, forbidden))) {
      throw new Error(`更新包异常包含不应打包的数据文件：${forbidden}`);
    }
  }
}

function refreshInstalledLinks(installAppDir) {
  const dshHome = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh');
  const pluginDir = path.join(installAppDir, 'packages', 'dsh-plugin-boss-recruiter');
  const profileDir = path.join(dshHome, 'profiles', 'boss-web');
  const pkgPath = path.join(profileDir, 'package.json');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies['dsh-plugin-boss-recruiter'] = `link:${pluginDir}`;
      pkg.dsh = pkg.dsh || {};
      pkg.dsh.profile = pkg.dsh.profile || {};
      pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
      if (!pkg.dsh.profile.bundles.includes('dsh-plugin-boss-recruiter')) {
        pkg.dsh.profile.bundles.push('dsh-plugin-boss-recruiter');
      }
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

      const nodeModulesDir = path.join(profileDir, 'node_modules');
      mkdirSync(nodeModulesDir, { recursive: true });
      const linkPath = path.join(nodeModulesDir, 'dsh-plugin-boss-recruiter');
      try {
        const st = lstatSync(linkPath);
        if (!st.isSymbolicLink() || path.resolve(path.dirname(linkPath), readlinkSync(linkPath)) !== pluginDir) {
          rmSync(linkPath, { recursive: true, force: true });
          symlinkSync(pluginDir, linkPath, 'dir');
        }
      } catch {
        symlinkSync(pluginDir, linkPath, 'dir');
      }
    } catch {
      /* 忽略 profile 刷新非致命错误，下次 boss-dsh 启动时也会自动修复 */
    }
  }
}

export function installUpdateFromTarball(tarballPath, options = {}) {
  const { appRoot, expectedSha256 = '', allowDevOverride = false } = options;
  const { installRoot, installAppDir } = getUpdaterPaths();

  if (appRoot && existsSync(path.join(appRoot, '.git')) && !allowDevOverride) {
    throw new Error(
      '当前运行在本地 Git 源码开发目录，为保护你的开发代码不会执行自覆盖更新；在人事电脑安装的发行版中点击即可自动替换 ~/.boss-recruiter/app。',
    );
  }

  if (!existsSync(tarballPath) || !statSync(tarballPath).isFile()) {
    throw new Error(`找不到更新安装包：${tarballPath}`);
  }

  if (expectedSha256) {
    const actual = sha256File(tarballPath);
    if (actual !== expectedSha256.toLowerCase()) {
      throw new Error(`安装包 SHA-256 校验失败（期望 ${expectedSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`);
    }
  }

  const prevVersion = existsSync(path.join(installAppDir, 'package.json'))
    ? readAppVersionInfo(installAppDir).currentVersion
    : appRoot
      ? readAppVersionInfo(appRoot).currentVersion
      : '0.0.0';

  const workDir = path.join(tmpdir(), `boss-recruiter-update-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });

  try {
    execFileSync('tar', ['-xzf', tarballPath, '-C', workDir], { stdio: 'pipe', timeout: 60000 });
    const extractedApp = findExtractedAppDir(workDir);
    if (!extractedApp) {
      throw new Error('更新包格式无效：未找到 app/package.json，请确认上传的是 boss-recruiter-v*-darwin.tar.gz');
    }
    assertValidBundleApp(extractedApp);
    const nextInfo = readAppVersionInfo(extractedApp);

    // 原子替换 ~/.boss-recruiter/app（绝不触碰 ~/.boss-cli/ 与 ~/.dsh/）
    mkdirSync(installRoot, { recursive: true });
    const stagingApp = path.join(installRoot, `app.new.${Date.now()}`);
    const backupApp = path.join(installRoot, `app.bak.${Date.now()}`);
    cpSync(extractedApp, stagingApp, { recursive: true });
    chmodSync(path.join(stagingApp, 'dist', 'cli', 'index.js'), 0o755);
    chmodSync(path.join(stagingApp, 'scripts', 'dsh-web.mjs'), 0o755);

    let movedOld = false;
    try {
      if (existsSync(installAppDir)) {
        renameSync(installAppDir, backupApp);
        movedOld = true;
      }
      renameSync(stagingApp, installAppDir);
      if (movedOld) {
        rmSync(backupApp, { recursive: true, force: true });
      }
    } catch (swapError) {
      rmSync(stagingApp, { recursive: true, force: true });
      if (movedOld && existsSync(backupApp) && !existsSync(installAppDir)) {
        renameSync(backupApp, installAppDir);
      }
      throw new Error(`替换程序目录失败（已自动回滚旧版本）：${swapError?.message || swapError}`);
    }

    refreshInstalledLinks(installAppDir);

    return {
      ok: true,
      previousVersion: prevVersion,
      updatedVersion: nextInfo.currentVersion,
      pluginVersion: nextInfo.pluginVersion,
      installAppDir,
      dataPreserved: true,
      restartRequired: true,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function downloadAndInstallUpdate(appRoot, options = {}) {
  const check = await checkForUpdate(appRoot, options);
  const saved = readUpdateConfig();
  const githubToken = String(
    options.githubToken ?? saved.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '',
  ).trim();
  const githubRepo = String(options.githubRepo ?? saved.githubRepo ?? DEFAULT_GITHUB_REPO).trim() || DEFAULT_GITHUB_REPO;

  const dlDir = path.join(tmpdir(), `boss-recruiter-dl-${Date.now()}`);
  mkdirSync(dlDir, { recursive: true });
  const tarPath = path.join(dlDir, check.assetName || 'update.tar.gz');

  try {
    if (check.channel === 'github-gh') {
      execFileSync(
        'gh',
        ['release', 'download', check.releaseTag, '-R', githubRepo, '-p', check.assetName, '-D', dlDir],
        { stdio: 'pipe', timeout: 120000 },
      );
    } else {
      const useAssetApi = check.channel === 'github-token' && check.assetApiUrl;
      const targetUrl = useAssetApi ? check.assetApiUrl : check.downloadUrl;
      const headers = { 'User-Agent': 'boss-recruiter-updater' };
      if (useAssetApi && githubToken) {
        headers.Authorization = `Bearer ${githubToken}`;
        headers.Accept = 'application/octet-stream';
      }
      const res = await fetch(targetUrl, { headers, redirect: 'follow' });
      if (!res.ok) {
        throw new Error(`下载安装包失败（HTTP ${res.status}）：${targetUrl}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) {
        throw new Error('下载到的安装包文件过小，可能下载不完整或权限不足');
      }
      writeFileSync(tarPath, buf);
    }

    const result = installUpdateFromTarball(tarPath, {
      appRoot,
      expectedSha256: check.sha256,
      allowDevOverride: Boolean(options.allowDevOverride),
    });
    return { ...result, check };
  } finally {
    rmSync(dlDir, { recursive: true, force: true });
  }
}

export function installUpdateFromBase64(appRoot, { filename = 'update.tar.gz', dataBase64, allowDevOverride = false }) {
  let clean = String(dataBase64 || '').trim();
  if (clean.startsWith('data:')) {
    const idx = clean.indexOf(',');
    if (idx >= 0) clean = clean.slice(idx + 1);
  }
  const buf = Buffer.from(clean.replace(/\s+/g, ''), 'base64');
  if (buf.length < 1024) {
    throw new Error('上传的安装包内容无效或过小');
  }
  if (buf.length > 35 * 1024 * 1024) {
    throw new Error('安装包超过 35MB 大小限制');
  }
  // gzip magic header: 0x1f 0x8b
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
    throw new Error('请上传有效的 .tar.gz 安装包（gzip 格式）');
  }
  const dlDir = path.join(tmpdir(), `boss-recruiter-upload-${Date.now()}`);
  mkdirSync(dlDir, { recursive: true });
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'update.tar.gz';
  const tarPath = path.join(dlDir, safeName);
  try {
    writeFileSync(tarPath, buf);
    return installUpdateFromTarball(tarPath, { appRoot, allowDevOverride });
  } finally {
    rmSync(dlDir, { recursive: true, force: true });
  }
}

export function markRestartRequested() {
  const { installRoot, restartMarker } = getUpdaterPaths();
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(restartMarker, `${Date.now()}\n`, 'utf8');
  return restartMarker;
}
