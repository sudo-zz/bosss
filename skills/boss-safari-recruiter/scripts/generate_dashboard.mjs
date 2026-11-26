#!/usr/bin/env node
/**
 * Portable candidate scoring engine, offline HTML dashboard builder,
 * Markdown shortlist generator, and boss tracker synchronizer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRESETS_PATH = path.resolve(__dirname, '../references/rubric-presets.json');

/** Parse CLI flags into structured options. */
export function parseCliArgs(argv) {
  const home = process.env.HOME || '.';
  const opts = {
    input: path.join(home, '.boss-cli/unread-inspect.json'),
    config: '',
    jd: '',
    overrides: '',
    avatarsSrc: path.join(home, '.boss-cli/avatars'),
    outDir: path.resolve(process.cwd(), 'dashboard'),
    report: path.resolve(process.cwd(), 'shortlist-report.md'),
    tracker: path.join(home, '.boss-cli/tracker.json'),
    syncTracker: true,
    openSafari: false,
    json: true,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--input' && argv[i + 1]) opts.input = path.resolve(argv[++i]);
    else if (a === '--config' && argv[i + 1]) opts.config = path.resolve(argv[++i]);
    else if (a === '--jd' && argv[i + 1]) opts.jd = path.resolve(argv[++i]);
    else if (a === '--overrides' && argv[i + 1]) opts.overrides = path.resolve(argv[++i]);
    else if (a === '--avatars-src' && argv[i + 1]) opts.avatarsSrc = path.resolve(argv[++i]);
    else if (a === '--out-dir' && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === '--report' && argv[i + 1]) opts.report = path.resolve(argv[++i]);
    else if (a === '--tracker' && argv[i + 1]) opts.tracker = path.resolve(argv[++i]);
    else if (a === '--no-tracker') opts.syncTracker = false;
    else if (a === '--open') opts.openSafari = true;
    else if (a === '--quiet') opts.json = false;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node generate_dashboard.mjs [--input <unread.json>] [--config <rubric.json>] [--jd <jd.md>] [--overrides <overrides.json>] [--avatars-src <dir>] [--out-dir <dir>] [--report <file>] [--no-tracker] [--open]',
      );
      process.exit(0);
    }
  }
  return opts;
}

