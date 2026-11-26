---
name: boss-safari-recruiter
description: End-to-end Boss Zhipin AI recruiting workflow via host macOS Safari (`boss_*` tools). Use when checking Boss Safari readiness, reading job JDs, screening unread chats or recommended candidates, scoring candidates against a tailored rubric, updating the local candidate tracker, or drafting and executing human-approved Boss replies.
---

# Boss Safari Recruiter SOP (DeepSeek Harness Edition)

This skill guides you through safe, high-signal Boss Zhipin recruiting using the native `boss_*` tools registered by `dsh-plugin-boss-recruiter`.

## Non-Negotiable Safety Rules

1. **Real macOS Safari Only**: All Boss operations drive the user's real `/Applications/Safari.app`. Never suggest bundling browsers, running headless scrapers, or injecting anti-bot bypass code.
2. **Immediate Human Handoff on Verification / Login**: If any `boss_*` tool reports a login wall, security verification / CAPTCHA, or HTTP 403, **stop immediately** and ask the user to resolve it in their Safari window before continuing. Never poll or attempt to bypass verification.
3. **Read-First, Approval-Gated Writes**:
   - Complete all screening, scoring, and tracker updates using read-only tools first.
   - Present a crisp candidate ranking table (score, highlights, risks, drafted message) to the user.
   - Outbound write tools (`boss_send_message`, `boss_greet_candidate`, `boss_chat_action`) trigger a native DeepSeek Harness approval card when `dryRun` is false, and also enforce local daily quotas and minimum write spacing (`>= 10s`). Use `dryRun: true` first whenever the user asks to preview or rehearse an outreach action.
4. **Protect Daily Preview Quota**: Never call `boss_preview_resume` on every candidate blindly. Filter using card summaries and chat histories first, and only inspect online resumes for shortlisted high-potential candidates.

## Standard Recruiting Workflow

### Phase 1: Environment & Job Alignment
1. Call `boss_doctor` to verify macOS Safari is running, "Allow JavaScript from Apple Events" is enabled, Boss Zhipin is logged in, and check today's remaining quotas.
2. Call `boss_positions` to list open roles, then `boss_jd` for the target role to capture exact qualifications, city/on-site requirements, salary band, and responsibilities.
3. Call `boss_quota` if you need to check configured default outreach templates or remaining daily limits.

### Phase 2: Tailored Screening Rubric
- Combine the fetched JD with the team's actual project stack (if the user has a local workspace open, inspect READMEs / manifests to align technical requirements).
- Use the declarative rubric model in `references/rubric-schema.md` and `references/rubric-presets.json` to score candidates transparently on a 0–100 scale across core competencies, engineering depth, domain delivery, and on-site/salary feasibility.
- Separate tiers clearly:
  - **S (80–100)**: Strong match -> `shortlisted`
  - **A (66–79)**: High potential -> `shortlisted` or deep resume check
  - **B (48–65)**: Backup / needs info -> `screened` or `hold`
  - **C (<48)**: Mismatch -> `rejected` or `hold`

### Phase 3: Human-Paced Sourcing & Inbox Inspection
- **Unread Inbox**: Call `boss_inspect_unread` (uses natural human-paced delays and can download avatars/image resumes) or `boss_list_chats` (`unreadOnly: true`) + `boss_read_chat`.
- **Recommend / Search**: Call `boss_recommend` (`skipViewed: true`, `skipColleague: true`, `excludeTracked: true`) or `boss_search_candidates`.
- Check colleague contact history (`boss_read_chat` with `includeHistory: true`) before contacting borderline threads to avoid colliding with teammates.
- Only call `boss_preview_resume` for shortlisted candidates whose chat/card info is insufficient. If an image resume or canvas screenshot path is returned, inspect the image directly when your model supports vision.

### Phase 4: Local Tracker Persistence & Shortlist Reporting
1. Call `boss_tracker_upsert` for every evaluated candidate with `name`, `geekId` (when available), `job`, `stage` (`new | screened | shortlisted | greeted | replied | interview | hold | rejected`), `score`, `summary`, and `reason`.
2. Present a structured Markdown ranking table to the user:
   - Rank, Name, Score (0–100), Tier, Stage, Core Highlights, Key Risks / Questions to Verify, Recommended Next Action.
3. Mention that the user can inspect the full visual board, drag stages, compare candidates, and review messages in the embedded **招聘助手** workbench at `/boss-desk/` (when running `dsh web`).

### Phase 5: Controlled Outreach
- When the user approves contacting specific candidates:
  - Prefer the configured `defaultReplyTemplate` (returned by `boss_quota`, customizable in plugin settings for any company location/interview flow) unless the user asks for a custom draft.
  - Call `boss_send_message` with `to` (exact candidate name) and `strict: true` so the CLI verifies the active chat header matches the intended candidate before sending.
  - Wait for the user's decision on the native DeepSeek Harness approval prompt, then record updated status via `boss_tracker_upsert` (`stage: 'greeted'` or `'replied'`).
