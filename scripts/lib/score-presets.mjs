/**
 * 岗位打分规则（可解释、可复现）。
 * 目前只有讲解员；新媒体与 AI 岗位的评分来自 dashboard 下的 candidates-scored.json。
 */

const NOISE = /^(无|暂无|保密|\*+)$/;

function norm(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function parseBase(baseInfo) {
  const text = norm(baseInfo);
  const age = /(\d{2})\s*岁/.exec(text)?.[1] ?? '';
  const fresh = /应届生/.test(text);
  let years = null;
  if (fresh) {
    years = 0;
  } else {
    const grad = /(\d{2})\s*年毕业/.exec(text);
    if (grad) {
      const year = 2000 + Number(grad[1]);
      years = Math.max(0, new Date().getFullYear() - year);
    } else {
      const m = /(\d+)\s*年/.exec(text);
      if (m) years = Number(m[1]);
    }
  }
  const edu =
    ['博士', '硕士', '本科', '大专', '高中', '中专', '初中'].find((e) => text.includes(e)) ?? '';
  const status = /离职-随时到岗/.test(text)
    ? '离职-随时到岗'
    : /在职-月内到岗/.test(text)
      ? '在职-月内到岗'
      : /在职-暂不考虑/.test(text)
        ? '在职-暂不考虑'
        : '';
  return { age, years, fresh, edu, status };
}

function parseSalary(salary) {
  const s = norm(salary).toLowerCase().replace(/\s+/g, '');
  if (!s || s.includes('面议')) return { low: null, text: norm(salary) };
  const m = /(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*k/.exec(s);
  if (m) return { low: Number(m[1]), high: Number(m[2]), text: norm(salary) };
  const one = /(\d+(?:\.\d+)?)\s*k/.exec(s);
  if (one) return { low: Number(one[1]), high: Number(one[1]), text: norm(salary) };
  return { low: null, text: norm(salary) };
}

function latestWork(experience) {
  const seg = norm(experience)
    .split(/[;；]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .pop();
  if (!seg) return { company: '', role: '' };
  const body = seg.replace(/^\d{4}(?:\.\d{1,2})?\s*(?:至今|\d{4}(?:\.\d{1,2})?)?\s*/, '').trim();
  const parts = body.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { company: '', role: '' };
  if (parts.length === 1) return { company: parts[0], role: '' };
  return { company: parts[0], role: parts.slice(1).join(' ') };
}

function pickHighlights(c, corpus, info) {
  const out = [];
  const push = (v) => {
    const t = norm(v);
    if (!t || NOISE.test(t)) return;
    if (!out.includes(t)) out.push(t);
  };
  for (const h of c.highlights ?? []) push(h);
  if (/展厅|展馆|博物馆|科技馆|天文馆|美术馆|规划馆/.test(corpus)) push('展厅讲解');
  if (/播音|主持/.test(corpus)) push('播音主持专业');
  if (/普通话/.test(corpus)) push('普通话证书');
  if (/导游证/.test(corpus)) push('导游证');
  if (info.fresh) push('应届可即到岗');
  return out.slice(0, 4);
}

/** 讲解员岗位评分：可解释、可复现 */
export function scoreJiangjie(c) {
  const base = parseBase(c.baseInfo);
  const sal = parseSalary(c.salary);
  const exp = norm(c.experience);
  const adv = norm(c.advantage);
  const hl = (c.highlights ?? []).map(norm).join(' ');
  const expect = norm(c.expect);
  const corpus = `${exp} ${adv} ${hl} ${expect}`;

  // guide 30：讲解/展厅/导游/接待的实际经历
  let guide = 0;
  if (/讲解/.test(exp)) guide += 16;
  else if (/讲解/.test(corpus)) guide += 13;
  if (/展厅|展馆|博物馆|科技馆|天文馆|美术馆|规划馆/.test(corpus)) guide += 7;
  if (/导游|研学|旅游顾问|会务|会展|接待/.test(corpus)) guide += 5;
  if (/解说|导览/.test(corpus)) guide += 4;
  if (/客服|前台|礼仪/.test(corpus)) guide += 2;
  guide = Math.min(30, guide);

  // express 25：播音主持/普通话/表达
  let express = 0;
  if (/播音|主持/.test(corpus)) express += 10;
  if (/普通话/.test(corpus)) express += 7;
  if (/演讲|朗诵|配音|主播|直播/.test(corpus)) express += 5;
  if (/沟通|表达|亲和/.test(corpus)) express += 4;
  express = Math.min(25, express);

  // service 15：服务接待/教育/销售
  let service = 0;
  if (/服务|接待|礼仪|客服/.test(corpus)) service += 6;
  if (/教育|培训|教师|幼教|辅导员/.test(corpus)) service += 5;
  if (/销售|顾问|客户/.test(corpus)) service += 3;
  if (/活动执行|活动策划|会务/.test(corpus)) service += 3;
  service = Math.min(15, service);

  // major 10：旅游管理/播音主持/历史文化/市场营销
  let major = 0;
  if (/旅游管理|旅游/.test(corpus)) major = 10;
  else if (/播音主持|播音与主持/.test(corpus)) major = 10;
  else if (/历史|文博|考古|文化遗产/.test(corpus)) major = 8;
  else if (/市场营销|新闻|传播|汉语言|中文/.test(corpus)) major = 6;
  else if (/表演|音乐|舞蹈|艺术/.test(corpus)) major = 5;

  // stability 10：岗位要求 1-3 年
  let stability = 0;
  const y = base.years;
  if (y === null) stability = 5;
  else if (y >= 1 && y <= 3) stability = 9;
  else if (y < 1) stability = 7;
  else if (y <= 5) stability = 6;
  else if (y <= 8) stability = 5;
  else stability = 3;
  if (base.status === '离职-随时到岗' || base.fresh) stability = Math.min(10, stability + 1);

  // base 10：学历 / 城市 / 薪资
  let baseScore = 0;
  if (base.edu === '本科' || base.edu === '硕士' || base.edu === '博士') baseScore += 4;
  else if (base.edu === '大专') baseScore += 3.5;
  else baseScore += 1.5;
  if (/上海/.test(expect) || /上海/.test(norm(c.baseInfo))) baseScore += 3;
  if (sal.low === null) baseScore += 2;
  else if (sal.low <= 10) baseScore += 3;
  else if (sal.low <= 12) baseScore += 2;
  else baseScore += 1;
  baseScore = Math.min(10, baseScore);

  let total = guide + express + service + major + stability + baseScore;
  if (/讲解员/.test(expect)) total += 3;
  const score = Math.max(0, Math.min(100, Math.round(total)));

  const work = latestWork(exp);
  const expText = base.fresh ? '应届' : base.years === null ? '经验待确认' : `${base.years}年经验`;
  const hlText = (c.highlights ?? []).slice(0, 2).join('、');
  const summary = base.fresh
    ? `${base.age || '?'}岁·${base.edu || '学历待确认'}应届生，${[work.company, work.role].filter(Boolean).join(' ') || '在校经历待补充'}${hlText ? `，${hlText}` : ''}。`
    : `${base.age || '?'}岁·${base.edu || '学历待确认'}·${expText}，最近在${[work.company, work.role].filter(Boolean).join(' ') || '（经历待补充）'}${hlText ? `，${hlText}` : ''}。`;

  const risks = [];
  const expectRole = expect.replace(/^上海\s*/, '').replace(/[（(].*?[)）]/g, '').trim();
  if (expectRole && !/讲解|导览|展厅|主持|播音|接待|旅游|服务|活动|文职|行政/.test(expectRole)) {
    risks.push(`求职意向写的是「${expectRole}」，与讲解员不完全对口`);
  }
  if (sal.low !== null && sal.low > 10) risks.push(`期望 ${sal.text}，高于岗位 7-10K 区间`);
  if (!/讲解|展厅|导游|导览|解说/.test(corpus)) risks.push('简历里没有展厅/讲解经历，表达与现场控场需面试验证');
  if (['高中', '中专', '初中'].includes(base.edu)) risks.push(`学历为${base.edu}，低于大专要求`);
  if ((base.years ?? 0) > 5) risks.push(`已有 ${base.years} 年经验，可能超配、薪资预期偏高`);
  if (!c.canGreet && !c.hasHistoryChat) risks.push('当前不可直接打招呼（可能需要先查看或已被同事跟进）');

  const highlights = pickHighlights(c, corpus, base);
  const strengths = [];
  if (guide >= 20) strengths.push('有展厅/讲解实操');
  if (express >= 15) strengths.push('播音主持与表达基本功扎实');
  if (major >= 8) strengths.push('专业对口（旅游/播音/文博）');
  if (service >= 8) strengths.push('服务接待经验足');
  if (!strengths.length && highlights.length) strengths.push(highlights.slice(0, 2).join('、'));
  const reason = `${strengths.length ? strengths.join('、') : '基础条件基本符合'}${risks.length ? `。待确认：${risks[0]}` : ''}。`;

  return {
    score,
    dimensions: {
      guide,
      express,
      service,
      major,
      stability,
      base: Math.round(baseScore),
    },
    summary,
    reason,
    highlights,
    risks: risks.slice(0, 3),
    facts: {
      age: base.age ? `${base.age}岁` : '',
      edu: base.edu,
      exp: base.fresh ? '应届' : base.years === null ? '' : `${base.years}年`,
      city: /上海/.test(expect) ? '上海' : '',
      salary: sal.text,
      latestWork: [work.company, work.role].filter(Boolean).join(' · '),
    },
  };
}


export const PRESETS = { jiangjie: scoreJiangjie };