function readJsonIfExists(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Load default AI engineering rubric preset cleanly. */
function loadDefaultRubric() {
  const raw = readJsonIfExists(PRESETS_PATH);
  if (!raw?.presets?.length) {
    throw new Error(`Missing rubric presets at ${PRESETS_PATH}`);
  }
  return structuredClone(raw.presets[0].rubric);
}

/** Merge user rubric config over preset defaults while keeping nested structures intact. */
function loadRubricConfig(configPath, jdPath) {
  const base = loadDefaultRubric();
  const custom = readJsonIfExists(configPath, {});
  const merged = {
    ...base,
    ...custom,
    job: { ...base.job, ...(custom.job || {}) },
    signals: custom.signals ? { ...custom.signals } : { ...base.signals },
    dimensions: Array.isArray(custom.dimensions) ? custom.dimensions : base.dimensions,
    baseDimension: { ...base.baseDimension, ...(custom.baseDimension || {}) },
    modifiers: { ...base.modifiers, ...(custom.modifiers || {}) },
    tiers: { ...base.tiers, ...(custom.tiers || {}) },
    techFilters: Array.isArray(custom.techFilters) ? custom.techFilters : base.techFilters,
    replyTemplates: { ...base.replyTemplates, ...(custom.replyTemplates || {}) },
  };

  if (jdPath && fs.existsSync(jdPath)) {
    const jdText = fs.readFileSync(jdPath, 'utf8');
    if (!custom.job?.title) {
      const mTitle = jdText.match(/^#\s*(.+)$/m);
      if (mTitle) merged.job.title = mTitle[1].trim();
    }
    if (!custom.job?.salary) {
      const mSal = jdText.match(/(\d+\s*-\s*\d+\s*[kK][·\d个月薪]*)/);
      if (mSal) merged.job.salary = mSal[1].trim();
    }
  }
  return merged;
}

function compileRegex(pattern, fallback = /(?!)/i) {
  if (!pattern) return fallback;
  return new RegExp(pattern, 'i');
}

function compileSignals(signalMap) {
  const out = {};
  for (const [key, pattern] of Object.entries(signalMap || {})) {
    out[key] = compileRegex(pattern);
  }
  return out;
}

/** Safe boolean expression evaluator over named signal flags (`&&`, `||`, `!`, `(...)`). */
function evalSignalExpr(expr, env) {
  if (!expr) return false;
  const tokens = expr.match(/&&|\|\||!|\(|\)|[a-zA-Z0-9_]+/g) || [];
  let pos = 0;

  function peek() {
    return tokens[pos];
  }
  function consume() {
    return tokens[pos++];
  }
  function parseOr() {
    let val = parseAnd();
    while (peek() === '||') {
      consume();
      val = val || parseAnd();
    }
    return val;
  }
  function parseAnd() {
    let val = parseUnary();
    while (peek() === '&&') {
      consume();
      val = val && parseUnary();
    }
    return val;
  }
  function parseUnary() {
    if (peek() === '!') {
      consume();
      return !parseUnary();
    }
    if (peek() === '(') {
      consume();
      const val = parseOr();
      if (peek() === ')') consume();
      return val;
    }
    const tok = consume();
    return Boolean(tok && env[tok]);
  }
  return parseOr();
}

/** Copy candidate avatars and chat resume images locally so HTML dashboard works 100% offline. */
function syncOfflineAvatars(candidates, avatarsSrc, outDir) {
  const destAvatarsDir = path.join(outDir, 'avatars');
  fs.mkdirSync(destAvatarsDir, { recursive: true });
  for (const c of candidates) {
    const paths = [c.avatarLocalPath, ...(c.friendImageLocalPaths || [])].filter(Boolean);
    for (const p of paths) {
      const base = path.basename(p);
      const dest = path.join(destAvatarsDir, base);
      if (fs.existsSync(dest)) continue;
      const srcCandidate = fs.existsSync(p) ? p : avatarsSrc ? path.join(avatarsSrc, base) : '';
      if (srcCandidate && fs.existsSync(srcCandidate)) {
        fs.copyFileSync(srcCandidate, dest);
      }
    }
  }
}

function resolveOverride(c, overridesMap) {
  if (!overridesMap) return null;
  return overridesMap[`${c.name}#${c.order}`] || overridesMap[c.name] || null;
}

function parseCandidateFacts(c, rubric, override) {
  const job = rubric.job;
  const mods = rubric.modifiers;
  const facts = c.basicFacts || [];
  const ageStr = facts.find((x) => /\d+岁/.test(x)) || '';
  const age = ageStr ? parseInt(ageStr, 10) : null;
  const edu = facts.find((x) => /博士|硕士|本科|大专|MBA/.test(x)) || '未知';
  const expStr = facts.find((x) => /年|应届|在校/.test(x)) || '未知';

  const gradSuffix = String(job.gradReferenceYear || new Date().getFullYear()).slice(-2);
  const gradRegex = new RegExp(`${gradSuffix}年应届`);

  let expYears = null;
  if (/应届|在校/.test(expStr)) {
    expYears = gradRegex.test(expStr) ? 0.8 : 0;
  } else {
    const mYear = expStr.match(/^(\d+)\s*年/);
    if (mYear) expYears = parseInt(mYear[1], 10);
    else if (/1年以内/.test(expStr)) expYears = 0.5;
  }

  const rawMsgCorpus = (c.messages || []).map((m) => m.text).join(' ');
  const internRe = compileRegex(mods.internSignal);
  const gradOverrideRe = compileRegex(mods.graduatedOverride);
  const is27or28Intern =
    (internRe.test(expStr) || internRe.test(rawMsgCorpus)) && !gradOverrideRe.test(rawMsgCorpus);

  const expParts = (c.expectation || '').split('·');
  const expectCity = (expParts[0] || '').trim() || '未注明';
  const expectRoleSalary = (expParts[1] || '').trim();

  let salaryMin = null;
  let salaryMax = null;
  let salaryText = '面议/未标';
  const salMatch = expectRoleSalary.match(/(\d+)\s*-\s*(\d+)\s*[Kk]/);
  if (salMatch) {
    salaryMin = parseInt(salMatch[1], 10);
    salaryMax = parseInt(salMatch[2], 10);
    salaryText = `${salaryMin}-${salaryMax}K`;
  } else if (/面议/.test(expectRoleSalary)) {
    salaryText = '面议';
  }

  const targetAliases = (job.cityAliases && job.cityAliases.length ? job.cityAliases : [job.targetCity || ''])
    .filter(Boolean);
  let cityLocationType = 'unknown';
  if (targetAliases.length === 0 || !job.targetCity) {
    cityLocationType = expectCity === '未注明' ? 'unknown' : 'target_only';
  } else if (expectCity !== '未注明') {
    const exactMatch = targetAliases.some((a) => expectCity.trim() === a);
    const partialMatch = targetAliases.some((a) => expectCity.includes(a));
    cityLocationType = exactMatch ? 'target_only' : partialMatch ? 'includes_target' : 'non_target';
  }

  const timelines = c.experienceTimelines || [];
  const eduEntry = timelines.find((t) => /大学|学院|school|硕士|本科|大专/i.test(t.detail)) || timelines[timelines.length - 1];
  const workEntries = timelines.filter((t) => t !== eduEntry && !/未填写工作经历/.test(t.detail));

  const msgText = (c.messages || [])
    .filter((m) => m.from === 'friend')
    .map((m) => m.text)
    .join('\n');

  const fullCorpus = [
    c.name,
    c.active,
    facts.join(' '),
    timelines.map((t) => `${t.time} ${t.detail}`).join(' '),
    c.expectation,
    c.remark,
    msgText,
    override?.extraResumeText || '',
  ]
    .join('\n')
    .toLowerCase();

  return {
    age,
    ageStr,
    edu,
    expStr,
    expYears,
    isGradFullTime: gradRegex.test(expStr),
    is27or28Intern,
    expectCity,
    expectRoleSalary,
    salaryMin,
    salaryMax,
    salaryText,
    cityLocationType,
    eduEntry,
    workEntries,
    msgText,
    override,
    fullCorpus,
    msgAndOverrideText: `${msgText} ${override?.extraResumeText || ''}`.toLowerCase(),
  };
}

function buildSignalEnv(compiledSignals, text, extraFlags) {
  const env = { ...extraFlags };
  for (const [k, re] of Object.entries(compiledSignals)) {
    env[k] = re.test(text);
  }
  return env;
}

function applyRuleOutcome(rule, matchedProjects, highlights, risks) {
  if (rule.highlight) highlights.push(rule.highlight);
  if (rule.risk) risks.push(rule.risk);
  if (rule.addProject) matchedProjects.add(rule.addProject);
  return rule.points || 0;
}

function evaluateDynamicDimension(dim, fullEnv, msgEnv, highlights, risks, matchedProjects) {
  let score = 0;

  for (const group of dim.exclusiveGroups || []) {
    for (const branch of group) {
      const env = branch.textScope === 'messageAndOverride' ? msgEnv : fullEnv;
      if (evalSignalExpr(branch.when, env)) {
        score += applyRuleOutcome(branch, matchedProjects, highlights, risks);
        break;
      }
    }
  }

  for (const rule of dim.additive || []) {
    const env = rule.textScope === 'messageAndOverride' ? msgEnv : fullEnv;
    if (evalSignalExpr(rule.when, env)) {
      score += applyRuleOutcome(rule, matchedProjects, highlights, risks);
    }
  }

  for (const capRule of dim.caps || []) {
    if (evalSignalExpr(capRule.when, fullEnv)) {
      score = Math.min(score, capRule.maxScore);
      if (capRule.risk) risks.push(capRule.risk);
    }
  }

  return Math.min(dim.maxScore || 25, Math.max(0, score));
}

function evaluateBaseDimension(facts, rubric, highlights, risks) {
  const job = rubric.job;
  const maxBase = rubric.baseDimension?.maxScore || 10;
  const targetCity = job.targetCity || '目标城市';
  let sBase = 0;

  if (facts.edu === '硕士' || facts.edu === '博士') sBase += 3;
  else if (facts.edu === '本科') sBase += 2.5;
  else {
    sBase += 0.5;
    if (job.allowCollege === false) risks.push('大专学历(JD要求本科及以上)');
  }

  const [expMin, expMax] = job.expIdealRange || [1, 4];
  const seniorCutoff = job.expSeniorCutoff || 8;
  if (facts.expYears !== null && facts.expYears >= expMin && facts.expYears <= expMax) {
    sBase += 2.5;
  } else if (facts.expYears !== null && facts.expYears > expMax && facts.expYears < seniorCutoff) {
    sBase += 1.5;
  } else if (facts.expYears !== null && facts.expYears >= seniorCutoff) {
    sBase += 1;
    risks.push('资深年限(注意预算与定位匹配)');
  } else if (facts.isGradFullTime) {
    sBase += 2;
    highlights.push(`${String(job.gradReferenceYear || 2026).slice(-2)}届已毕业可全职`);
  }

  const onSiteRe = compileRegex(job.onSiteRegex || `配合${targetCity}现场|来${targetCity}`);
  const mentionsOnSite = onSiteRe.test(facts.fullCorpus);

  if (facts.cityLocationType === 'target_only') {
    sBase += 3;
  } else if (facts.cityLocationType === 'includes_target') {
    sBase += 2;
    if (job.requireOnSite && !mentionsOnSite) {
      risks.push(`双城意向(需核实${targetCity}现场面试)`);
    }
  } else if (facts.cityLocationType === 'non_target') {
    if (mentionsOnSite) {
      sBase += 1.5;
      risks.push(`外地期望但声明可来${targetCity}面`);
    } else if (job.requireOnSite) {
      risks.push(`纯外地期望(${facts.expectCity})·不满足${targetCity}现场面试`);
    }
  } else {
    sBase += 1.5;
  }

  const salMax = job.salaryTargetMax || 19;
  const salSoftMax = job.salarySoftMax || salMax + 3;
  const salWarnMin = job.salaryWarnMin || salMax + 1;
  if (facts.salaryMin !== null) {
    if (facts.salaryMin <= salMax && (facts.salaryMax === null || facts.salaryMax <= salSoftMax)) {
      sBase += 2;
    } else if (facts.salaryMin > salWarnMin) {
      risks.push(`薪资期望偏高(${facts.salaryText} vs ${job.salary || `${salMax}K`})`);
    } else {
      sBase += 1;
    }
  } else {
    sBase += 1;
  }

  if (/在线中|刚刚活跃/.test(facts.fullCorpus)) sBase += 0.5;
  return {
    score: Math.min(maxBase, Math.round(sBase)),
    mentionsOnSite,
  };
}

function formatTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function buildReplyDraft(c, tier, facts, isTemplateOnly, highlights, rubric) {
  const tpls = rubric.replyTemplates || {};
  const targetCity = rubric.job.targetCity || '现场';
  const vars = {
    name: c.name,
    location: rubric.job.location || targetCity,
    targetCity,
    topHighlight: highlights[0] || '工程实战经历',
  };
  if (tier === 'S' || tier === 'A') {
    return facts.cityLocationType === 'target_only'
      ? formatTemplate(tpls.shortlistOnSite, vars)
      : formatTemplate(tpls.shortlistVerifyCity, vars);
  }
  if (isTemplateOnly) return formatTemplate(tpls.templateOnly, vars);
  if (facts.is27or28Intern) return formatTemplate(tpls.internDecline, vars);
  return '';
}

function evaluateCandidate(c, rubric, compiledSignals, overridesMap) {
  const override = resolveOverride(c, overridesMap);
  const facts = parseCandidateFacts(c, rubric, override);
  const highlights = [];
  const risks = [];
  const matchedProjects = new Set(override?.projectFit || []);

  const extraFlags = {
    hasOverride: Boolean(override),
    hasResumeImages: Boolean(c.friendImageLocalPaths?.length),
    hasLinks: /https?:\/\//.test(facts.msgText),
  };
  const fullEnv = buildSignalEnv(compiledSignals, facts.fullCorpus, extraFlags);
  const msgEnv = buildSignalEnv(compiledSignals, facts.msgAndOverrideText, extraFlags);

  const dimensions = {};
  let rawTotal = 0;
  for (const dim of rubric.dimensions || []) {
    const val = evaluateDynamicDimension(dim, fullEnv, msgEnv, highlights, risks, matchedProjects);
    dimensions[dim.key] = val;
    rawTotal += val;
  }

  const baseEval = evaluateBaseDimension(facts, rubric, highlights, risks);
  const baseKey = rubric.baseDimension?.key || 'base';
  dimensions[baseKey] = baseEval.score;
  rawTotal += baseEval.score;

  const mods = rubric.modifiers || {};
  if (facts.is27or28Intern) {
    risks.unshift('27/28届在校生求实习(JD为社招全职)');
    rawTotal = Math.min(rawTotal, mods.internCap ?? 58);
  }

  const nonDevRe = compileRegex(mods.nonDevRoleRegex);
  const roleContext = `${facts.expectRoleSalary} ${facts.workEntries[0]?.detail || ''}`.toLowerCase();
  if (nonDevRe.test(roleContext) && !evalSignalExpr(mods.devEvidenceSignals || '', fullEnv)) {
    risks.push('非研发岗背景(缺工程开发能力)');
    rawTotal = Math.min(rawTotal, mods.nonDevCap ?? 45);
  }

  if (facts.cityLocationType === 'non_target' && rubric.job.requireOnSite && !baseEval.mentionsOnSite) {
    rawTotal = Math.max(0, rawTotal - (mods.nonTargetCityPenalty ?? 12));
  }
  if (facts.edu === '大专' && rubric.job.allowCollege === false) {
    rawTotal = Math.max(0, rawTotal - (mods.collegePenalty ?? 6));
  }
  if (/兼职/.test(facts.expectRoleSalary)) {
    risks.push('期望标注为“兼职”(需确认全职)');
    rawTotal = Math.max(0, rawTotal - (mods.partTimePenalty ?? 5));
  }

  const isTemplateOnly =
    facts.msgText.length < 45 &&
    !/[a-z]{3,}/i.test(facts.msgText) &&
    !override &&
    !(c.friendImageLocalPaths?.length);
  if (isTemplateOnly) {
    risks.push('首轮仅模板打招呼(信息不足，待看简历)');
  }

  if (extraFlags.hasResumeImages || extraFlags.hasLinks) {
    rawTotal = Math.min(100, rawTotal + (mods.resumeAttachmentBonus ?? 4));
    highlights.push('附带简历图/在线作品/GitHub');
  }

  const autoScore = Math.max(0, Math.min(100, Math.round(rawTotal)));
  const overrideScore =
    typeof override?.scoreOverride === 'number' && Number.isFinite(override.scoreOverride)
      ? Math.max(0, Math.min(100, Math.round(override.scoreOverride)))
      : null;
  const score = overrideScore === null ? autoScore : overrideScore;
  const tiersCfg = rubric.tiers || {};
  let tier = 'C';
  let tierLabel = 'C级 · 方向/条件偏差较大';
  let stage = 'rejected';

  if (facts.is27or28Intern) {
    tier = 'INTERN';
    tierLabel = '实习生池 · 27/28届';
    stage = 'hold';
  } else if (score >= (tiersCfg.S?.min ?? 80)) {
    tier = 'S';
    tierLabel = tiersCfg.S?.label || 'S级 · 强烈推荐约面';
    stage = tiersCfg.S?.stage || 'shortlisted';
  } else if (score >= (tiersCfg.A?.min ?? 66)) {
    tier = 'A';
    tierLabel = tiersCfg.A?.label || 'A级 · 重点看简历/沟通';
    stage = tiersCfg.A?.stage || 'shortlisted';
  } else if (score >= (tiersCfg.B?.min ?? 48)) {
    tier = 'B';
    tierLabel = tiersCfg.B?.label || 'B级 · 备选跟进池';
    stage = tiersCfg.B?.stage || 'screened';
  } else if (isTemplateOnly) {
    tier = 'B';
    tierLabel = '待补信息 · 模板打招呼';
    stage = 'new';
  }

  const uniqueHighlights = [...new Set(highlights)];
  const uniqueRisks = [...new Set(risks)];

  const reasonParts = [];
  if (override?.expertNote) reasonParts.push(override.expertNote);
  else {
    if (uniqueHighlights.length) reasonParts.push(`优势：${uniqueHighlights.slice(0, 4).join('、')}`);
    if (uniqueRisks.length) reasonParts.push(`风险：${uniqueRisks.slice(0, 3).join('；')}`);
    if (!reasonParts.length) reasonParts.push('消息未展开技术细节，需结合在线简历进一步判断。');
  }

  const techHits = (rubric.techFilters || [])
    .filter((f) => {
      if (f.special === 'has_resume_img') return extraFlags.hasResumeImages || extraFlags.hasLinks;
      if (f.special === 'real_photo') return Boolean(c.avatarLocalPath && !c.isDefaultAvatar);
      if (f.signals) return evalSignalExpr(f.signals, fullEnv);
      if (f.pattern) return compileRegex(f.pattern).test(facts.fullCorpus);
      return false;
    })
    .map((f) => f.id);

  return {
    order: c.order,
    name: c.name,
    gender: c.gender || '',
    active: c.active || '',
    age: facts.age,
    ageStr: facts.ageStr,
    edu: facts.edu,
    expStr: facts.expStr,
    expYears: facts.expYears,
    isGradFullTime: facts.isGradFullTime,
    is27or28Intern: facts.is27or28Intern,
    expectCity: facts.expectCity,
    cityLocationType: facts.cityLocationType,
    expectRoleSalary: facts.expectRoleSalary,
    salaryText: facts.salaryText,
    salaryMin: facts.salaryMin,
    salaryMax: facts.salaryMax,
    school: facts.eduEntry?.detail || '',
    schoolTime: facts.eduEntry?.time || '',
    latestWork: facts.workEntries[0]?.detail || '',
    latestWorkTime: facts.workEntries[0]?.time || '',
    experienceTimelines: c.experienceTimelines || [],
    avatarFile: c.avatarLocalPath ? `./avatars/${path.basename(c.avatarLocalPath)}` : '',
    isDefaultAvatar: Boolean(c.isDefaultAvatar),
    friendImageFiles: (c.friendImageLocalPaths || []).map((p) => `./avatars/${path.basename(p)}`),
    listTime: c.listTime,
    unreadCount: c.unreadCount,
    messages: c.messages || [],
    msgText: facts.msgText,
    score,
    dimensions,
    tier,
    tierLabel,
    stage,
    highlights: uniqueHighlights,
    risks: uniqueRisks,
    matchedProjects: [...matchedProjects],
    reason: reasonParts.join(' '),
    interviewFocus:
      override?.interviewFocus ||
      (tier === 'S' || tier === 'A' ? '核实核心项目真实代码分工、线上异常处理与现场到岗时间。' : ''),
    replyDraft: buildReplyDraft(c, tier, facts, isTemplateOnly, uniqueHighlights, rubric),
    hasLinks: extraFlags.hasLinks,
    links: facts.msgText.match(/https?:\/\/[^\s，。！；]+/g) || [],
    isTemplateOnly,
    techHits,
  };
}

function syncTrackerFile(scored, trackerPath, jobTitle) {
  const now = new Date().toISOString();
  const tracker = { version: 1, updatedAt: now, candidates: {} };
  const nameCounts = {};
  for (const c of scored) nameCounts[c.name] = (nameCounts[c.name] || 0) + 1;

  for (const c of scored) {
    const suffix = nameCounts[c.name] > 1 ? `#${c.order}` : '';
    const key = `name:${c.name.toLowerCase()}${suffix}::${jobTitle.toLowerCase()}`;
    tracker.candidates[key] = {
      id: key,
      name: c.name,
      job: jobTitle,
      source: 'unread-chat',
      stage: c.stage,
      score: c.score,
      summary: [c.ageStr, c.expStr, c.edu, c.expectCity, c.salaryText, c.latestWork].filter(Boolean).join('｜'),
      reason: c.reason,
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, event: 'ai_scored', detail: `tier=${c.tier}, score=${c.score}` }],
    };
  }
  fs.mkdirSync(path.dirname(trackerPath), { recursive: true });
  fs.writeFileSync(trackerPath, JSON.stringify(tracker, null, 2) + '\n', 'utf8');
}

