import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameTarget, SafariPage } from '../browser/index.js';
import { sleepRandom } from '../browser/index.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { clickBossSidebarMenuToPath } from '../common/boss_sidebar_nav.js';
import { ensureAppDataLayout, JD_DIR } from '../config.js';

export type ListOpenPositionsDeps = {
  detail?: boolean;
  detailName?: string;
  refresh?: boolean;
  json?: boolean;
  projectDir?: string;
};

const BOSS_CHAT_JOB_LIST_URL = 'https://www.zhipin.com/web/chat/job/list';

function isBossChatJobListUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('zhipin.com')) return false;
    return (u.pathname.replace(/\/+$/, '') || '/') === '/web/chat/job/list';
  } catch {
    return false;
  }
}

export type JobListItem = {
  id: string;
  title: string;
  label: string;
  status: string;
  meta: string[];
  viewed: string;
  chatted: string;
  interested: string;
};

type JobReadResult = {
  rows: number;
  totalText: string;
  url: string;
  jobs: JobListItem[];
};

type JobDetail = {
  pageTitle: string;
  pageUrl: string;
  company: string;
  recruitmentType: string;
  jobName: string;
  description: string;
  overseas: string;
  jobCategory: string;
  experience: string;
  education: string;
  salaryRange: string;
  salaryMonths: string;
  keywords: string;
  workLocation: string;
};

function resolveTargetJob(jobs: JobListItem[], detailInput: string): JobListItem | null {
  const raw = detailInput.trim();
  if (!raw) return null;
  const exact = jobs.find((job) => job.title === raw);
  if (exact) return exact;
  const needle = raw.toLowerCase();
  const fuzzy = jobs.filter((job) => job.title.toLowerCase().includes(needle));
  if (fuzzy.length === 1) return fuzzy[0] ?? null;
  if (fuzzy.length > 1) {
    const picks = fuzzy.slice(0, 8).map((j, idx) => `${idx + 1}. ${j.title}`).join('｜');
    throw new Error(`“${raw}”命中多个职位，请改用更精确名称。候选：${picks}`);
  }
  return null;
}

