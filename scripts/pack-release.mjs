#!/usr/bin/env node
/**
 * 招聘助手 macOS 发行版打包脚本（零 DSH、零编译、零隐私数据）
 *
 * 产出（./release/）：
 *   1. boss-recruiter-v<version>-darwin.tar.gz   — 极简预构建一键安装包（boss CLI + boss-desk 只读展示台 + Agent Skill）
 *   2. SHA256SUMS.txt                            — SHA-256 校验清单
 *   3. latest.json                               — 直连 GitHub CDN 检查更新清单
 *
 * 安全门禁：
 *   - 严禁打入 web/pipeline.json、web/data.js、web/avatars、data/、dashboard/、.env、候选人 PDF/截图
 *   - 绝不修改本机 ~/.boss-cli/ 与本地工作数据
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RELEASE_DIR = path.join(ROOT, 'release');

const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const APP_VERSION = String(rootPkg.version || '0.9.0');
const BUNDLE_NAME = `boss-recruiter-v${APP_VERSION}-darwin`;

function run(cmd, args, cwd = ROOT, extraEnv = {}) {
  execFileSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function listAllFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllFiles(full, base));
    } else {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

function assertZeroPii(stageRoot) {
  const files = listAllFiles(stageRoot);
  const bannedNames = new Set([
    'pipeline.json',
    'data.js',
    'tracker.json',
    'unread-inspect.json',
    'inspect-xinmeiti.json',
    'candidates-scored.json',
    'quota.json',
    'audit-log.jsonl',
    'shortlist-report.md',
    '.env',
    '.env.deploy',
    '.DS_Store',
  ]);
  const bannedPrefixes = ['app/web/', 'app/data/', 'app/dashboard/', 'app/desk/src/', 'app/desk/node_modules/'];
  const violations = [];

  for (const rel of files) {
    const base = path.basename(rel);
    if (bannedNames.has(base)) violations.push(`banned file: ${rel}`);
    if (bannedPrefixes.some((p) => rel.startsWith(p))) violations.push(`banned dir: ${rel}`);
    if (rel.toLowerCase().endsWith('.pdf')) violations.push(`pdf leak: ${rel}`);
    if (rel.includes('/avatars/') || rel.includes('/resumes/')) violations.push(`resume/avatar leak: ${rel}`);
  }
  if (violations.length > 0) {
    throw new Error(`发布门禁失败（检测到隐私数据或禁止文件）：\n${violations.join('\n')}`);
  }
  return files.length;
}

function buildInstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

# 招聘助手 macOS 安装脚本（零 DSH、零编译、新机器初始空库）
# - 注册独立全局命令 boss 与 boss-desk
# - 自动把 boss-safari-recruiter Skill 同步到本机已安装的桌面 Agent（WorkBuddy / Claude / Codex / OpenClaw 等）
# - 绝不覆盖 ~/.boss-cli/ 中已有简历与台账数据

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "❌ 本安装包仅支持 macOS（需要驱动本机 Safari.app）。"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="\${SCRIPT_DIR}/app"
INSTALL_ROOT="\${BOSS_RECRUITER_HOME:-\$HOME/.boss-recruiter}"
APP_DEST="\${INSTALL_ROOT}/app"

export PATH="\${INSTALL_ROOT}/node/bin:/opt/homebrew/bin:/usr/local/bin:\${HOME}/.local/bin:\${PATH}"

echo ""
echo "============================================================"
echo "  招聘助手（boss + boss-desk）安装程序 (v${APP_VERSION})"
echo "============================================================"
echo ""

# 1. 检查 Node.js >= 22
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js。请先安装 Node.js >= 22，或改用一键在线脚本自动准备 Node："
  echo "   curl -fsSL https://raw.githubusercontent.com/sudo-zz/bosss/main/install.sh | bash"
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "\${NODE_MAJOR}" -lt 22 ]]; then
  echo "❌ 当前 Node.js 版本为 $(node -v)，需要 >= v22.0.0。"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# 2. 安装预构建程序到 ~/.boss-recruiter/app（零编译、零隐私数据）
echo "▸ 正在安装程序文件到 \${APP_DEST} ..."
mkdir -p "\${INSTALL_ROOT}"
rm -rf "\${APP_DEST}"
cp -R "\${APP_SRC}" "\${APP_DEST}"
chmod +x "\${APP_DEST}/dist/cli/index.js" "\${APP_DEST}/scripts/boss-desk.mjs"

# 3. 注册全局命令 boss 与 boss-desk
BIN_DIR="\${BOSS_BIN_DIR:-}"
if [[ -n "\${BIN_DIR}" ]]; then
  mkdir -p "\${BIN_DIR}"
else
  NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
  for candidate in "\${NPM_PREFIX}/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
    if [[ -n "\${candidate}" && -d "\${candidate}" && -w "\${candidate}" ]]; then
      BIN_DIR="\${candidate}"
      break
    fi
  done
  if [[ -z "\${BIN_DIR}" ]]; then
    BIN_DIR="\${HOME}/.local/bin"
    mkdir -p "\${BIN_DIR}"
  fi
fi

ln -sfn "\${APP_DEST}/dist/cli/index.js" "\${BIN_DIR}/boss"
ln -sfn "\${APP_DEST}/scripts/boss-desk.mjs" "\${BIN_DIR}/boss-desk"
echo "✓ 已注册全局命令：\${BIN_DIR}/boss 与 \${BIN_DIR}/boss-desk"

# 4. 同步 boss-safari-recruiter Skill 到本机已安装的桌面 Agent 目录（WorkBuddy 等，兼容 macOS bash 3.2）
SKILL_SRC="\${APP_DEST}/skills/boss-safari-recruiter"
if [[ -d "\${SKILL_SRC}" ]]; then
  SYNCED_COUNT=0
  for agent_root in "\${HOME}/.workbuddy" "\${HOME}/.claude" "\${HOME}/.codex" "\${HOME}/.gemini/config" "\${HOME}/.openclaw" "\${HOME}/.agents"; do
    if [[ -d "\${agent_root}" ]]; then
      mkdir -p "\${agent_root}/skills"
      rm -rf "\${agent_root}/skills/boss-safari-recruiter"
      cp -R "\${SKILL_SRC}" "\${agent_root}/skills/boss-safari-recruiter"
      echo "✓ 已同步 Skill 到：\${agent_root}/skills/boss-safari-recruiter"
      SYNCED_COUNT=$((SYNCED_COUNT + 1))
    fi
  done
  if [[ "\${SYNCED_COUNT}" -eq 0 ]]; then
    echo "ℹ️  Skill 已内置于 \${SKILL_SRC}（在 WorkBuddy 等 Agent 中指向该目录即可加载）"
  fi
fi

# 5. 初始化空的本地数据目录（绝不覆盖已有文件）
mkdir -p "\${HOME}/.boss-cli/resumes/pdf" "\${HOME}/.boss-cli/resumes/online" "\${HOME}/.boss-cli/sourcing" "\${HOME}/.boss-cli/avatars" "\${HOME}/.boss-cli/jd" "\${HOME}/.boss-cli/eval"
echo "✓ 本地数据目录已就绪：\${HOME}/.boss-cli（全新安装初始为空）"

# 6. 生成双击启动图标文件
LAUNCHER_CMD="\${INSTALL_ROOT}/启动招聘助手.command"
cat > "\${LAUNCHER_CMD}" <<'EOF_LAUNCHER'
#!/usr/bin/env bash
INSTALL_ROOT="\${BOSS_RECRUITER_HOME:-\$HOME/.boss-recruiter}"
export PATH="\$INSTALL_ROOT/node/bin:/opt/homebrew/bin:/usr/local/bin:\$HOME/.local/bin:\$PATH"
exec boss-desk
EOF_LAUNCHER
chmod +x "\${LAUNCHER_CMD}"
echo "✓ 已生成双击启动文件：\${LAUNCHER_CMD}"

echo ""
echo "============================================================"
echo "  安装完成！首次使用只需 3 步："
echo "============================================================"
echo ""
if [[ ":\${PATH}:" != *":\${BIN_DIR}:"* ]]; then
  echo "⚠️  请先将 \${BIN_DIR} 加入 PATH（写入 ~/.zshrc 后重开终端）："
  echo "   export PATH=\\"\${BIN_DIR}:\\\$PATH\\""
  echo ""
fi
echo "1. 开启 Safari 自动化权限（仅需一次）："
echo "   Safari → 设置 → 高级 → 勾选「显示网页开发者功能」"
echo "   顶部菜单栏「开发」→ 勾选「允许来自 Apple 事件的 JavaScript」"
echo ""
echo "2. 在 Safari 登录 Boss 直聘招聘端："
echo "   https://www.zhipin.com/web/chat/index"
echo ""
echo "3. 双击「启动招聘助手.command」（或在终端运行 boss-desk）打开 http://127.0.0.1:7788"
echo "   - 在 WorkBuddy / 千问办公 / 豆包工作 左侧对话让 Agent 执行抓取、归档 PDF、读在线简历或回复"
echo "   - 右侧浏览器页面自动实时刷新展示；右上角「检查更新」可一键从 GitHub 升级且保留全部数据"
echo ""
`;
}

function buildUninstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="\${BOSS_RECRUITER_HOME:-\$HOME/.boss-recruiter}"
APP_DEST="\${INSTALL_ROOT}/app"

echo "▸ 正在卸载招聘助手程序（保留你的 ~/.boss-cli 本地简历与台账数据）..."

NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
for dir in "\${NPM_PREFIX}/bin" "/opt/homebrew/bin" "/usr/local/bin" "\${HOME}/.local/bin"; do
  for bin in boss boss-desk; do
    if [[ -L "\${dir}/\${bin}" ]]; then
      target="$(readlink "\${dir}/\${bin}" || true)"
      if [[ "\${target}" == "\${APP_DEST}"* ]]; then
        rm -f "\${dir}/\${bin}"
        echo "  ✓ 已移除命令 \${dir}/\${bin}"
      fi
    fi
  done
done

rm -rf "\${APP_DEST}"
rm -f "\${INSTALL_ROOT}/启动招聘助手.command" "\${HOME}/Desktop/启动招聘助手.command"
echo "✓ 已卸载程序。"
echo "ℹ️  本地候选人台账与简历存档保留在 ~/.boss-cli/（如需彻底清空请手动删除）。"
`;
}

function buildInstallReadme() {
  return [
    `# 招聘助手 macOS 发行包 (v${APP_VERSION})`,
    '',
    '零 DSH、零编译、零候选人隐私数据、新机器初始为空库。专配 WorkBuddy / 千问办公 / 豆包工作 等带浏览器分屏的桌面 Agent 使用。',
    '',
    '## 一键安装（推荐）',
    '```bash',
    'curl -fsSL https://raw.githubusercontent.com/sudo-zz/bosss/main/install.sh | bash',
    '```',
    '',
    '## 或离线解压安装',
    '```bash',
    `tar -xzf ${BUNDLE_NAME}.tar.gz`,
    `cd ${BUNDLE_NAME}`,
    './install.sh',
    '```',
    '',
    '安装完成后会提供两个命令：',
    '- `boss-desk`：启动纯只读静态展示工作台（默认 `http://127.0.0.1:7788`，实时监听 `~/.boss-cli/` 自动刷新）',
    '- `boss`：Boss 直聘 Safari CLI 工具（供 WorkBuddy 等 Agent 调用）',
    '',
    '## 数据与更新',
    '- 所有候选人台账、PDF 简历与 Boss 在线简历存档均位于 `~/.boss-cli/`。',
    '- 点击网页右上角「检查更新」即可直连 GitHub 一键更新程序，绝不影响已有简历与台账数据。',
    '',
  ].join('\n');
}

console.log(`▸ 打包 招聘助手 v${APP_VERSION}（纯静态工作台 + Safari Boss CLI + Skill）...`);
console.log('▸ Step 1: 编译 boss CLI 与 招聘助手前端...');
run('npm', ['run', 'build']);
run('npm', ['--prefix', 'desk', 'run', 'build']);

const stageBase = path.join(RELEASE_DIR, 'stage');
const stageRoot = path.join(stageBase, BUNDLE_NAME);
const appDir = path.join(stageRoot, 'app');

rmSync(RELEASE_DIR, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

console.log('▸ Step 2: 组装零隐私预构建目录...');
const prodPkg = {
  name: rootPkg.name,
  version: APP_VERSION,
  description: rootPkg.description,
  type: 'module',
  main: 'dist/cli/index.js',
  bin: {
    boss: 'dist/cli/index.js',
    'boss-desk': 'scripts/boss-desk.mjs',
  },
  dependencies: rootPkg.dependencies,
  license: rootPkg.license,
};
writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify(prodPkg, null, 2)}\n`, 'utf8');

// 1) Compiled boss CLI
cpSync(path.join(ROOT, 'dist'), path.join(appDir, 'dist'), { recursive: true });
chmodSync(path.join(appDir, 'dist', 'cli', 'index.js'), 0o755);

// 2) Only runtime dependency of boss CLI (dotenv)
const dotenvSrc = path.join(ROOT, 'node_modules', 'dotenv');
if (!existsSync(dotenvSrc)) {
  throw new Error('缺少 node_modules/dotenv，请先在仓库根目录执行 npm install');
}
mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });
cpSync(dotenvSrc, path.join(appDir, 'node_modules', 'dotenv'), { recursive: true });

// 3) Prebuilt 招聘助手 frontend + pure static local server
mkdirSync(path.join(appDir, 'desk', 'server'), { recursive: true });
cpSync(path.join(ROOT, 'desk', 'dist'), path.join(appDir, 'desk', 'dist'), { recursive: true });
cpSync(path.join(ROOT, 'desk', 'server', 'index.mjs'), path.join(appDir, 'desk', 'server', 'index.mjs'));

// 4) Standalone launcher & updater
mkdirSync(path.join(appDir, 'scripts'), { recursive: true });
cpSync(path.join(ROOT, 'scripts', 'boss-desk.mjs'), path.join(appDir, 'scripts', 'boss-desk.mjs'));
cpSync(path.join(ROOT, 'scripts', 'updater.mjs'), path.join(appDir, 'scripts', 'updater.mjs'));
chmodSync(path.join(appDir, 'scripts', 'boss-desk.mjs'), 0o755);

// 5) Agent Skill & docs
if (existsSync(path.join(ROOT, 'skills', 'boss-safari-recruiter'))) {
  mkdirSync(path.join(appDir, 'skills'), { recursive: true });
  cpSync(
    path.join(ROOT, 'skills', 'boss-safari-recruiter'),
    path.join(appDir, 'skills', 'boss-safari-recruiter'),
    { recursive: true },
  );
}
for (const doc of ['AGENTS.md', 'README.md', 'LICENSE']) {
  const src = path.join(ROOT, doc);
  if (existsSync(src)) cpSync(src, path.join(appDir, doc));
}

// 6) Installer / Uninstaller / Quickstart README
const installPath = path.join(stageRoot, 'install.sh');
const uninstallPath = path.join(stageRoot, 'uninstall.sh');
writeFileSync(installPath, buildInstallScript(), 'utf8');
writeFileSync(uninstallPath, buildUninstallScript(), 'utf8');
writeFileSync(path.join(stageRoot, 'README-INSTALL.md'), buildInstallReadme(), 'utf8');
chmodSync(installPath, 0o755);
chmodSync(uninstallPath, 0o755);

console.log('▸ Step 3: 执行零隐私与空初始化门禁扫描...');
const fileCount = assertZeroPii(stageRoot);
console.log(`  ✓ 门禁通过：共 ${fileCount} 个干净文件，零候选人数据、零隐私文件`);

console.log('▸ Step 4: 生成发布压缩包与更新清单...');
const bundleTar = path.join(RELEASE_DIR, `${BUNDLE_NAME}.tar.gz`);
run('tar', ['-czf', bundleTar, '-C', stageBase, BUNDLE_NAME], ROOT, { COPYFILE_DISABLE: '1' });

const bundleSha = sha256File(bundleTar);
const sumsPath = path.join(RELEASE_DIR, 'SHA256SUMS.txt');
writeFileSync(sumsPath, `${bundleSha}  ${path.basename(bundleTar)}\n`, 'utf8');

const latestManifest = {
  version: APP_VERSION,
  publishedAt: new Date().toISOString(),
  assetName: path.basename(bundleTar),
  sha256: bundleSha,
  size: statSync(bundleTar).size,
  notes: `招聘助手 v${APP_VERSION}：极简纯静态展示工作台（零 DSH），专配 WorkBuddy / 千问办公 / 豆包工作 浏览器分屏模式，支持实时监听刷新、内嵌 PDF 跳页、Boss 在线简历本地存档、推荐/精选多来源筛选与一键检查更新。`,
};
const latestPath = path.join(RELEASE_DIR, 'latest.json');
writeFileSync(latestPath, `${JSON.stringify(latestManifest, null, 2)}\n`, 'utf8');

rmSync(stageBase, { recursive: true, force: true });

console.log('');
console.log('✓ 打包完成，发布产物位于 ./release/：');
for (const f of [bundleTar, sumsPath, latestPath]) {
  const kb = (statSync(f).size / 1024).toFixed(1);
  console.log(`  - ${path.basename(f)} (${kb} KB)`);
}
