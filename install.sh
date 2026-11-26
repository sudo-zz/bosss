#!/usr/bin/env bash
set -euo pipefail

# 招聘助手 × DeepSeek Harness — macOS 一键在线安装脚本
#
# 用法（在任意新 Mac 终端直接粘贴执行）：
#   curl -fsSL https://raw.githubusercontent.com/sudo-zz/bosss/main/install.sh | bash
#
# 特性：
#   - 零编译、零 sudo（缺 Node.js >= 22 自动在用户目录安装官方 Node 22 LTS）
#   - 自动安装 DeepSeek Harness（dsh），独立注册 boss / boss-dsh，绝不覆盖原生 dsh
#   - 从 GitHub Releases 直连拉取最新安装包并校验 SHA-256
#   - 新电脑初始化数据为空；重复执行可用于升级，绝不改动已有 ~/.boss-cli 简历与台账数据

REPO="${BOSS_GITHUB_REPO:-sudo-zz/bosss}"
INSTALL_ROOT="${BOSS_RECRUITER_HOME:-$HOME/.boss-recruiter}"
NODE_FALLBACK_VERSION="v22.14.0"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "❌ 本工具仅支持 macOS（需要驱动本机 Safari.app）。"
  exit 1
fi

echo ""
echo "============================================================"
echo "  招聘助手 × DeepSeek Harness — macOS 一键安装"
echo "============================================================"
echo ""

# 把可能已存在的本机常用 PATH 纳入检测
export PATH="$INSTALL_ROOT/node/bin:$INSTALL_ROOT/npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

# 1. 检测或自动准备 Node.js >= 22（免 sudo，免 Homebrew）
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [[ "$major" -ge 22 ]]; then
      echo "✓ 检测到 Node.js $(node -v) ($(command -v node))"
      return 0
    fi
    echo "▸ 当前系统 Node.js 为 $(node -v)（低于 v22），将自动为招聘助手准备独立 Node 22 运行时（不影响系统 Node）..."
  else
    echo "▸ 未检测到 Node.js，将自动下载官方 Node.js 22 LTS 到 $INSTALL_ROOT/node（免 sudo）..."
  fi

  local arch
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *)
      echo "❌ 不支持的 CPU 架构：$(uname -m)"
      exit 1
      ;;
  esac

  local node_tar="node-${NODE_FALLBACK_VERSION}-darwin-${arch}.tar.gz"
  local tmp_node
  tmp_node="$(mktemp -d "${TMPDIR:-/tmp}/boss-node.XXXXXX")"
  trap 'rm -rf "$tmp_node"' RETURN

  local downloaded="0"
  for base in "https://npmmirror.com/mirrors/node/${NODE_FALLBACK_VERSION}" "https://nodejs.org/dist/${NODE_FALLBACK_VERSION}"; do
    echo "  ↓ 下载 ${base}/${node_tar} ..."
    if curl -fL --progress-bar --connect-timeout 15 --max-time 300 "${base}/${node_tar}" -o "${tmp_node}/${node_tar}"; then
      downloaded="1"
      break
    fi
  done

  if [[ "$downloaded" != "1" ]]; then
    echo "❌ 自动下载 Node.js 失败，请手动前往 https://nodejs.org 下载安装 Node.js 22+ 后重跑本命令。"
    exit 1
  fi

  mkdir -p "$INSTALL_ROOT"
  rm -rf "$INSTALL_ROOT/node"
  tar -xzf "${tmp_node}/${node_tar}" -C "$tmp_node"
  mv "${tmp_node}/node-${NODE_FALLBACK_VERSION}-darwin-${arch}" "$INSTALL_ROOT/node"
  export PATH="$INSTALL_ROOT/node/bin:$PATH"
  echo "✓ Node.js $(node -v) 已就绪（$INSTALL_ROOT/node）"
}

ensure_node

# 2. 检测或安装 DeepSeek Harness (dsh)（免 sudo）
ensure_dsh() {
  if command -v dsh >/dev/null 2>&1; then
    echo "✓ 检测到 DeepSeek Harness $(dsh --version 2>/dev/null || echo '') ($(command -v dsh))"
    return 0
  fi

  echo "▸ 未检测到 dsh，正在安装官方 @deepseek-ai/dsh ..."
  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  local prefix_args=()
  if [[ -z "$npm_prefix" || ! -w "$npm_prefix" || ( -d "$npm_prefix/lib" && ! -w "$npm_prefix/lib" ) ]]; then
    mkdir -p "$INSTALL_ROOT/npm-global"
    prefix_args=(--prefix "$INSTALL_ROOT/npm-global")
    export PATH="$INSTALL_ROOT/npm-global/bin:$PATH"
  fi

  if ! npm install -g ${prefix_args[@]+"${prefix_args[@]}"} @deepseek-ai/dsh; then
    echo "▸ 默认 npm 源安装较慢或失败，切换国内镜像重试..."
    npm install -g ${prefix_args[@]+"${prefix_args[@]}"} --registry=https://registry.npmmirror.com @deepseek-ai/dsh
  fi

  if ! command -v dsh >/dev/null 2>&1; then
    echo "❌ 安装 @deepseek-ai/dsh 后仍未找到 dsh 命令，请检查网络或 PATH。"
    exit 1
  fi
  echo "✓ DeepSeek Harness 安装完成：$(dsh --version 2>/dev/null || echo dsh)"
}

