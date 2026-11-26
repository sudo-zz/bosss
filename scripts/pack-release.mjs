#!/usr/bin/env node
/**
 * 招聘助手 × DeepSeek Harness 发行版打包脚本（macOS）
 *
 * 产出（./release/）：
 *   1. boss-recruiter-v<version>-darwin.tar.gz   — 零构建、零隐私数据、初始空库的一键安装包（含 install.sh / uninstall.sh）
 *   2. dsh-plugin-boss-recruiter-<pver>.tgz      — 纯净 DSH Cordis 插件 npm 包（供 `dsh plugin add` 单独安装）
 *   3. SHA256SUMS.txt                            — 校验和清单
 *
 * 安全门禁：
 *   - 严禁打入 web/pipeline.json、web/data.js、web/avatars、data/、dashboard/、.env、候选人 PDF/截图
 *   - 绝不修改本机 ~/.boss-cli/ 与仓库本地工作数据
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
const PLUGIN_SRC = path.join(ROOT, 'packages', 'dsh-plugin-boss-recruiter');

const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pluginPkg = JSON.parse(readFileSync(path.join(PLUGIN_SRC, 'package.json'), 'utf8'));
const APP_VERSION = String(rootPkg.version || '0.8.0-dsh');
const PLUGIN_VERSION = String(pluginPkg.version || '0.2.0');
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

# 招聘助手 × DeepSeek Harness macOS 一键安装脚本
# - 仅安装独立命令 boss 与 boss-dsh，绝不覆盖原生 dsh
# - 新机器初始化数据为空（~/.boss-cli/），不覆盖任何已有本地数据

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "❌ 本安装包仅支持 macOS（需要驱动本机 Safari.app）。"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="\${SCRIPT_DIR}/app"
INSTALL_ROOT="\${BOSS_RECRUITER_HOME:-\$HOME/.boss-recruiter}"
APP_DEST="\${INSTALL_ROOT}/app"
SKIP_DSH="0"

for arg in "\$@"; do
  case "\$arg" in
    --skip-dsh) SKIP_DSH="1" ;;
  esac
done

echo ""
echo "============================================================"
echo "  招聘助手 × DeepSeek Harness 安装程序 (v${APP_VERSION})"
echo "============================================================"
echo ""

# 1. 检查 Node.js >= 22
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js。请先安装 Node.js >= 22："
  echo "   brew install node"
  echo "   或前往 https://nodejs.org 下载安装后重跑本脚本。"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "\${NODE_MAJOR}" -lt 22 ]]; then
  echo "❌ 当前 Node.js 版本为 $(node -v)，需要 >= v22.0.0。"
  echo "   请升级后重跑：brew upgrade node"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# 2. 检查或安装 DeepSeek Harness (dsh)
if command -v dsh >/dev/null 2>&1; then
  echo "✓ DeepSeek Harness 已安装：$(dsh --version 2>/dev/null || echo dsh) ($(command -v dsh))"
else
  if [[ "\${SKIP_DSH}" == "1" ]]; then
    echo "⚠️  跳过安装 @deepseek-ai/dsh（--skip-dsh）。启动 boss-dsh 前请手动执行：npm install -g @deepseek-ai/dsh"
  else
    echo "▸ 未检测到 dsh，正在通过 npm 安装官方 @deepseek-ai/dsh..."
    npm install -g @deepseek-ai/dsh
    echo "✓ DeepSeek Harness 安装完成：$(dsh --version 2>/dev/null || echo dsh)"
  fi
fi

# 3. 安装预构建程序到 ~/.boss-recruiter/app（零编译、零隐私数据）
echo "▸ 正在安装程序文件到 \${APP_DEST} ..."
mkdir -p "\${INSTALL_ROOT}"
rm -rf "\${APP_DEST}"
cp -R "\${APP_SRC}" "\${APP_DEST}"
chmod +x "\${APP_DEST}/dist/cli/index.js" "\${APP_DEST}/scripts/dsh-web.mjs"

# 4. 创建独立全局命令 boss 与 boss-dsh（绝不覆盖 dsh）
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
ln -sfn "\${APP_DEST}/scripts/dsh-web.mjs" "\${BIN_DIR}/boss-dsh"
echo "✓ 已注册全局命令：\${BIN_DIR}/boss 与 \${BIN_DIR}/boss-dsh（未触碰原生 dsh）"

# 5. 确保本地运行数据目录存在（新机器初始化为空，不覆盖已有数据）
mkdir -p "\${HOME}/.boss-cli/resumes/pdf" "\${HOME}/.boss-cli/resumes/online" "\${HOME}/.boss-cli/sourcing" "\${HOME}/.boss-cli/avatars" "\${HOME}/.boss-cli/jd"
echo "✓ 本地数据目录已就绪：\${HOME}/.boss-cli（全新安装初始为空）"

# 5.5 生成双击启动脚本（人事可拖到桌面直接双击启动，无需记命令）
LAUNCHER_CMD="\${INSTALL_ROOT}/启动招聘助手.command"
cat > "\${LAUNCHER_CMD}" <<'EOF_LAUNCHER'
#!/usr/bin/env bash
INSTALL_ROOT="\${BOSS_RECRUITER_HOME:-\$HOME/.boss-recruiter}"
export PATH="\$INSTALL_ROOT/node/bin:\$INSTALL_ROOT/npm-global/bin:/opt/homebrew/bin:/usr/local/bin:\$HOME/.local/bin:\$PATH"
exec boss-dsh
EOF_LAUNCHER
chmod +x "\${LAUNCHER_CMD}"
echo "✓ 已生成双击启动文件：\${LAUNCHER_CMD}（可拖到桌面双击使用）"

# 6. 预挂载 DSH 独立 profile（boss-web）
if command -v dsh >/dev/null 2>&1; then
  echo "▸ 正在初始化 DSH 独立配置（profile: boss-web）..."
  "\${BIN_DIR}/boss-dsh" --dry-setup
fi

echo ""
echo "============================================================"
echo "  安装完成！首次使用只需 3 步："
echo "============================================================"
echo ""
if [[ ":\${PATH}:" != *":\${BIN_DIR}:"* ]]; then
  echo "⚠️  请先将 \${BIN_DIR} 加入 PATH（写入 ~/.zshrc 后重开终端）："
  printf '   echo '\''export PATH="%s:$PATH"'\'' >> ~/.zshrc && source ~/.zshrc\n' "\${BIN_DIR}"
  echo ""
fi
echo "1. 开启 Safari 自动化权限（仅需一次）："
echo "   Safari → 设置 → 高级 → 勾选「显示网页开发者功能」"
echo "   顶部菜单栏「开发」→ 勾选「允许来自 Apple 事件的 JavaScript」"
echo ""
echo "2. 在 Safari 登录 Boss 直聘招聘端："
echo "   https://www.zhipin.com/web/chat/index"
echo ""
echo "3. 在任意终端目录运行："
echo "   boss-dsh"
echo "   - 在弹出的 DSH 界面「设置 → 模型」中配置你的大模型（DeepSeek / OpenAI / Claude 等）"
echo "   - 打开终端打印的 http://127.0.0.1:<端口>/boss-desk/ 进入「招聘助手」工作台"
echo ""
`;
}

function buildUninstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="\${BOSS_RECRUITER_HOME:-\$HOME/.boss-recruiter}"
APP_DEST="\${INSTALL_ROOT}/app"

echo "▸ 正在卸载招聘助手程序（保留你的 ~/.boss-cli 招聘数据与 ~/.dsh 凭证）..."

NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
for dir in "\${NPM_PREFIX}/bin" "/opt/homebrew/bin" "/usr/local/bin" "\${HOME}/.local/bin"; do
  for bin in boss boss-dsh; do
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
rm -rf "\${HOME}/.dsh/profiles/boss-web"
echo "✓ 已卸载程序与 boss-web profile。"
echo "ℹ️  本地候选人台账与简历存档保留在 ~/.boss-cli/（如需彻底清空请手动删除）。"
`;
}

function buildInstallReadme() {
  return [
    `# 招聘助手 × DeepSeek Harness（macOS 发行包 v${APP_VERSION}）`,
    '',
    '本安装包已完成全部前端与 CLI 预构建，零编译、零候选人隐私数据，首次安装初始化为空库。',
    '',
    '## 系统要求',
    '- macOS（Apple Silicon 或 Intel）+ 本机 **Safari.app**',
    '- **Node.js >= 22**（如未安装：`brew install node`）',
    '',
    '## 安装步骤',
    '```bash',
    `tar -xzf ${BUNDLE_NAME}.tar.gz`,
    `cd ${BUNDLE_NAME}`,
    './install.sh',
    '```',
    '',
    '安装完成后会注册两个独立命令（绝不覆盖原生 `dsh`）：',
    '- `boss-dsh`：一键启动 DeepSeek Harness + 招聘助手工作台（同端口提供 DSH 对话界面与 `/boss-desk/`）',
    '- `boss`：Boss 直聘 Safari CLI 工具（如 `boss doctor`、`boss quota`）',
    '',
    '## 首次使用',
    '1. 打开 Safari → **设置 → 高级** → 勾选「显示网页开发者功能」；顶部菜单栏 **开发** → 勾选「允许来自 Apple 事件的 JavaScript」。',
    '2. 在 Safari 手动登录 `https://www.zhipin.com/web/chat/index`。',
    '3. 终端运行 `boss-dsh`，按提示在 DSH「设置 → 模型」填入你的模型 Key，并打开 `/boss-desk/` 开始筛选候选人。',
    '',
    '## 卸载',
    '```bash',
    './uninstall.sh',
    '```',
    '（默认保留 `~/.boss-cli/` 中的本地简历与台账数据以及 `~/.dsh/` 的模型凭证。）',
    '',
  ].join('\n');
}

console.log(`▸ 打包 招聘助手 × DeepSeek Harness v${APP_VERSION} (插件 v${PLUGIN_VERSION})...`);
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
    'boss-dsh': 'scripts/dsh-web.mjs',
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

// 3) Prebuilt 招聘助手 frontend (desk/dist only — zero node_modules, zero src)
mkdirSync(path.join(appDir, 'desk'), { recursive: true });
cpSync(path.join(ROOT, 'desk', 'dist'), path.join(appDir, 'desk', 'dist'), { recursive: true });

// 4) Native DSH Cordis plugin bundle
const pluginDest = path.join(appDir, 'packages', 'dsh-plugin-boss-recruiter');
mkdirSync(pluginDest, { recursive: true });
for (const item of ['package.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'lib', 'locale', 'docs', 'assets']) {
  const src = path.join(PLUGIN_SRC, item);
  if (existsSync(src)) {
    cpSync(src, path.join(pluginDest, item), { recursive: true });
  }
}

// 5) Standalone launcher script
mkdirSync(path.join(appDir, 'scripts'), { recursive: true });
cpSync(path.join(ROOT, 'scripts', 'dsh-web.mjs'), path.join(appDir, 'scripts', 'dsh-web.mjs'));
chmodSync(path.join(appDir, 'scripts', 'dsh-web.mjs'), 0o755);

// 6) Skill & docs
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

// 7) Installer / Uninstaller / Quickstart README
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

console.log('▸ Step 4: 生成发布压缩包...');
const bundleTar = path.join(RELEASE_DIR, `${BUNDLE_NAME}.tar.gz`);
run('tar', ['-czf', bundleTar, '-C', stageBase, BUNDLE_NAME], ROOT, { COPYFILE_DISABLE: '1' });

// Also pack standalone DSH plugin tarball (`npm pack`)
run('npm', ['pack', '--pack-destination', RELEASE_DIR], PLUGIN_SRC);
const pluginTgz = path.join(RELEASE_DIR, `dsh-plugin-boss-recruiter-${PLUGIN_VERSION}.tgz`);
if (!existsSync(pluginTgz)) {
  throw new Error(`未生成预期插件包：${pluginTgz}`);
}

// Checksums & latest.json manifest (for one-click check/install update)
const assets = [bundleTar, pluginTgz];
const bundleSha = sha256File(bundleTar);
const sums = assets.map((f) => `${sha256File(f)}  ${path.basename(f)}`).join('\n') + '\n';
const sumsPath = path.join(RELEASE_DIR, 'SHA256SUMS.txt');
writeFileSync(sumsPath, sums, 'utf8');

const latestManifest = {
  version: APP_VERSION,
  pluginVersion: PLUGIN_VERSION,
  publishedAt: new Date().toISOString(),
  assetName: path.basename(bundleTar),
  sha256: bundleSha,
  size: statSync(bundleTar).size,
  notes: `招聘助手 × DeepSeek Harness v${APP_VERSION}（支持页面一键检查更新与安全替换程序、不改动本地简历与台账数据）`,
};
const latestPath = path.join(RELEASE_DIR, 'latest.json');
writeFileSync(latestPath, `${JSON.stringify(latestManifest, null, 2)}\n`, 'utf8');

// Clean staging folder so release/ contains only final release artifacts
rmSync(stageBase, { recursive: true, force: true });

console.log('');
console.log('✓ 打包完成，发布产物位于 ./release/：');
for (const f of [...assets, sumsPath, latestPath]) {
  const kb = (statSync(f).size / 1024).toFixed(1);
  console.log(`  - ${path.basename(f)} (${kb} KB)`);
}
