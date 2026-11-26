# Boss CLI & Cross-Harness Integration Guide

## 1. Essential `boss` CLI Reference (All Support `--json`)

### Environment & Auth
- `boss doctor --json` — Verify macOS Safari.app, AppleScript JS toggle, Boss tab, and login session.
- `boss login` — Focus/open `https://www.zhipin.com` in Safari for manual QR/phone login (never automates bypass).
- `boss quota --json` — Check daily write counts & minimum interval safety limits (`~/.boss-cli/quota.json`).

### Positions & Sourcing (Read-Only)
- `boss positions --json` — List all active posted jobs on Boss Zhipin.
- `boss jd "<职位>" --refresh --json` — Open job editor in Safari, extract complete JD, and cache to `~/.boss-cli/jd/<职位>.md`.
- `boss inspect-unread --max 120 --pause-every 25 [--resume] --json` — Scroll & click through unread chats at human-like cadence, saving profiles, timelines, messages, avatars, and friend-sent resume images to `~/.boss-cli/unread-inspect.json` and `~/.boss-cli/avatars/`.
- `boss list --unread --limit 30 --json` — Lightweight list-only read without clicking into every chat.
- `boss chat "<姓名>" --json` — Open specific conversation in Safari and return full messages + metadata.
- `boss action resume --json` — Read candidate's online resume modal/DOM in chat (falls back to screenshot path only if canvas-rendered).
- `boss recommend "<职位>" --limit 30 --skip-viewed --skip-colleague --exclude-tracked --json` — Browse Boss recommended candidates.
- `boss search "<关键词>" --limit 30 --exclude-tracked --json` — Keyword search candidates.
- `boss preview --geek-id <ID> --json` — View candidate card/resume preview on recommend/search pages.

### Local Tracker (No External Network Effects)
- `boss tracker stats` — Show stage counts & average score from `~/.boss-cli/tracker.json`.
- `boss tracker upsert --name <姓名> --job <岗位> --stage <new|screened|shortlisted|greeted|replied|interview|rejected|hold> --score <0-100> --summary "..." --reason "..."`
- `boss tracker export --job <岗位> --stage shortlisted --out ./shortlist.md`

### Write Operations (Dry-Run by Default -> Append `--confirm` Only After Explicit User Approval)
- `boss send [--to "<姓名>"] [--strict] -t "<消息文本>" --confirm` — Send chat message cleanly (auto-locates & switches to `--to` candidate before sending if needed, verifies `.submit.active` click and editor clear).
- `boss greet --geek-id <ID> [-t "<自定义开场白>"] --confirm` — Send initial greeting on recommend/search page.
- `boss action <not-fit|wechat|request-attachment-resume|agree-resume|remark> [--value "..."] --confirm` — Execute chat action button.

Standard first-round resume-request template (replace office location as needed for other companies):

```text
你好，感谢投递，公司地点在奉贤区南上海科创中心,请问是否方便通勤？
我们的面试流程是一轮线上初面 + 现场进行技术面试（需要携带电脑）,请问是否方便呢？
可以的话麻烦发送一份附件简历过来，谢谢！
```

---

## 2. Installing on Another Mac (Portable Kit)

Generate a PII-free migration bundle from the source repo at any time:

```bash
bash skills/boss-safari-recruiter/scripts/export_portable_kit.sh ./dist-bundle
```

Copy `dist-bundle/boss-safari-recruiter-kit.tar.gz` (or the unzipped folder) to the new Mac via AirDrop/SCP/U盘 and run:

```bash
tar -xzf boss-safari-recruiter-kit.tar.gz
cd boss-safari-recruiter-kit
./install.sh
```

`install.sh` builds & links `boss` globally, installs `boss-safari-recruiter` into all local harnesses, and runs `boss doctor --json`.

---

## 3. Using Across Different Agent Harnesses

### WorkBuddy / OpenClaw / Claude Code / Codex / Antigravity
- Standard directories populated automatically by `scripts/bootstrap.sh`:
  - Shared canonical: `~/.agents/skills/boss-safari-recruiter`
  - WorkBuddy (real copy to satisfy sandbox): `~/.workbuddy/skills/boss-safari-recruiter`
  - Claude Code: `~/.claude/skills/boss-safari-recruiter`
  - Codex: `~/.codex/skills/boss-safari-recruiter`
  - OpenClaw: `~/.openclaw/skills/boss-safari-recruiter`
  - Antigravity global: `~/.gemini/config/skills/boss-safari-recruiter`
- In any of those agents, simply prompt:
  > “使用 `boss-safari-recruiter`：先检查 Safari 登录状态，扫描我的项目目录并拉取在招 JD，然后按真人节奏巡检未读候选人、下载照片与图片简历、打分生成看板和短名单。”

### DS Harness / Custom Python or TypeScript Agent Loops (DeepSeek / OpenAI / Tool-Calling Harness)
If your **DS Harness** does not auto-discover `~/.agents/skills/`, integrate it in one of two ways:

1. **System Prompt / File Injection Mode** (Zero code changes in DS Harness):
   Pass the contents of `skills/boss-safari-recruiter/SKILL.md` into your harness system prompt (or `--system-prompt` / `system_instructions`), give your harness standard `bash`/`shell` + `read_file`/`write_file` tools (plus vision `read_file` if reading image resumes), and start in the target hiring directory.

2. **Structured Tool Prompt Template** (paste into your DS Harness task config):

```markdown
You have the `boss` CLI (driving real macOS Safari.app) and helper scripts at `~/.agents/skills/boss-safari-recruiter/scripts/`.
Follow this strict pipeline:
1. Run `boss doctor --json`. If login or CAPTCHA appears, STOP immediately and ask the user to solve it in Safari.
2. Run `boss positions --json`, `boss jd "<JOB>" --refresh --json`, and `node ~/.agents/skills/boss-safari-recruiter/scripts/scan_projects.mjs --dir "<WORK_DIR>" --json`.
3. Run `boss inspect-unread --max 120 --pause-every 25 --json` (continue with `--resume` until `pending === 0`) so all chats and photos in `~/.boss-cli/avatars` are saved locally.
4. Read `references/rubric-schema.md` + `references/rubric-presets.json`, inspect any downloaded image resumes (`friendImageLocalPaths`), write `dashboard/expert-overrides.json` and tailored `dashboard/rubric.json`.
5. Run `node ~/.agents/skills/boss-safari-recruiter/scripts/generate_dashboard.mjs --config dashboard/rubric.json --overrides dashboard/expert-overrides.json --jd ~/.boss-cli/jd/"<JOB>".md --open`.
6. Output the shortlist table and links to `dashboard/index.html` and `shortlist-report.md`. NEVER run `send` / `greet` / `action` with `--confirm` unless the user confirms specific candidate names first.
```