ensure_dsh

# 3. 从 GitHub Releases CDN 获取最新版本清单（不走 REST API，免 403 限流）
TMP_WORK="$(mktemp -d "${TMPDIR:-/tmp}/boss-recruiter-install.XXXXXX")"
trap 'rm -rf "$TMP_WORK"' EXIT

MANIFEST_URL="https://github.com/${REPO}/releases/latest/download/latest.json"
echo "▸ 正在获取最新版本信息（GitHub: ${REPO}）..."
if ! curl -fsSL --connect-timeout 15 --max-time 60 "$MANIFEST_URL" -o "$TMP_WORK/latest.json"; then
  echo "❌ 无法下载版本清单：$MANIFEST_URL"
  echo "   请检查网络连接（能否访问 github.com），或前往 https://github.com/${REPO}/releases 手动下载安装包。"
  exit 1
fi

VERSION="$(node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(m.version||'')" "$TMP_WORK/latest.json")"
ASSET_NAME="$(node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(m.assetName||'')" "$TMP_WORK/latest.json")"
EXPECTED_SHA="$(node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log((m.sha256||'').toLowerCase())" "$TMP_WORK/latest.json")"

if [[ -z "$VERSION" || -z "$ASSET_NAME" ]]; then
  echo "❌ 版本清单格式异常，请稍后重试。"
  exit 1
fi

ASSET_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
echo "▸ 正在下载招聘助手 v${VERSION} (${ASSET_NAME})..."
curl -fL --progress-bar --connect-timeout 15 --max-time 180 "$ASSET_URL" -o "$TMP_WORK/$ASSET_NAME"

# 4. 校验 SHA-256
if [[ -n "$EXPECTED_SHA" ]]; then
  ACTUAL_SHA="$(shasum -a 256 "$TMP_WORK/$ASSET_NAME" | awk '{print tolower($1)}')"
  if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
    echo "❌ 安装包 SHA-256 校验失败！"
    echo "   期望：$EXPECTED_SHA"
    echo "   实际：$ACTUAL_SHA"
    exit 1
  fi
  echo "✓ SHA-256 校验通过 (${ACTUAL_SHA:0:12}...)"
fi

# 5. 解压并运行包内安装程序
echo "▸ 正在解压并安装..."
tar -xzf "$TMP_WORK/$ASSET_NAME" -C "$TMP_WORK"
BUNDLE_DIR="$(find "$TMP_WORK" -maxdepth 2 -name install.sh -exec dirname {} \; | head -n 1)"
if [[ -z "$BUNDLE_DIR" || ! -f "$BUNDLE_DIR/install.sh" ]]; then
  echo "❌ 安装包内未找到 install.sh"
  exit 1
fi

bash "$BUNDLE_DIR/install.sh" --skip-dsh

# 6. 确保内置 Node / npm-global PATH 写入 ~/.zshrc（如需要）并在桌面生成双击图标
NEED_SHELL_PATH=""
for d in "$INSTALL_ROOT/node/bin" "$INSTALL_ROOT/npm-global/bin" "$HOME/.local/bin"; do
  if [[ -d "$d" ]]; then
    NEED_SHELL_PATH="${NEED_SHELL_PATH:+$NEED_SHELL_PATH:}$d"
  fi
done
if [[ -n "$NEED_SHELL_PATH" ]]; then
  ZSHRC="$HOME/.zshrc"
  MARKER="# boss-recruiter-path"
  if [[ ! -f "$ZSHRC" ]] || ! grep -q "$MARKER" "$ZSHRC" 2>/dev/null; then
    {
      echo ""
      echo "$MARKER"
      printf 'export PATH="%s:$PATH"\n' "$NEED_SHELL_PATH"
    } >> "$ZSHRC"
    echo "✓ 已将运行路径自动写入 ~/.zshrc"
  fi
fi

# 在桌面创建「启动招聘助手.command」（若桌面可写且尚未创建）
LAUNCHER_SRC="$INSTALL_ROOT/启动招聘助手.command"
DESKTOP_LAUNCHER="$HOME/Desktop/启动招聘助手.command"
if [[ -f "$LAUNCHER_SRC" && -d "$HOME/Desktop" && -w "$HOME/Desktop" ]]; then
  cp "$LAUNCHER_SRC" "$DESKTOP_LAUNCHER"
  chmod +x "$DESKTOP_LAUNCHER"
  echo "✓ 已在桌面创建一键启动图标：~/Desktop/启动招聘助手.command"
fi

echo ""
echo "🎉 全部安装完成！后续在页面右上角点「检查更新」即可直连 GitHub 一键升级（不影响简历与台账数据）。"
echo ""
