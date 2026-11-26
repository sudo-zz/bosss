#!/usr/bin/env bash
# Portable macOS installer for the boss-safari-recruiter skill and Safari boss CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_NAME="boss-safari-recruiter"

CLI_DIR="${1:-}"
if [ -z "$CLI_DIR" ]; then
  # Search upward or sibling folder when invoked from portable kit
  for cand in "$SKILL_DIR/../.." "$SKILL_DIR/../../boss-cli" "$PWD"; do
    if [ -f "$cand/package.json" ] && grep -q 'boss-cli' "$cand/package.json" 2>/dev/null; then
      CLI_DIR="$(cd "$cand" && pwd)"
      break
    fi
  done
fi

echo "==> [1/4] Checking macOS & Node.js runtime"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: boss-safari-recruiter requires macOS Safari.app." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js (>=18) is required. Install via Homebrew: brew install node" >&2
  exit 1
fi
echo "Node: $(node -v)"

echo "==> [2/4] Building and linking Safari boss CLI"
if [ -n "$CLI_DIR" ] && [ -f "$CLI_DIR/package.json" ]; then
  (
    cd "$CLI_DIR"
    if [ ! -d node_modules ]; then npm install; fi
    npm run build
    if npm link 2>/dev/null; then
      echo "Linked global CLI via npm link: $(command -v boss || echo 'OK')"
    else
      mkdir -p "$HOME/.local/bin"
      ln -sf "$CLI_DIR/dist/cli/index.js" "$HOME/.local/bin/boss"
      chmod +x "$CLI_DIR/dist/cli/index.js"
      echo "Linked CLI to $HOME/.local/bin/boss (ensure ~/.local/bin is in PATH)"
    fi
  )
else
  echo "WARN: boss-cli source dir not found nearby. Skipping CLI build; pass repo path as arg 1 if needed."
fi

echo "==> [3/4] Installing '$SKILL_NAME' skill into local AI harnesses"
install_copy() {
  local target_root="$1"
  mkdir -p "$target_root"
  local dest="$target_root/$SKILL_NAME"
  rm -rf "$dest"
  cp -R "$SKILL_DIR" "$dest"
  echo "  -> Copied to $dest"
}

# Canonical cross-agent root + WorkBuddy (direct copy avoids sandbox symlink blocks)
install_copy "$HOME/.agents/skills"
install_copy "$HOME/.workbuddy/skills"

# Sync into Claude Code, Codex, OpenClaw, and Antigravity if present or create links
for harness_dir in "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.openclaw/skills" "$HOME/.gemini/config/skills"; do
  mkdir -p "$harness_dir"
  rm -rf "$harness_dir/$SKILL_NAME"
  ln -s "$HOME/.agents/skills/$SKILL_NAME" "$harness_dir/$SKILL_NAME"
  echo "  -> Linked $harness_dir/$SKILL_NAME"
done

echo "==> [4/4] Running Safari environment doctor"
if command -v boss >/dev/null 2>&1; then
  boss doctor --json || true
  echo ""
  echo "If Safari JavaScript execution failed:"
  echo "  1) Open Safari -> Settings (Cmd+,) -> Advanced -> Check 'Show features for web developers'"
  echo "  2) Top menu Develop -> Check 'Allow JavaScript from Apple Events'"
else
  echo "WARN: 'boss' binary not yet on PATH."
fi
