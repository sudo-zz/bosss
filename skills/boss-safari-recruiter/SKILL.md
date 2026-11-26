---
name: boss-safari-recruiter
description: End-to-end Boss Zhipin AI recruiting workflow via real macOS Safari.app (`boss` CLI). Use when screening unread chats, recommending candidates, downloading avatars/image resumes, scanning local company projects to design a custom scoring rubric, generating an interactive offline HTML candidate dashboard and Markdown shortlist, or executing `--confirm`-gated Boss replies without triggering anti-bot popups.
---

# Boss Safari Recruiter

Autonomous, human-paced Boss Zhipin screening and candidate-evaluation pipeline built for macOS **real `Safari.app`** via the customized `boss` CLI. Works across WorkBuddy, DS Harness, Claude Code, Codex, OpenClaw, and Antigravity.

## Hard Safety & Browser Boundaries

1. **Safari-only**: Never launch Chrome, Playwright, or Puppeteer. `boss` drives real `Safari.app` through AppleScript (`Allow JavaScript from Apple Events`).
2. **Immediate human handoff on verification**: If any command returns `NOT_LOGGED_IN`, `CAPTCHA`, `RISK_CONTROL`, or `403`, **stop immediately**, tell the user what appeared in Safari, and wait for manual completion. Never poll or attempt bypasses.
3. **Screening-first, write-gated**: Read commands are automatic. All write commands (`send`, `greet`, `action not-fit|wechat|request-attachment-resume|agree-resume|remark`) default to **dry-run** unless `--confirm` is passed — **never pass `--confirm`** until the user explicitly confirms the target candidates and message text.
4. **Quota & pacing**: Respect `boss quota`, keep >=10s interval between writes, and batch long inbox reads (`--pause-every 25`).

## End-to-End SOP

Let `SKILL_DIR` be the folder containing this `SKILL.md`.

### Step 0: Preflight & Bootstrap

Check environment health first:

```bash
boss doctor --json
```

- If `boss` is missing on a new Mac, run `bash "$SKILL_DIR/scripts/bootstrap.sh" [path-to-boss-cli]` or copy/install from the portable kit.
- If `doctor` reports AppleScript JS disabled, guide the user: Safari Settings -> Advanced -> Show features for web developers -> Develop menu -> **Allow JavaScript from Apple Events**.
- If not logged in, open `https://www.zhipin.com` in Safari (`boss login`) and pause until the user completes QR/phone login.

### Step 1: Align Open JD & Local Project Tech Stack

Collect exact hiring requirements and what the team is actually building:

```bash
boss positions --json
boss jd "<职位名称>" --refresh --json
node "$SKILL_DIR/scripts/scan_projects.mjs" --dir "<workspace-root>" --json
```

Review the cached JD markdown (`~/.boss-cli/jd/<职位>.md`) and `scan_projects.mjs` output to note:
- Hard constraints: target city, **on-site interview/work requirement**, salary range, degree, years of experience.
- Core engineering stack and AI patterns actually used by the team (e.g., Java + Python dual-stack, LangGraph, MCP, pgvector, OpenClaw/WorkBuddy/Codex, B2B RBAC).

### Step 2: Human-Paced Candidate Collection & Photo Download

For **unread inbox triage** (recommended when many candidates messaged):

```bash
boss inspect-unread --max 120 --pause-every 25 --json
# If pending > 0 and time/batch limit reached, resume without re-reading earlier rows:
boss inspect-unread --resume --max 150 --pause-every 25 --json
```

What this saves automatically:
- Structured profiles, timelines, messages, and image references -> `~/.boss-cli/unread-inspect.json`
- Candidate HD avatars + candidate-sent image resumes -> `~/.boss-cli/avatars/`

For **active sourcing** instead of inbox:
- `boss recommend "<职位>" --limit 30 --skip-viewed --skip-colleague --exclude-tracked --json`
- `boss search "<关键词>" --limit 30 --exclude-tracked --json`

### Step 3: Multimodal Inspection of Candidate-Sent Resume Images

Check if any candidate sent image resumes:

```bash
node -e "const d=require(process.env.HOME+'/.boss-cli/unread-inspect.json'); console.log(d.candidates.filter(c=>c.friendImageLocalPaths?.length).map(c=>({order:c.order,name:c.name,imgs:c.friendImageLocalPaths})));"
```

Read every listed image file with your multimodal vision/read tool, extract concrete project architectures, tools (e.g., Codex, WorkBuddy, OpenClaw, LangGraph, MinerU, RBAC), and metrics, and record them in `dashboard/expert-overrides.json` (format in [references/rubric-schema.md](references/rubric-schema.md)).

### Step 4: Build Tailored `rubric.json`

Read [references/rubric-schema.md](references/rubric-schema.md) and start from [references/rubric-presets.json](references/rubric-presets.json). Save a customized `dashboard/rubric.json` reflecting:
- `job`: exact `title`, `company`, `location`, `salary`, `targetCity`, `requireOnSite`, `gradReferenceYear`, `expIdealRange`, `salaryTargetMax`.
- `projectsSummary`: concise summary of local projects found in Step 1.
- `dimensions` + `signals`: 4 custom technical/business dimensions (totaling e.g. 90 points) + `baseDimension` (10 points).
- `modifiers`: isolate `27/28届` current-student interns if full-time hire, penalize non-target cities when on-site interview is required, detect template-only greetings so we don't waste online resume quota on them.

### Step 5: Generate Dashboard, Report & Sync Tracker

Run the parameterized dashboard builder:

```bash
node "$SKILL_DIR/scripts/generate_dashboard.mjs" \
  --input ~/.boss-cli/unread-inspect.json \
  --config ./dashboard/rubric.json \
  --overrides ./dashboard/expert-overrides.json \
  --jd ~/.boss-cli/jd/"<职位>".md \
  --avatars-src ~/.boss-cli/avatars \
  --out-dir ./dashboard \
  --report ./shortlist-report.md \
  --open
```

Verify outputs:
- `./dashboard/index.html` (completely offline interactive Safari dashboard with KPI cards, search/city/exp/tech filters, detail drawer, inline resume images, HR mark buttons, CSV export)
- `./dashboard/candidates-scored.json` & `./dashboard/avatars/`
- `./shortlist-report.md` (human-readable rubric + ranked shortlist + interview prompts)
- Synced `~/.boss-cli/tracker.json` (`boss tracker stats`)

### Step 6: Present Shortlist & Wait for Explicit Confirmation

Present to the user:
1. Screening stats & avatar/resume-image counts;
2. Tailored 100-point rubric table aligned to their active projects;
3. Top S/A ranked candidates with highlights, risk flags (city, on-site, salary, graduation date), and draft replies;
4. Links to `dashboard/index.html` and `shortlist-report.md`.

Only after the user explicitly selects specific candidates:
- Inspect full online resume if needed: `boss chat "<姓名>" --json && boss preview ... --json` (or `boss action resume --json`).
- Execute approved replies strictly with `--confirm` and an explicit target: `boss send --to "<姓名>" --strict -t "<话术>" --confirm`.

## References

- Rubric DSL, modifiers, and override schema: [references/rubric-schema.md](references/rubric-schema.md)
- Default presets to copy & adapt: [references/rubric-presets.json](references/rubric-presets.json)
- Full `boss` CLI reference & DS Harness / WorkBuddy setup: [references/cli-and-harness-guide.md](references/cli-and-harness-guide.md)