function buildMarkdownReport(scored, stats, rubric) {
  const targetCity = rubric.job.targetCity || '目标城市';
  const dimCols = [...(rubric.dimensions || []), rubric.baseDimension];
  const topList = scored.filter((c) => c.tier === 'S' || c.tier === 'A');

  const lines = [
    `# ${rubric.job.title} · 候选人全量筛选报告 & 规则体系`,
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
    `- 巡检总数：**${stats.total} 人**（头像与图片简历已同步至 \`dashboard/avatars/\`）`,
    `- 评级分布：**S级强烈推荐 ${stats.S} 人** ｜ **A级重点跟进 ${stats.A} 人** ｜ **B级备选/待补信息 ${stats.B} 人** ｜ **27/28届实习池 ${stats.INTERN} 人** ｜ **C级暂不匹配 ${stats.C} 人**`,
    `- 地域分布：纯${targetCity} **${stats.targetOnly}** 人 ｜ 含${targetCity}双城 **${stats.includesTarget}** 人 ｜ 纯外地 **${stats.nonTarget}** 人`,
    '',
    '---',
    '',
    '## 一、结合团队实战与岗位 JD 的筛选规则（100 分制）',
    '',
    `岗位要求：${rubric.job.requirements}`,
    '',
    `项目对齐基准：${rubric.projectsSummary}`,
    '',
    '| 评估维度 | 满分 | 重点考察内容 | 对应项目 |',
    '| --- | --- | --- | --- |',
  ];

  for (const d of dimCols) {
    lines.push(
      `| **${d.label}** | **${d.maxScore}** | ${d.description} | ${(d.projectNames || ['硬约束与预算匹配']).join('、')} |`,
    );
  }

  lines.push(
    '',
    '---',
    '',
    `## 二、优先推荐跟进与约面短名单（S级 + A级共 ${topList.length} 人）`,
    '',
    '| 排名 | 姓名 | 分数 | 评级 | 城市与薪资 | 背景与经验 | 核心亮点 / 风险 | 建议动作 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );

  topList.slice(0, 80).forEach((c, i) => {
    const bg = [c.ageStr, c.expStr, c.edu, c.latestWork].filter(Boolean).join(' · ').replace(/\|/g, '/');
    const hl = c.highlights.slice(0, 3).join('、');
    const rk = c.risks.length ? ` ⚠️${c.risks.join('；')}` : '';
    const act = c.tier === 'S' ? '🔥立即索要简历/约一面' : `👀优先看在线简历/确认在${targetCity}意向`;
    lines.push(`| ${i + 1} | **${c.name}** | **${c.score}** | ${c.tier} | ${c.expectCity} · ${c.salaryText} | ${bg} | ${hl}${rk} | ${act} |`);
  });

  lines.push('', '---', '', '## 三、S级候选人逐一点评与面试切入点', '');
  for (const c of scored.filter((x) => x.tier === 'S')) {
    const dimSummary = dimCols.map((d) => `${d.shortLabel} ${c.dimensions[d.key] ?? 0}/${d.maxScore}`).join(' ｜ ');
    lines.push(`### ${c.name}（${c.score} 分 · ${c.expectCity} · ${c.salaryText}）`);
    lines.push(`- **档案**：${[c.ageStr, c.expStr, c.edu, c.school, c.latestWork ? `最近：${c.latestWork}(${c.latestWorkTime})` : ''].filter(Boolean).join(' ｜ ')}`);
    lines.push(`- **分项得分**：${dimSummary}`);
    lines.push(`- **综合评价**：${c.reason}`);
    if (c.interviewFocus) lines.push(`- **面试切入点**：${c.interviewFocus}`);
    lines.push(`- **建议首轮回复**：\`${c.replyDraft}\``);
    lines.push('');
  }
  return lines.join('\n');
}

function buildDashboardHtml(payloadJson, rubric) {
  const escHtml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const targetCity = rubric.job.targetCity || '目标城市';
  const dimMeta = [...(rubric.dimensions || []), rubric.baseDimension].map((d) => ({
    key: d.key,
    shortLabel: d.shortLabel,
    label: d.label,
    maxScore: d.maxScore,
    description: d.description,
  }));

  const rubricCardsHtml = dimMeta
    .map(
      (d) =>
        `<div class="rubric-item"><strong>${escHtml(d.label)}（${d.maxScore}分）</strong>${escHtml(d.description)}</div>`,
    )
    .join('\n');

  const techOptionsHtml = (rubric.techFilters || [])
    .map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`)
    .join('\n');

  const gradLabel = `${String(rubric.job.gradReferenceYear || 2026).slice(-2)}届(已毕业)`;
  const [expMin, expMax] = rubric.job.expIdealRange || [1, 4];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(rubric.job.title)} · 招聘筛选可视化看板（${new Date().toLocaleDateString('zh-CN')}）</title>
  <style>
    :root {
      --bg: #f5f6f8; --surface: #ffffff; --surface-2: #f9fafb; --border: #e5e7eb;
      --text: #111827; --muted: #6b7280; --accent: #2563eb; --accent-soft: #eff6ff;
      --s-color: #b45309; --s-bg: #fef3c7; --a-color: #1d4ed8; --a-bg: #dbeafe;
      --b-color: #047857; --b-bg: #d1fae5; --intern-color: #7c3aed; --intern-bg: #ede9fe;
      --c-color: #4b5563; --c-bg: #f3f4f6; --danger: #dc2626; --danger-bg: #fee2e2;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif; line-height: 1.5; }
    .topbar { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,0.96); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); padding: 14px 24px; }
    .topbar-inner { max-width: 1480px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .title-area h1 { margin: 0; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .title-area p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .btn { border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn:hover { border-color: #cbd5e1; background: #f8fafc; }
    .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-primary:hover { background: #1d4ed8; }
    .container { max-width: 1480px; margin: 0 auto; padding: 18px 24px 60px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: border-color .15s, transform .12s; }
    .kpi:hover { border-color: var(--accent); transform: translateY(-1px); }
    .kpi.active { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(37,99,235,0.12); }
    .kpi .label { font-size: 12px; color: var(--muted); }
    .kpi .val { font-size: 24px; font-weight: 700; margin-top: 2px; }
    .kpi .sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .rubric-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; display: none; }
    .rubric-box.open { display: block; }
    .rubric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 10px; }
    .rubric-item { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12px; }
    .rubric-item strong { display: block; margin-bottom: 4px; color: var(--accent); }
    .controls { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .controls input[type="text"], .controls select { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; font-size: 13px; background: #fff; color: var(--text); }
    .controls input[type="text"] { min-width: 240px; flex: 1; }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; cursor: pointer; }
    .card:hover { border-color: #93c5fd; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06); }
    .card-head { display: flex; align-items: flex-start; gap: 12px; }
    .avatar { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; border: 1px solid var(--border); flex-shrink: 0; background: #e5e7eb; }
    .head-info { flex: 1; min-width: 0; }
    .name-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .name { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
    .score-pill { font-size: 14px; font-weight: 800; padding: 2px 9px; border-radius: 999px; flex-shrink: 0; }
    .tier-S { background: var(--s-bg); color: var(--s-color); }
    .tier-A { background: var(--a-bg); color: var(--a-color); }
    .tier-B { background: var(--b-bg); color: var(--b-color); }
    .tier-INTERN { background: var(--intern-bg); color: var(--intern-color); }
    .tier-C { background: var(--c-bg); color: var(--c-color); }
    .facts-line { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .work-line { font-size: 12px; color: #374151; font-weight: 500; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dim-bars { display: grid; grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); gap: 6px; background: var(--surface-2); padding: 7px 8px; border-radius: 8px; border: 1px solid #f1f5f9; }
    .dim { font-size: 10px; color: var(--muted); }
    .dim-bar-bg { height: 4px; background: #e2e8f0; border-radius: 2px; margin-top: 3px; overflow: hidden; }
    .dim-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .tag { font-size: 11px; padding: 2px 7px; border-radius: 5px; background: #f1f5f9; color: #334155; }
    .tag.hl { background: #ecfdf5; color: #065f46; }
    .tag.risk { background: var(--danger-bg); color: var(--danger); }
    .tag.proj { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .msg-preview { font-size: 12px; color: #4b5563; background: #f9fafb; padding: 8px 10px; border-radius: 8px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .card-foot { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--muted); border-top: 1px solid #f3f4f6; padding-top: 8px; }
    .hr-status-tag { padding: 2px 7px; border-radius: 999px; font-weight: 600; font-size: 11px; }
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 40; display: none; justify-content: flex-end; }
    .drawer-backdrop.open { display: flex; }
    .drawer { width: min(680px, 100vw); height: 100vh; background: #fff; overflow-y: auto; padding: 22px 24px 48px; box-shadow: -8px 0 30px rgba(15, 23, 42, 0.14); display: flex; flex-direction: column; gap: 16px; }
    .drawer-section { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--surface-2); }
    .drawer-section h3 { margin: 0 0 8px; font-size: 13px; color: #1f2937; }
    .chat-bubble { padding: 8px 11px; border-radius: 8px; margin-bottom: 6px; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    .chat-friend { background: #fff; border: 1px solid var(--border); }
    .chat-system { background: #f3f4f6; color: var(--muted); font-size: 11px; text-align: center; }
    .chat-you { background: #eff6ff; border: 1px solid #bfdbfe; }
    .resume-img { width: 100%; border-radius: 8px; border: 1px solid var(--border); margin-top: 8px; }
    .cmd-box { background: #111827; color: #e5e7eb; padding: 10px 12px; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="title-area">
        <h1>
          ${escHtml(rubric.job.title)} · 候选人筛选看板
          <span class="badge tier-A" id="totalBadge"></span>
        </h1>
        <p id="jobMeta"></p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn" onclick="toggleRubric()">📋 筛选规则与项目权重</button>
        <button class="btn" onclick="exportDecisionCsv()">⬇️ 导出当前列表/人工标记 CSV</button>
        <button class="btn btn-primary" onclick="resetFilters()">重置筛选</button>
      </div>
    </div>
  </header>

  <div class="container">
    <div id="rubricBox" class="rubric-box">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:14px;">团队项目对齐与 100 分筛选规则（${escHtml(rubric.projectsSummary)}）</strong>
        <button class="btn" onclick="toggleRubric()">收起</button>
      </div>
      <div class="rubric-grid">${rubricCardsHtml}</div>
    </div>

    <div class="kpi-grid" id="kpiGrid"></div>

    <div class="controls">
      <input type="text" id="searchInput" placeholder="搜索姓名、公司、学校、技能关键词..." />
      <select id="cityFilter">
        <option value="all">全部城市</option>
        <option value="target_only">仅${escHtml(targetCity)}</option>
        <option value="includes_target">含${escHtml(targetCity)}(含双城)</option>
        <option value="non_target">纯外地(预警)</option>
      </select>
      <select id="expFilter">
        <option value="all">全部经验</option>
        <option value="ideal">${expMin}-${expMax}年理想段</option>
        <option value="5+">${expMax + 1}年以上</option>
        <option value="grad">${escHtml(gradLabel)}</option>
        <option value="intern">27/28届实习</option>
      </select>
      <select id="techFilter">
        <option value="all">全部技术/特殊信号</option>
        ${techOptionsHtml}
      </select>
      <select id="hrMarkFilter">
        <option value="all">全部人工标记</option>
        <option value="interview">拟约面试</option>
        <option value="follow">待索要简历</option>
        <option value="pass">暂不考虑</option>
      </select>
      <select id="sortSelect">
        <option value="score_desc">按综合评分从高到低</option>
        <option value="dim0_desc">按第一主维度优先</option>
        <option value="dim1_desc">按第二工程维度优先</option>
        <option value="active_desc">按在线/刚刚活跃优先</option>
        <option value="order_asc">按接收顺序</option>
      </select>
    </div>

    <div id="resultMeta" style="font-size:12px;color:var(--muted);margin-bottom:10px;"></div>
    <div class="cards-grid" id="cardsGrid"></div>
  </div>

  <div class="drawer-backdrop" id="drawerBackdrop" onclick="if(event.target===this) closeDrawer()">
    <div class="drawer" id="drawerContent"></div>
  </div>

  <script>
    const DATA = ${payloadJson};
    const STORAGE_KEY = ${JSON.stringify(rubric.storageKey || 'boss_hr_marks_v1')};
    const DIM_META = ${JSON.stringify(dimMeta)};
    let hrMarks = {};
    try { hrMarks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}

    let activeTier = 'ALL';
    const state = { q: '', city: 'all', exp: 'all', tech: 'all', hrMark: 'all', sort: 'score_desc' };

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function initHeader() {
      document.getElementById('totalBadge').textContent = '共 ' + DATA.stats.total + ' 位候选人';
      document.getElementById('jobMeta').textContent =
        [DATA.job.company, DATA.job.salary, DATA.job.location].filter(Boolean).join(' ｜ ');
    }

    function renderKpis() {
      const s = DATA.stats;
      const items = [
        { key: 'ALL', label: '全量候选池', val: s.total, sub: '真实头像 ' + s.withPhotos + ' 张 · 附图 ' + s.withResumeImages + ' 人' },
        { key: 'S', label: 'S级 · 强烈推荐约面', val: s.S, sub: DATA.tiers?.S?.sub || '80-100分' },
        { key: 'A', label: 'A级 · 重点看简历', val: s.A, sub: DATA.tiers?.A?.sub || '66-79分' },
        { key: 'B', label: 'B级 · 备选/待补信息', val: s.B, sub: DATA.tiers?.B?.sub || '备选或模板打招呼' },
        { key: 'INTERN', label: '27/28届实习生池', val: s.INTERN, sub: '在校求实习 · 已自动隔离' },
        { key: 'C', label: 'C级 · 暂不匹配', val: s.C, sub: '方向/地域/条件偏差' },
      ];
      document.getElementById('kpiGrid').innerHTML = items.map(it => \`
        <div class="kpi \${activeTier === it.key ? 'active' : ''}" onclick="setTier('\${it.key}')">
          <div class="label">\${esc(it.label)}</div>
          <div class="val">\${it.val}</div>
          <div class="sub">\${esc(it.sub)}</div>
        </div>
      \`).join('');
    }

    function setTier(t) { activeTier = t; renderKpis(); renderList(); }
    function toggleRubric() { document.getElementById('rubricBox').classList.toggle('open'); }

    function matchesFilters(c) {
      if (activeTier !== 'ALL' && c.tier !== activeTier) return false;
      if (state.city === 'target_only' && c.cityLocationType !== 'target_only') return false;
      if (state.city === 'includes_target' && c.cityLocationType !== 'target_only' && c.cityLocationType !== 'includes_target') return false;
      if (state.city === 'non_target' && c.cityLocationType !== 'non_target') return false;

      if (state.exp === 'ideal' && !(c.expYears >= ${expMin} && c.expYears <= ${expMax})) return false;
      if (state.exp === '5+' && !(c.expYears > ${expMax})) return false;
      if (state.exp === 'grad' && !c.isGradFullTime) return false;
      if (state.exp === 'intern' && !c.is27or28Intern) return false;

      if (state.tech !== 'all' && !(c.techHits || []).includes(state.tech)) return false;

      const mk = hrMarks[c.order]?.status || '';
      if (state.hrMark !== 'all' && mk !== state.hrMark) return false;

      if (state.q) {
        const hay = [c.name, c.school, c.latestWork, c.expectCity, c.expectRoleSalary, c.msgText, c.reason, ...(c.highlights || [])].join(' ').toLowerCase();
        const terms = state.q.toLowerCase().split(/\\s+/).filter(Boolean);
        if (!terms.every(t => hay.includes(t))) return false;
      }
      return true;
    }

    function sortList(list) {
      const arr = [...list];
      const k0 = DIM_META[0]?.key;
      const k1 = DIM_META[1]?.key;
      if (state.sort === 'score_desc') arr.sort((a,b) => b.score - a.score || a.order - b.order);
      else if (state.sort === 'dim0_desc' && k0) arr.sort((a,b) => (b.dimensions[k0]||0) - (a.dimensions[k0]||0) || b.score - a.score);
      else if (state.sort === 'dim1_desc' && k1) arr.sort((a,b) => (b.dimensions[k1]||0) - (a.dimensions[k1]||0) || b.score - a.score);
      else if (state.sort === 'active_desc') {
        const w = (x) => x.active === '在线中' ? 2 : x.active === '刚刚活跃' ? 1 : 0;
        arr.sort((a,b) => w(b) - w(a) || b.score - a.score);
      } else if (state.sort === 'order_asc') arr.sort((a,b) => a.order - b.order);
      return arr;
    }

    function markStatusLabel(st) {
      if (st === 'interview') return { text: '✅ 拟约面试', bg: '#dcfce7', color: '#166534' };
      if (st === 'follow') return { text: '📄 待要简历', bg: '#dbeafe', color: '#1e40af' };
      if (st === 'pass') return { text: '⏭️ 暂不考虑', bg: '#f3f4f6', color: '#6b7280' };
      return null;
    }

    function renderList() {
      const filtered = sortList(DATA.candidates.filter(matchesFilters));
      document.getElementById('resultMeta').textContent =
        '当前筛选命中 ' + filtered.length + ' / ' + DATA.candidates.length + ' 人（展示前 300 条，点击卡片查看详情、图片简历与 CLI 命令）';

      const grid = document.getElementById('cardsGrid');
      if (!filtered.length) {
        grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);grid-column:1/-1;background:#fff;border-radius:12px;border:1px solid var(--border);">当前筛选条件下暂无候选人</div>';
        return;
      }

      grid.innerHTML = filtered.slice(0, 300).map(c => {
        const mk = markStatusLabel(hrMarks[c.order]?.status);
        return \`
          <div class="card" onclick="openDrawer(\${c.order})">
            <div class="card-head">
              <img class="avatar" src="\${esc(c.avatarFile)}" loading="lazy" alt="\${esc(c.name)}" />
              <div class="head-info">
                <div class="name-row">
                  <div class="name">
                    #\${c.order} \${esc(c.name)}
                    \${c.gender ? '<span style="font-size:11px;color:var(--muted);font-weight:400;">' + esc(c.gender) + '</span>' : ''}
                    \${c.active ? '<span class="badge" style="background:#ecfdf5;color:#059669;font-size:10px;">' + esc(c.active) + '</span>' : ''}
                  </div>
                  <span class="score-pill tier-\${c.tier}">\${c.score}分</span>
                </div>
                <div class="facts-line">\${esc([c.ageStr, c.expStr, c.edu, c.expectCity, c.salaryText].filter(Boolean).join(' · '))}</div>
                <div class="work-line">\${esc(c.latestWork ? c.latestWork + (c.latestWorkTime ? ' (' + c.latestWorkTime + ')' : '') : c.school || '未填写详细履历')}</div>
              </div>
            </div>
            <div class="dim-bars">
              \${DIM_META.map(d => {
                const v = c.dimensions[d.key] || 0;
                return \`<div class="dim"><div style="display:flex;justify-content:space-between;"><span>\${esc(d.shortLabel)}</span><b>\${v}/\${d.maxScore}</b></div><div class="dim-bar-bg"><div class="dim-bar-fill" style="width:\${Math.round(v/d.maxScore*100)}%"></div></div></div>\`;
              }).join('')}
            </div>
            <div class="tags">
              \${c.matchedProjects.slice(0,2).map(p => '<span class="tag proj">' + esc(p) + '</span>').join('')}
              \${c.highlights.slice(0,3).map(h => '<span class="tag hl">' + esc(h) + '</span>').join('')}
              \${c.risks.slice(0,2).map(r => '<span class="tag risk">⚠ ' + esc(r) + '</span>').join('')}
            </div>
            <div class="msg-preview">\${esc(c.msgText || c.reason)}</div>
            <div class="card-foot">
              <span>\${esc(c.tierLabel)} · \${esc(c.listTime)}</span>
              \${mk ? '<span class="hr-status-tag" style="background:' + mk.bg + ';color:' + mk.color + '">' + mk.text + '</span>' : '<span>点击查看详情 →</span>'}
            </div>
          </div>
        \`;
      }).join('');
    }

    function setHrMark(order, status) {
      const note = document.getElementById('hrNoteInput')?.value || hrMarks[order]?.note || '';
      if (status) hrMarks[order] = { status, note, at: new Date().toISOString() };
      else delete hrMarks[order];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hrMarks));
      renderList();
      openDrawer(order);
    }

    function saveHrNote(order) {
      const note = document.getElementById('hrNoteInput')?.value || '';
      const prev = hrMarks[order] || { status: 'follow' };
      hrMarks[order] = { ...prev, note, at: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hrMarks));
      renderList();
    }

    function openDrawer(order) {
      const c = DATA.candidates.find(x => x.order === order);
      if (!c) return;
      const mark = hrMarks[c.order] || {};
      const cliChat = 'boss chat ' + JSON.stringify(c.name) + ' && boss action resume';
      const cliReply = 'boss send --to ' + JSON.stringify(c.name) + ' --strict -t ' + JSON.stringify(c.replyDraft || '您好，方便发一份详细简历吗？') + ' --confirm';

      document.getElementById('drawerContent').innerHTML = \`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div style="display:flex;gap:14px;align-items:center;">
            <img src="\${esc(c.avatarFile)}" style="width:74px;height:74px;border-radius:14px;object-fit:cover;border:1px solid var(--border);" />
            <div>
              <h2 style="margin:0;font-size:20px;display:flex;align-items:center;gap:8px;">
                \${esc(c.name)} <span class="score-pill tier-\${c.tier}">\${c.score}分 · \${esc(c.tier)}级</span>
              </h2>
              <div style="font-size:13px;color:var(--muted);margin-top:4px;">\${esc([c.gender, c.ageStr, c.expStr, c.edu, c.active].filter(Boolean).join(' ｜ '))}</div>
              <div style="font-size:13px;font-weight:600;margin-top:2px;">期望：\${esc(c.expectCity)} · \${esc(c.expectRoleSalary || c.salaryText)}</div>
            </div>
          </div>
          <button class="btn" onclick="closeDrawer()">✕ 关闭</button>
        </div>

        <div class="drawer-section" style="background:#fff;">
          <h3>人工标记与跟进决策</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <button class="btn \${mark.status==='interview'?'btn-primary':''}" onclick="setHrMark(\${c.order},'interview')">✅ 拟约面试</button>
            <button class="btn \${mark.status==='follow'?'btn-primary':''}" onclick="setHrMark(\${c.order},'follow')">📄 待要简历</button>
            <button class="btn \${mark.status==='pass'?'btn-primary':''}" onclick="setHrMark(\${c.order},'pass')">⏭️ 暂不考虑</button>
            <button class="btn" onclick="setHrMark(\${c.order},'')">清除标记</button>
          </div>
          <input type="text" id="hrNoteInput" value="\${esc(mark.note || '')}" placeholder="输入人工备注（自动保存在本地浏览器）..." onchange="saveHrNote(\${c.order})" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;" />
        </div>

        <div class="drawer-section">
          <h3>AI 综合评估与匹配维度</h3>
          <p style="margin:0 0 8px;font-size:13px;">\${esc(c.reason)}</p>
          \${c.interviewFocus ? '<p style="margin:0 0 8px;font-size:12px;color:var(--accent);"><b>🎯 面试切入点：</b>' + esc(c.interviewFocus) + '</p>' : ''}
          <div class="tags">
            \${c.highlights.map(h => '<span class="tag hl">' + esc(h) + '</span>').join('')}
            \${c.risks.map(r => '<span class="tag risk">⚠ ' + esc(r) + '</span>').join('')}
          </div>
        </div>

        <div class="drawer-section">
          <h3>教育与工作时间线</h3>
          \${(c.experienceTimelines||[]).length ? c.experienceTimelines.map(t => \`<div style="font-size:12.5px;margin-bottom:4px;"><b>\${esc(t.time)}</b> ｜ \${esc(t.detail)}</div>\`).join('') : '<div style="font-size:12px;color:var(--muted);">未填写工作/教育时间线</div>'}
        </div>

        \${c.friendImageFiles.length ? \`<div class="drawer-section"><h3>候选人发来的图片简历（已本地保存）</h3>\${c.friendImageFiles.map(img => '<img class="resume-img" src="' + esc(img) + '" />').join('')}</div>\` : ''}

        <div class="drawer-section">
          <h3>完整聊天记录</h3>
          \${c.messages.map(m => \`<div class="chat-bubble \${m.from==='friend'?'chat-friend':m.from==='myself'?'chat-you':'chat-system'}">\${m.time ? '<span style="font-size:10px;color:var(--muted);margin-right:6px;">[' + esc(m.time) + ']</span>' : ''}\${esc(m.text)}</div>\`).join('')}
        </div>

        <div class="drawer-section">
          <h3>后续可直接对 Agent 说或执行的 Boss CLI 命令</h3>
          <div style="font-size:12px;margin-bottom:4px;">1) 在 Safari 打开会话并读取在线简历（不走付费OCR）：</div>
          <div class="cmd-box">\${esc(cliChat)}</div>
          <div style="font-size:12px;margin:8px 0 4px;">2) 确认后向候选人发送建议回复：</div>
          <div class="cmd-box">\${esc(cliReply)}</div>
        </div>
      \`;
      document.getElementById('drawerBackdrop').classList.add('open');
    }

    function closeDrawer() { document.getElementById('drawerBackdrop').classList.remove('open'); }

    function resetFilters() {
      activeTier = 'ALL';
      Object.assign(state, { q: '', city: 'all', exp: 'all', tech: 'all', hrMark: 'all', sort: 'score_desc' });
      ['searchInput','cityFilter','expFilter','techFilter','hrMarkFilter'].forEach((id, i) => {
        document.getElementById(id).value = i === 0 ? '' : 'all';
      });
      document.getElementById('sortSelect').value = 'score_desc';
      renderKpis(); renderList();
    }

    function exportDecisionCsv() {
      const list = sortList(DATA.candidates.filter(matchesFilters));
      const rows = [['序号','姓名','综合分','评级','年龄','经验','学历','期望城市','薪资','最近经历','人工标记','人工备注','评估摘要']];
      for (const c of list) {
        const mk = hrMarks[c.order] || {};
        rows.push([c.order, c.name, c.score, c.tier, c.ageStr, c.expStr, c.edu, c.expectCity, c.salaryText, c.latestWork, mk.status || '', mk.note || '', c.reason].map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"'));
      }
      const csv = '\\uFEFF' + rows.map(r => r.join(',')).join('\\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      a.download = 'candidates-' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
    }

    document.getElementById('searchInput').addEventListener('input', e => { state.q = e.target.value; renderList(); });
    document.getElementById('cityFilter').addEventListener('change', e => { state.city = e.target.value; renderList(); });
    document.getElementById('expFilter').addEventListener('change', e => { state.exp = e.target.value; renderList(); });
    document.getElementById('techFilter').addEventListener('change', e => { state.tech = e.target.value; renderList(); });
    document.getElementById('hrMarkFilter').addEventListener('change', e => { state.hrMark = e.target.value; renderList(); });
    document.getElementById('sortSelect').addEventListener('change', e => { state.sort = e.target.value; renderList(); });

    initHeader(); renderKpis(); renderList();
  </script>
</body>
</html>`;
}

function openDashboardInSafari(htmlPath) {
  const fileUrl = `file://${htmlPath}`;
  const script = `tell application "Safari"
  activate
  set win to front window
  repeat with t in tabs of win
    if (URL of t) contains ${JSON.stringify(path.basename(path.dirname(htmlPath)) + '/index.html')} then
      set URL of t to ${JSON.stringify(fileUrl)}
      set current tab of win to t
      return
    end if
  end repeat
  set newTab to make new tab at end of tabs of win with properties {URL:${JSON.stringify(fileUrl)}}
  set current tab of win to newTab
end tell`;
  execFileSync('osascript', ['-e', script]);
}

/** Run full dashboard build programmatically or from CLI. */
export function runDashboardBuild(opts) {
  const raw = readJsonIfExists(opts.input);
  if (!raw || !Array.isArray(raw.candidates)) {
    throw new Error(`Invalid or missing candidates input JSON: ${opts.input}`);
  }
  const rubric = loadRubricConfig(opts.config, opts.jd);
  const overridesMap = readJsonIfExists(opts.overrides, null);
  const compiledSignals = compileSignals(rubric.signals);

  syncOfflineAvatars(raw.candidates, opts.avatarsSrc, opts.outDir);

  const scored = raw.candidates
    .map((c) => evaluateCandidate(c, rubric, compiledSignals, overridesMap))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const stats = {
    total: scored.length,
    S: scored.filter((c) => c.tier === 'S').length,
    A: scored.filter((c) => c.tier === 'A').length,
    B: scored.filter((c) => c.tier === 'B').length,
    C: scored.filter((c) => c.tier === 'C').length,
    INTERN: scored.filter((c) => c.tier === 'INTERN').length,
    targetOnly: scored.filter((c) => c.cityLocationType === 'target_only').length,
    includesTarget: scored.filter((c) => c.cityLocationType === 'includes_target').length,
    nonTarget: scored.filter((c) => c.cityLocationType === 'non_target').length,
    withPhotos: scored.filter((c) => c.avatarFile && !c.isDefaultAvatar).length,
    withResumeImages: scored.filter((c) => c.friendImageFiles.length > 0).length,
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(opts.outDir, 'candidates-scored.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), job: rubric.job, stats, candidates: scored }, null, 2) + '\n',
    'utf8',
  );

  if (opts.syncTracker && opts.tracker) {
    syncTrackerFile(scored, opts.tracker, rubric.job.title);
  }

  fs.mkdirSync(path.dirname(opts.report), { recursive: true });
  fs.writeFileSync(opts.report, buildMarkdownReport(scored, stats, rubric), 'utf8');

  const payloadJson = JSON.stringify({
    generatedAt: new Date().toLocaleString('zh-CN'),
    job: rubric.job,
    tiers: rubric.tiers,
    stats,
    candidates: scored,
  }).replace(/<\/script>/gi, '<\\/script>');

  const indexPath = path.join(opts.outDir, 'index.html');
  fs.writeFileSync(indexPath, buildDashboardHtml(payloadJson, rubric), 'utf8');

  if (opts.openSafari && process.platform === 'darwin') {
    openDashboardInSafari(indexPath);
  }

  return {
    stats,
    indexPath,
    reportPath: opts.report,
    top15: scored.slice(0, 15).map((c) => ({
      order: c.order,
      name: c.name,
      score: c.score,
      tier: c.tier,
      city: c.expectCity,
      salary: c.salaryText,
      dims: c.dimensions,
    })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const opts = parseCliArgs(process.argv);
  const summary = runDashboardBuild(opts);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  }
}
