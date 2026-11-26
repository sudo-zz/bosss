---
name: boss-safari-recruiter
description: End-to-end Boss Zhipin AI recruiting workflow via real macOS Safari.app (`boss` CLI) paired with the pure read-only `boss-desk` workbench (`http://127.0.0.1:7788`). Use in WorkBuddy, Qwen Office, Doubao Work, Claude Code, or Codex to screen unread chats, source from Recommend/Featured tabs (excluding Latest), archive Boss online resumes and local PDF resumes into `~/.boss-cli/`, update candidate tracker records (which auto-refresh the right-side browser workbench in real time), and execute `--confirm`-gated Boss replies/greetings safely.
---

# Boss Safari Recruiter

Autonomous, human-paced Boss Zhipin recruiting workflow built for macOS **real `Safari.app`** (`boss` CLI) + **pure static read-only workbench (`boss-desk`)**.

Designed specifically for desktop Agents with split-screen browser mode (**WorkBuddy / 千问办公 / 豆包工作 / Cursor / Claude Code / Codex**):
- **Left pane (Agent chat)**: You run `boss` CLI commands to control host macOS Safari, analyze resumes/images/PDFs, score candidates, and write standardized data into `~/.boss-cli/`.
- **Right pane (Browser)**: HR opens `http://127.0.0.1:7788` (`boss-desk`), which watches `~/.boss-cli/` and live-refreshes automatically to show multi-source stats, dual tags (position + source), embedded PDF viewer (`#page=N`), and archived Boss online resumes.

## Hard Safety & Browser Boundaries

1. **Safari-only**: Never launch Chrome, Playwright, or Puppeteer. `boss` drives real `Safari.app` through AppleScript (`Allow JavaScript from Apple Events`).
2. **Immediate human handoff on verification**: If any command returns `NOT_LOGGED_IN`, `CAPTCHA`, `RISK_CONTROL`, or `403`, **stop immediately**, tell the user what appeared in Safari, and wait for manual completion. Never poll or attempt bypasses.
3. **Screening-first, write-gated**: Read commands are automatic. All write commands (`send`, `greet`, `action not-fit|wechat|request-attachment-resume|agree-resume|remark`) default to **dry-run** unless `--confirm` is passed — **never pass `--confirm`** until the user explicitly confirms the target candidates and message text.
4. **Recommend sourcing scope**: Only source from `recommend` (`推荐牛人`) and `featured` (`精选牛人`); **never** use `latest` (`最新`).
5. **Quota & pacing**: Respect `boss quota`, keep >=10s interval between writes, and batch long inbox reads (`--pause-every 25`).

## End-to-End SOP

Let `SKILL_DIR` be the folder containing this `SKILL.md`.  
Read the local data & schema contract in [references/data-spec.md](references/data-spec.md) whenever importing resumes or writing evaluations.

### Step 0: Preflight & Ensure Workbench Is Running

Check Safari & CLI health:

```bash
boss doctor --json
```

- If `boss` / `boss-desk` is missing on a fresh Mac, tell the user or run the one-line installer:
  `curl -fsSL https://raw.githubusercontent.com/sudo-zz/bosss/main/install.sh | bash`
- If `doctor` reports AppleScript JS disabled, guide the user: Safari Settings -> Advanced -> Show features for web developers -> Develop menu -> **Allow JavaScript from Apple Events**.
- If not logged in, open `https://www.zhipin.com/web/chat/index` in Safari (`boss login`) and pause until the user completes login.
- Make sure the local read-only workbench is running so the user can view live results at `http://127.0.0.1:7788` (`curl -sf http://127.0.0.1:7788/api/ping || boss-desk --no-open &`).

### Step 1: Align Open JD & Import Any Existing Local PDF Resumes

1. Fetch open positions & JD:
   ```bash
   boss positions --json
   boss jd "<职位名称>" --refresh --json
   ```
2. If the user already has local PDF resumes in a folder:
   - Copy them to `~/.boss-cli/resumes/pdf/<候选人姓名>.pdf`.
   - Read/extract key facts and score them against the JD, then register each via `boss tracker upsert` with `--job "<职位>" --source message --resume-pdf "$HOME/.boss-cli/resumes/pdf/<候选人姓名>.pdf"`.
   - The browser workbench immediately displays them with embedded PDF viewing & page jumping.

### Step 2: Multi-Source Candidate Collection (Message / Recommend / Featured)

1. **Message Inbox (`消息列表`, `source: "message"`)**:
   ```bash
   boss inspect-unread --max 60 --pause-every 25 --json
   # Resume if needed:
   boss inspect-unread --resume --max 100 --pause-every 25 --json
   ```
2. **Recommend Pool (`推荐牛人`, `source: "recommend"`)**:
   ```bash
   boss recommend "<职位>" --tab recommend --limit 20 --skip-viewed --skip-colleague --sync-tracker --json
   ```
3. **Featured Pool (`精选牛人`, `source: "featured"`)**:
   ```bash
   boss recommend "<职位>" --tab featured --limit 20 --skip-viewed --skip-colleague --sync-tracker --json
   ```

### Step 3: On-Demand Online Resume Archiving (Zero Repeat Quota)

For high-potential candidates only (to save daily preview quota):
- From chat (`message`):
  ```bash
  boss chat "<姓名>" --strict --json
  boss action resume --json
  ```
- From recommend/featured:
  ```bash
  boss preview "<姓名>" --tab recommend --job "<职位>" --json
  # or --tab featured
  ```
Both commands automatically persist `~/.boss-cli/resumes/online/<姓名>.json` & `.md`, making them viewable offline in `boss-desk` forever.

### Step 4: Score, Tag & Write to Tracker (Auto-Refreshes Browser)

Upsert every evaluated candidate with dual tags (**`--job`** + **`--source`**), stage, score, profile summary, and concise verdict:

```bash
boss tracker upsert \
  --name "<姓名>" \
  --job "<岗位名称>" \
  --source "<message|recommend|featured>" \
  --stage "<screened|shortlisted|hold|rejected>" \
  --score <0-100> \
  --summary "<年龄>｜<年限>｜<学历>｜<城市>｜<薪资>｜<最近经历>" \
  --reason "【<结论标签>】<核心亮点与待核实风险>" \
  --json
```

If doing deep interview evaluations, also write structured evaluation records into `~/.boss-cli/eval/data.json` (format in [references/data-spec.md](references/data-spec.md)).

### Step 5: Present Shortlist & Execute Confirmed Outreach Only

Present a concise ranked table (Rank, Name, Position, Source, Score, Highlights, Risks, Proposed Action) and remind the user they can inspect full profiles & PDFs in `http://127.0.0.1:7788`.

Only AFTER explicit user confirmation on specific candidates:
- **Chat reply (`message`)**:
  ```bash
  boss send --to "<姓名>" --strict -t "<确认后的文案>" --confirm --json
  ```
- **Greet (`recommend` / `featured`)**:
  ```bash
  boss greet "<姓名>" --tab "<recommend|featured>" --job "<岗位>" --confirm --json
  ```

## References

- Local `~/.boss-cli/` data contract & eval JSON schema: [references/data-spec.md](references/data-spec.md)
- Rubric DSL, modifiers, and override schema: [references/rubric-schema.md](references/rubric-schema.md)
- Default presets to copy & adapt: [references/rubric-presets.json](references/rubric-presets.json)
- Full `boss` CLI reference: [references/cli-and-harness-guide.md](references/cli-and-harness-guide.md)