function stripControlChars(input: string): string {
  return input.replace(/[<>:"/\\|?*]/g, '_');
}

function cacheFileCandidates(projectDir: string, title: string): string[] {
  const exact = path.resolve(projectDir, `${title}.md`);
  const safe = path.resolve(projectDir, `${stripControlChars(title)}.md`);
  return safe === exact ? [exact] : [exact, safe];
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** 兼容 Boss 新版 job_v2/list (li.job-item-container) 与旧版 (.job-jobInfo-warp) */
const READ_JOBS_BODY = `
  const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
  const v2Rows = Array.from(document.querySelectorAll(".job-item-container"));
  const v1Rows = Array.from(document.querySelectorAll(".job-jobInfo-warp"));

  const jobs = v2Rows.length > 0
    ? v2Rows.map((el) => {
        const title = norm(el.querySelector(".job-name, .job-title a")?.textContent);
        const label = Array.from(el.querySelectorAll(".job-labels .base-label, .job-title .label-common"))
          .map((x) => norm(x.textContent))
          .filter(Boolean)
          .join(" ");
        const meta = Array.from(
          el.querySelectorAll(".job-main-info-wrapper .info-labels .divider-label-text, .job-main-info-wrapper .info-labels span"),
        )
          .map((x) => norm(x.textContent))
          .filter(Boolean);
        const nums = Array.from(el.querySelectorAll(".job-about-num-wrapper .inner-box .num")).map((x) => norm(x.textContent));
        const status = norm(el.querySelector(".job-status-wrapper .status-box")?.textContent);
        return {
          id: norm(el.getAttribute("data-id")),
          title,
          label,
          status,
          meta,
          viewed: nums[0] || "0",
          chatted: nums[1] || "0",
          interested: nums[2] || "0",
        };
      })
    : v1Rows.map((el) => {
        const statusText = norm(el.querySelector(".job-status-wrapper .status-box")?.textContent);
        const labelText = norm(el.querySelector(".job-title .label-common")?.textContent);
        const meta = Array.from(el.querySelectorAll(".job-main-info-wrapper .info-labels span"))
          .map((x) => norm(x.textContent))
          .filter(Boolean);
        const nums = Array.from(el.querySelectorAll(".job-about-num-wrapper .inner-box .num")).map((x) => norm(x.textContent));
        return {
          id: norm(el.getAttribute("data-id")),
          title: norm(el.querySelector(".job-title a")?.textContent),
          label: labelText,
          status: statusText,
          meta,
          viewed: nums[0] || "0",
          chatted: nums[1] || "0",
          interested: nums[2] || "0",
        };
      });

  const totalText = norm(document.querySelector(".total-num")?.textContent);
  return { rows: Math.max(v2Rows.length, v1Rows.length), totalText, url: location.href, jobs };
`;

const READ_JOB_DETAIL_BODY = `
  const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
  const root =
    document.querySelector(".job-edit-container.edit-job") ||
    document.querySelector(".job-edit-container") ||
    (document.querySelector("input[name='jobName']") ? document.body : null);
  if (!root) return null;

  const rowValueByTitle = {};
  for (const row of Array.from(root.querySelectorAll(".form-row, .form-item"))) {
    const title = norm(row.querySelector(".title, .label")?.textContent);
    if (!title) continue;
    const content = norm(row.querySelector(".content, .value")?.innerText);
    if (content && !rowValueByTitle[title]) rowValueByTitle[title] = content;
  }

  const salaryValues = Array.from(
    root.querySelectorAll(".scope-selecter .scope-select .ui-select-selected-value, .salary-select .ui-select-selected-value"),
  ).map((el) => norm(el.textContent));
  const keywordValues = Array.from(
    root.querySelectorAll(".job-skill-content .job-skill-item, .job-skill-content .skill-tag, .job-skill-content .tag"),
  )
    .map((el) => norm(el.textContent))
    .filter(Boolean);

  const rawDesc =
    root.querySelector(".performance-row textarea")?.value ||
    root.querySelector("textarea")?.value ||
    "";

  return {
    pageTitle: document.title || "",
    pageUrl: location.href,
    company: norm(root.querySelector(".base-info .text-primary, .company-name")?.textContent) || (rowValueByTitle["公 司"] || rowValueByTitle["公司"] || ""),
    recruitmentType: norm(root.querySelector(".recruitment-type-wrap .ui-select-selected-value")?.textContent) || (rowValueByTitle["招聘类型"] || ""),
    jobName:
      norm(root.querySelector("input[name='jobName']")?.value) ||
      norm(root.querySelector(".job-name input")?.value) ||
      (rowValueByTitle["职位名称"] || ""),
    description: rawDesc.trim(),
    overseas: norm(root.querySelector(".overseas-entry-container .chose-item.active")?.textContent),
    jobCategory:
      norm(root.querySelector("input[name='jobCategory']")?.value) ||
      norm(root.querySelector(".job-category-tag-container")?.innerText) ||
      (rowValueByTitle["职位类型"] || ""),
    experience:
      norm(root.querySelector(".job-experience-row .experience-select .ui-select-selected-value")?.textContent) ||
      (rowValueByTitle["经验"] || ""),
    education: rowValueByTitle["学历"] || "",
    salaryRange: salaryValues.length >= 2 ? salaryValues[0] + "-" + salaryValues[1] : salaryValues.join("-"),
    salaryMonths: norm(root.querySelector(".salaryMonth-select .ui-select-selected-value")?.textContent),
    keywords: keywordValues.join("｜"),
    workLocation:
      norm(root.querySelector(".job-address input.ipt, .address-input input")?.value) ||
      (rowValueByTitle["工作地点"] || ""),
  };
`;

async function waitForJobRowsReady(
  page: SafariPage,
  timeoutMs = 16_000,
): Promise<{ target: FrameTarget; data: JobReadResult }> {
  return page.waitFor(
    async () => {
      const results = await page.evalInAllFrames<JobReadResult>(READ_JOBS_BODY);
      const hit = results.find((r) => r.value.jobs.length > 0 || (r.value.rows === 0 && r.value.totalText === '共0个职位'));
      return hit ? { target: hit.target, data: hit.value } : false;
    },
    timeoutMs,
    250,
    450,
    '等待职位列表加载',
  );
}

async function waitForJobDetailReady(page: SafariPage, timeoutMs = 12_000): Promise<JobDetail> {
  return page.waitFor(
    async () => {
      const results = await page.evalInAllFrames<JobDetail | null>(READ_JOB_DETAIL_BODY);
      const hit = results.find((r) => r.value !== null && (r.value.jobName.length > 0 || r.value.description.length > 0));
      return hit?.value ?? false;
    },
    timeoutMs,
    260,
    460,
    '等待职位详情表单加载',
  );
}

async function closeJobDetailPanel(page: SafariPage): Promise<void> {
  const clicked = await page.eval<boolean>(`
    const backBtn = document.querySelector(".top-nav .history-back-container .back-btn");
    if (backBtn instanceof HTMLElement) { backBtn.click(); return true; }
    return false;
  `).catch(() => false);
  if (!clicked) {
    await clickBossSidebarMenuToPath(page, '职位管理', '/web/chat/job/list').catch(() => {});
  }
}

function formatJobDetailMarkdown(job: JobListItem, detail: JobDetail): string {
  return [
    `# ${job.title}`,
    '',
    `- 状态: ${job.status || '未知'}`,
    `- 标签: ${job.label || '无'}`,
    `- 概览: ${job.meta.join('｜') || '未知'}`,
    `- 数据: 看过我 ${job.viewed}｜沟通过 ${job.chatted}｜感兴趣 ${job.interested}`,
    '',
    '## 基本信息',
    `- 公司: ${detail.company || '未知'}`,
    `- 招聘类型: ${detail.recruitmentType || '未知'}`,
    `- 职位名称: ${detail.jobName || job.title}`,
    `- 职位类型: ${detail.jobCategory || '未知'}`,
    `- 是否驻外: ${detail.overseas || '未知'}`,
    '',
    '## 要求',
    `- 经验: ${detail.experience || '未知'}`,
    `- 学历: ${detail.education || '未知'}`,
    `- 薪资范围: ${detail.salaryRange || '未知'}`,
    `- 薪资月数: ${detail.salaryMonths || '未知'}`,
    `- 关键词: ${detail.keywords || '无'}`,
    `- 工作地点: ${detail.workLocation || '未知'}`,
    '',
    '## 职位描述',
    detail.description || '（空）',
    '',
  ].join('\n');
}

export async function runListOpenPositions(deps: ListOpenPositionsDeps = {}): Promise<string> {
  ensureAppDataLayout();
  const detailMode = deps.detail === true;
  const detailName = (deps.detailName ?? '').trim();
  const projectDir = deps.projectDir ?? JD_DIR;

  if (detailMode && detailName && !deps.refresh) {
    for (const p of cacheFileCandidates(projectDir, detailName)) {
      if (await fileExists(p)) {
        const markdown = await readFile(p, 'utf8');
        if (deps.json) {
          return JSON.stringify({ cached: true, filePath: p, markdown }, null, 2);
        }
        return markdown;
      }
    }
  }

  return withBossSessionPage(async (page) => {
    if (!isBossChatJobListUrl(await page.url())) {
      await clickBossSidebarMenuToPath(page, '职位管理', '/web/chat/job/list');
      await sleepRandom(1200, 2200);
    }
    if (!isBossChatJobListUrl(await page.url())) {
      throw new Error('通过侧边栏“职位管理”进入职位页失败，请确认已登录并可访问 /web/chat/job/list。');
    }

    const ready = await waitForJobRowsReady(page, 16_000);
    const jobs = ready.data.jobs.filter((it) => it.title.length > 0);

    if (!detailMode) {
      const openCount = jobs.filter((it) => it.status.includes('开放中')).length;
      const waitOpenCount = jobs.filter((it) => it.status.includes('待开放')).length;
      const closedCount = jobs.filter((it) => it.status.includes('已关闭')).length;

      if (deps.json) {
        return JSON.stringify(
          {
            sourceUrl: BOSS_CHAT_JOB_LIST_URL,
            totalText: ready.data.totalText,
            stats: { total: jobs.length, open: openCount, waitOpen: waitOpenCount, closed: closedCount },
            jobs,
          },
          null,
          2,
        );
      }

      const jobLines = jobs.map((it, idx) => {
        const info = it.meta.length > 0 ? it.meta.join('｜') : '信息缺失';
        const stats = `看过我:${it.viewed}｜沟通过:${it.chatted}｜感兴趣:${it.interested}`;
        const tag = it.label ? `｜标签:${it.label}` : '';
        const id = it.id ? `｜ID:${it.id}` : '';
        return `${idx + 1}. ${it.title}｜状态:${it.status || '未知'}${tag}｜${info}｜${stats}${id}`;
      });
      return [
        `已读取 ${jobs.length} 个职位${ready.data.totalText ? `（页面统计：${ready.data.totalText}）` : ''}。`,
        `状态统计：开放中 ${openCount}｜待开放 ${waitOpenCount}｜已关闭 ${closedCount}`,
        `来源页面：${BOSS_CHAT_JOB_LIST_URL}`,
        `职位明细：\n${jobLines.length > 0 ? jobLines.join('\n') : '当前页面未读取到职位。'}`,
      ].join('\n');
    }

    const targetJob = resolveTargetJob(jobs, detailName);
    if (!targetJob) {
      const available = jobs.slice(0, 8).map((j) => j.title).join('｜');
      throw new Error(`未找到职位“${detailName}”。可选职位：${available || '（空）'}`);
    }

    const clicked = await page.evalInFrame<boolean>(
      ready.target,
      `
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const rows = Array.from(document.querySelectorAll(".job-item-container, .job-jobInfo-warp"));
      let row = args.jobId ? rows.find((el) => norm(el.getAttribute("data-id")) === args.jobId) : null;
      if (!row) {
        row = rows.find((el) => norm(el.querySelector(".job-name, .job-title a")?.textContent) === args.title) ?? null;
      }
      if (!row) return false;
      const editBtn =
        row.querySelector(".position-edit") ||
        Array.from(row.querySelectorAll(".operate-btn, a, button, span")).find((b) => norm(b.textContent) === "编辑");
      if (!(editBtn instanceof HTMLElement)) return false;
      editBtn.click();
      return true;
      `,
      { jobId: targetJob.id, title: targetJob.title },
    );
    if (!clicked) throw new Error(`未找到职位“${targetJob.title}”的编辑入口。`);

    await sleepRandom(1400, 2400);
    const detail = await waitForJobDetailReady(page, 14_000);
    const candidates = cacheFileCandidates(projectDir, targetJob.title);
    const outPath = candidates[candidates.length - 1]!;
    const markdown = formatJobDetailMarkdown(targetJob, detail);
    await writeFile(outPath, markdown, 'utf8');
    await closeJobDetailPanel(page);

    if (deps.json) {
      return JSON.stringify({ cached: false, filePath: outPath, job: targetJob, detail, markdown }, null, 2);
    }
    return markdown;
  });
}
