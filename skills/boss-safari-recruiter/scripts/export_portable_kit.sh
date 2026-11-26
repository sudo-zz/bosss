#!/usr/bin/env bash
# Package boss Safari CLI + cross-harness skill into a clean portable bundle (no PII / avatars / reports).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
OUT_ROOT="${1:-$REPO_ROOT/dist-bundle}"
KIT_DIR="$OUT_ROOT/boss-safari-recruiter-kit"
ARCHIVE_PATH="$OUT_ROOT/boss-safari-recruiter-kit.tar.gz"

rm -rf "$KIT_DIR"
mkdir -p "$KIT_DIR/boss-cli" "$KIT_DIR/skill"

# Copy clean CLI source & config (strictly excluding node_modules, dist, .git, dashboard, candidate data)
for item in src package.json package-lock.json tsconfig.json AGENTS.md README.md LICENSE .gitignore; do
  if [ -e "$REPO_ROOT/$item" ]; then
    cp -R "$REPO_ROOT/$item" "$KIT_DIR/boss-cli/"
  fi
done

mkdir -p "$KIT_DIR/boss-cli/skills"
cp -R "$SKILL_DIR" "$KIT_DIR/boss-cli/skills/"
cp -R "$SKILL_DIR" "$KIT_DIR/skill/"

cat > "$KIT_DIR/install.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$KIT_DIR/skill/boss-safari-recruiter/scripts/bootstrap.sh" "$KIT_DIR/boss-cli"
EOF
chmod +x "$KIT_DIR/install.sh" "$KIT_DIR/boss-cli/skills/boss-safari-recruiter/scripts/bootstrap.sh" "$KIT_DIR/skill/boss-safari-recruiter/scripts/bootstrap.sh"

cat > "$KIT_DIR/QUICKSTART.md" <<'EOF'
# Boss Safari Recruiter · 跨电脑 / 跨 Agent Harness 便携迁移包

本工具包包含两部分：
1. `boss-cli/`：已适配 macOS **真实 Safari.app**、支持人类节奏未读全量巡检（`inspect-unread`）、本地台账（`tracker`）与 `--confirm` 安全围栏的 CLI 源码；
2. `skill/boss-safari-recruiter/`：标准跨平台 Agent Skill（支持 WorkBuddy、DS Harness、Claude Code、Codex、OpenClaw、Antigravity）。

## 在新电脑 3 步启用

1. 解压并运行一键安装脚本：
   ```bash
   ./install.sh
   ```
2. 在 Safari 开启 AppleScript 控制开关（一次设置永久生效）：
   - Safari 设置 (`Cmd + ,`) -> **高级** -> 勾选 **在菜单栏中显示“开发”菜单**（或显示网页开发者功能）
   - 顶部菜单栏 **开发** -> 勾选 **允许来自 Apple 事件的 JavaScript**
3. 在 Safari 手动打开并扫码登录 https://www.zhipin.com ，然后对任意 AI Agent（WorkBuddy / DS Harness / Claude Code / Codex / OpenClaw）说：
   > “使用 boss-safari-recruiter 技能：扫描我当前项目代码库并读取在招 JD，按真人节奏巡检未读候选人、下载头像与图片简历、制定打分规则并生成可视化看板。”
EOF

tar -czf "$ARCHIVE_PATH" -C "$OUT_ROOT" "boss-safari-recruiter-kit"
echo "Created portable bundle:"
echo "  Directory: $KIT_DIR"
echo "  Archive:   $ARCHIVE_PATH"
ls -lh "$ARCHIVE_PATH"
