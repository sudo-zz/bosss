/**
 * BOSS 在线简历 → 结构化数据。
 *
 * 输入可以是：
 *  - 同源 iframe 的 innerText（DOM 简历，通常最完整）
 *  - 多屏截图的 OCR 行（Canvas 简历，带归一化坐标）
 *
 * BOSS 的在线简历是「左侧区块标题 + 右侧内容」两栏版式，因此解析时先按 x 把行分成
 * 标题列与正文列，再按 y 顺序切分区块，最后把「公司｜职位 + 时间」还原成条目。
 *
 * 输出结构统一，供工作台用「自有模板」渲染，不再直接展示原始截图或大段文本。
 */

export type OnlineResumeItem = {
  /** 主行原文，如「上海火太阳品牌营销咨询有限公司 ｜ 剪辑师」 */
  headline?: string;
  org?: string;
  role?: string;
  period?: string;
  lines: string[];
  tags?: string[];
};

export type OnlineResumeSection = {
  key: string;
  title: string;
  items: OnlineResumeItem[];
  /** 无条目结构的区块（个人优势等）按段落保存 */
  paragraphs?: string[];
  tags?: string[];
};

export type OnlineResumeStructured = {
  name: string;
  /** 「26岁 本科 6年 离职-随时到岗」 */
  headline?: string;
  expectation?: {
    city?: string;
    position?: string;
    industry?: string;
    salary?: string;
  };
  sections: OnlineResumeSection[];
  source: 'ocr' | 'text';
  builtAt: string;
};

export type OcrLineLike = {
  text: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
};

const SECTION_DEFS: Array<{ key: string; titles: string[] }> = [
  { key: 'advantage', titles: ['个人优势', '优势亮点', '自我评价'] },
  { key: 'expectation', titles: ['期望职位', '求职期望', '期望工作'] },
  { key: 'work', titles: ['工作经历', '工作经验'] },
  { key: 'project', titles: ['项目经历', '项目经验'] },
  { key: 'education', titles: ['教育经历', '教育背景'] },
  { key: 'skill', titles: ['专业技能', '技能特长', '技能标签'] },
  { key: 'certificate', titles: ['资格证书', '证书'] },
  { key: 'language', titles: ['语言能力', '语言'] },
  { key: 'school', titles: ['在校经历', '校园经历'] },
  { key: 'award', titles: ['获奖经历', '荣誉奖项'] },
  { key: 'portfolio', titles: ['作品集', '社交主页'] },
];

const TITLE_TO_KEY = new Map<string, { key: string; title: string }>();
for (const def of SECTION_DEFS) {
  for (const t of def.titles) TITLE_TO_KEY.set(t, { key: def.key, title: t });
}

const PERIOD_RE =
  /20\d{2}\s*(?:[.\-/年]\s*\d{1,2})?\s*[-–—~至]{1,2}\s*(?:至今|现在|20\d{2}\s*(?:[.\-/年]\s*\d{1,2})?)/;

const ITEM_SECTION_KEYS = new Set(['work', 'project', 'education', 'school', 'award', 'certificate']);

const JOB_WORD_RE =
  /(工程师|开发|运营|经理|主管|总监|设计师|助理|专员|实习生|顾问|专家|架构师|负责人|岗位|简历|学历|本科|硕士|大专|博士|岁|在职|离职|应届)/;

function cleanText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[·•\-–—\s]+/, '')
    .trim();
}

/** 明显不属于简历正文的行（浏览器 / 弹层 / 聊天区噪声） */
const NOISE_RE =
  /^(收藏|转发|举报|继续沟通|关闭|查看更多|查看全部|展开|收起|上一页|下一页|分享|下载|打印|复制|在线简历|附件简历|原始简历)$|zhipin\.com|BOSS直聘|招聘助手|候选人筛选|DeepSeek|^\d{1,2}:\d{2}$|^第\s*\d+\s*页$|^×$/;

function isNoise(text: string): boolean {
  if (!text) return true;
  if (NOISE_RE.test(text)) return true;
  // BOSS 简历页脚的法律声明
  if (/为爱护牛人|BOSS直聘平台提交|未经BOSS直聘|第三方平台进行复制|任何用户原则上仅可用于/.test(text)) return true;
  if (text.length <= 1 && !/[\u4e00-\u9fa5]/.test(text)) return true;
  return false;
}

function isPersonName(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (!/^[\u4e00-\u9fa5·]{2,4}$/.test(t)) return false;
  if (JOB_WORD_RE.test(t)) return false;
  if (TITLE_TO_KEY.has(t)) return false;
  return true;
}

/**
 * 找出正文栏的左边界：用「长文本行」的 x 直方图主峰，避免短标题/标签干扰。
 * 返回正文左边界与标题列左边界。
 */
function detectColumns(lines: OcrLineLike[]): { bodyLeft: number; columnLeft: number; right: number } {
  const buckets = new Map<number, number>();
  for (const l of lines) {
    const text = cleanText(l.text);
    if (isNoise(text) || text.length < 12) continue;
    const key = Math.round(l.x * 200) / 200;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let best = 0.27;
  let bestCount = -1;
  for (const [k, v] of buckets) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return {
    bodyLeft: Math.max(0, best - 0.006),
    columnLeft: Math.max(0, best - 0.075),
    right: Math.min(1, best + 0.42),
  };
}

type VisualLine = { y: number; left: string; right: string; height: number; x: number };

/** 把正文列的行按视觉行聚类，同一 y 的左右片段合并（公司｜职位 + 右侧时间） */
function groupVisualLines(lines: OcrLineLike[]): VisualLine[] {
  const sorted = [...lines].sort((a, b) => (Math.abs(a.y - b.y) < 0.005 ? a.x - b.x : a.y - b.y));
  const out: VisualLine[] = [];
  for (const l of sorted) {
    const text = cleanText(l.text);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(l.y - last.y) < 0.011) {
      // 右侧时间块（x 明显靠右且匹配时间格式）单独保存
      if (PERIOD_RE.test(text) && l.x > last.x + 0.12) {
        last.right = last.right ? `${last.right} ${text}` : text;
        continue;
      }
      last.left = `${last.left}${needsSpace(last.left, text) ? ' ' : ''}${text}`;
      last.height = Math.max(last.height, l.h ?? 0);
      continue;
    }
    out.push({ y: l.y, left: text, right: '', height: l.h ?? 0, x: l.x });
  }
  return out;
}

/** 中文之间不加空格，中英文之间加空格 */
function needsSpace(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  const a = prev[prev.length - 1];
  const b = next[0];
  const cn = (c: string) => /[\u4e00-\u9fa5]/.test(c);
  return !cn(a) || !cn(b);
}

function splitOrgRole(headline: string): { org?: string; role?: string } {
  const parts = headline.split(/\s*[｜|]\s*/).filter(Boolean);
  if (parts.length >= 2) {
    return { org: parts[0], role: parts.slice(1).join(' · ') };
  }
  return {};
}

function pushItemToSection(sec: OnlineResumeSection, item: OnlineResumeItem | null): void {
  if (item && (item.headline || item.lines.length > 0)) {
    item.lines = splitInlineNumbered(mergeWrappedLines(item.lines));
    // 首/末行是几个短词（如「公众号运营 小红书运营 视频剪辑」）时抽成标签
    if (sec.key !== 'education') {
      const headLine = item.lines[0];
      const head =
        headLine && item.lines.length > 1 && headLine.length <= 14 && !/[。，；：、｜|]/.test(headLine)
          ? (extractTagLine(headLine) ?? [headLine])
          : extractTagLine(headLine ?? '');
      if (head) {
        item.tags = [...(item.tags ?? []), ...head];
        item.lines.shift();
      }
      const tailLine = item.lines[item.lines.length - 1];
      const tail =
        tailLine && tailLine.length <= 14 && !/[。，；：、｜|]/.test(tailLine)
          ? (extractTagLine(tailLine) ?? [tailLine])
          : extractTagLine(tailLine ?? '');
      if (tail) {
        item.tags = [...(item.tags ?? []), ...tail];
        item.lines.pop();
      }
      if (item.tags?.length) item.tags = Array.from(new Set(item.tags));
    }
    sec.items.push(item);
  }
}

/**
 * 合并被 OCR/排版拆断的段落行：
 * - 上一行没有句末标点、下一行不是编号/项目符号时视为同一段
 * - 中文之间直接拼接，英文之间补空格
 * - 清掉 BOSS 的「…查看全部」截断提示
 */
function mergeWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/[…\.]{1,3}\s*查看全部$/, '').replace(/…\s*$/, '').trim();
    if (!line) continue;
    const last = out[out.length - 1];
    if (!last) {
      out.push(line);
      continue;
    }
    const startsList = /^(\d+\s*[.、)）]|[·•\-–—*]\s|【)/.test(line);
    const lastEnds = /[。！？；：!?;:]$/.test(last);
    const looksLikeHeadline = /[｜|]/.test(line) && line.length < 40;
    if (startsList || lastEnds || looksLikeHeadline) {
      out.push(line);
      continue;
    }
    out[out.length - 1] = joinWrapped(last, line);
  }
  return out;
}

/** OCR 常把「…；2、…」写在同一条视觉行里，这里按编号拆回独立条目 */
function splitInlineNumbered(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const parts = line.split(/(?<=[；;。!？!?])\s*(?=\d{1,2}\s*[、.．)）])/);
    if (parts.length > 1) out.push(...parts.map((p) => p.trim()).filter(Boolean));
    else out.push(line);
  }
  return out;
}

/** 一行由多个短词组成时视为标签行 */
function extractTagLine(line: string): string[] | null {
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  if (!parts.every((p) => p.length <= 12 && !/[。，；：、｜|]/.test(p))) return null;
  return parts;
}

function joinWrapped(prev: string, next: string): string {
  const a = prev.slice(-1);
  const b = next.slice(0, 1);
  const ascii = (c: string) => /[A-Za-z0-9]/.test(c);
  if (ascii(a) && ascii(b)) {
    // 英文断词（如 Pr + ompt）不加空格；完整单词之间加空格
    const tailWord = /([A-Za-z]+)$/.exec(prev)?.[1] ?? '';
    const headWord = /^([A-Za-z]+)/.exec(next)?.[1] ?? '';
    const brokenWord = tailWord.length <= 3 || /^[a-z]/.test(headWord);
    return brokenWord ? `${prev}${next}` : `${prev} ${next}`;
  }
  return `${prev}${next}`;
}

function finalizeSections(sections: OnlineResumeSection[]): OnlineResumeSection[] {
  for (const sec of sections) {
    if (sec.paragraphs?.length) {
      sec.paragraphs = mergeWrappedLines(sec.paragraphs);
    }
    // 多屏滚动采集会在相邻屏重复出现同一条经历，按「公司/学校 + 时间」去重并保留更完整的一份
    if (sec.items.length > 1) {
      const seen = new Map<string, OnlineResumeItem>();
      const kept: OnlineResumeItem[] = [];
      for (const it of sec.items) {
        const period = (it.period || '').replace(/\s+/g, '');
        // 只用「公司/学校前几个字 + 时间」判重：跨屏 OCR 偶尔把 ｜ 识别成别的字符，headline 不可靠
        const orgKey = looseKey(it.org || it.headline || '').slice(0, 8);
        const key = `${orgKey}|${period}`;
        if (!key.replace(/\|/g, '')) {
          kept.push(it);
          continue;
        }
        const exist = seen.get(key);
        if (!exist) {
          seen.set(key, it);
          kept.push(it);
        } else if (it.lines.join('').length > exist.lines.join('').length) {
          exist.lines = it.lines;
        }
      }
      sec.items = kept;
    }
  }
  // 技能标签行：末尾出现连续短词（如「MySQL Redis Kafka LangChain」）
  for (const sec of sections) {
    if (sec.key !== 'skill') continue;
    const lastItem = sec.items[sec.items.length - 1];
    const target = lastItem ? lastItem.lines : sec.paragraphs;
    if (!target?.length) continue;
    const lastLine = target[target.length - 1];
    const parts = lastLine.split(/\s+/).filter(Boolean);
    if (parts.length >= 3 && parts.every((p) => p.length <= 12)) {
      sec.tags = parts;
      target.pop();
    }
  }
  // 个人优势里的短词串（如「内容运营、短视频、数据分析」）拆成标签
  for (const sec of sections) {
    if (sec.key !== 'advantage' || !sec.paragraphs?.length) continue;
    const last = sec.paragraphs[sec.paragraphs.length - 1];
    const parts = last.split(/[、/｜|,，]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3 && parts.every((p) => p.length <= 12) && last.length < 80) {
      sec.tags = parts;
      sec.paragraphs.pop();
    }
  }
  return sections.filter((sec) => sec.items.length > 0 || (sec.paragraphs?.length ?? 0) > 0 || sec.tags?.length);
}

/** 从纯文本（DOM innerText）解析 */
export function parseResumeText(text: string): OnlineResumeStructured {
  const lines = text
    .split(/\r?\n/)
    .map(cleanText)
    .filter((l) => l && !isNoise(l));

  const out: OnlineResumeStructured = {
    name: '',
    sections: [],
    source: 'text',
    builtAt: new Date().toISOString(),
  };
  if (!lines.length) return out;

  const lead: string[] = [];
  let current: OnlineResumeSection | null = null;
  let currentItem: OnlineResumeItem | null = null;
  let headerStage = 0;

  const flushSection = () => {
    if (current) {
      pushItemToSection(current, currentItem);
      out.sections.push(current);
    }
    current = null;
    currentItem = null;
  };

  for (const line of lines) {
    const titleHit = TITLE_TO_KEY.get(line.replace(/\s+/g, ''));

    if (titleHit) {
      flushSection();
      current = { key: titleHit.key, title: titleHit.title, items: [] };
      headerStage = 9;
      continue;
    }

    // 头部：姓名 → 状态行 → 期望行
    if (headerStage < 3 && !current) {
      if (headerStage === 0 || (headerStage === 1 && !out.name)) {
        if (isPersonName(line)) {
          out.name = line;
          headerStage = 1;
          continue;
        }
      }
      if (headerStage <= 1 && !out.headline && /\d{2}\s*岁|本科|硕士|大专|博士|在职|离职|应届/.test(line)) {
        out.headline = line;
        headerStage = 2;
        continue;
      }
      if (headerStage <= 2 && !out.expectation && /[｜|]/.test(line) && /(K|元\/月|面议)/.test(line)) {
        const parts = line.split(/\s*[｜|]\s*/).filter(Boolean);
        out.expectation = { city: parts[0], position: parts[1], industry: parts[2], salary: parts[3] };
        headerStage = 3;
        continue;
      }
      if (headerStage < 3) {
        lead.push(line);
        continue;
      }
    }

    if (!current) {
      lead.push(line);
      continue;
    }

    if (ITEM_SECTION_KEYS.has(current.key)) {
      const periodMatch = line.match(PERIOD_RE);
      const hasSep = /[｜|]/.test(line);
      const isHeadline =
        hasSep || Boolean(periodMatch && line.replace(PERIOD_RE, '').trim().length > 0 && line.length < 80);

      if (isHeadline) {
        pushItemToSection(current, currentItem);
        const withoutPeriod = periodMatch ? line.replace(PERIOD_RE, '').trim() : line;
        const { org, role } = splitOrgRole(withoutPeriod);
        currentItem = { headline: withoutPeriod, org, role, period: periodMatch?.[0]?.trim(), lines: [] };
        continue;
      }
    }

    if (currentItem) {
      currentItem.lines.push(line);
    } else {
      current.paragraphs = current.paragraphs ?? [];
      current.paragraphs.push(line);
    }
  }
  flushSection();

  // 开头没有区块标题的散段落 → 归到「个人优势」
  if (lead.length) {
    const adv = out.sections.find((s) => s.key === 'advantage');
    if (adv) {
      adv.paragraphs = [...lead, ...(adv.paragraphs ?? [])];
    } else {
      out.sections.unshift({ key: 'advantage', title: '个人优势', items: [], paragraphs: lead });
    }
  }

  out.sections = finalizeSections(out.sections);
  return out;
}

/** 从 OCR 行（可能多屏）解析 */
export function parseResumeOcrLines(
  pages: OcrLineLike[][],
  opts: { candidateName?: string } = {},
): OnlineResumeStructured {
  const out: OnlineResumeStructured = {
    name: '',
    sections: [],
    source: 'ocr',
    builtAt: new Date().toISOString(),
  };

  // 1) 每屏独立清洗（同一屏内两轮 OCR 去重）
  const cleanedPages = pages
    .map((page) =>
      dedupeLines(
        page.map((l) => ({ ...l, text: cleanText(l.text) })).filter((l) => l.text && !isNoise(l.text)),
      ),
    )
    .filter((p) => p.length > 0);
  if (!cleanedPages.length) return out;

  const { bodyLeft, columnLeft, right } = detectColumns(cleanedPages.flat());

  // 2) 每屏独立还原视觉行，再按屏顺序拼接（不同屏的 y 会重叠，不能跨屏排序）
  type LineEvent = { kind: 'line'; line: VisualLine };
  type Event = LineEvent | { kind: 'title'; key: string; title: string };
  type Stamped = Event & { y: number };
  const events: Event[] = [];

  for (const page of cleanedPages) {
    // 区块标题靠文字精确匹配，避免不同简历排版缩进不一致；正文按相对左边界收窄，排除左侧导航与右侧聊天区
    const titles = page
      .filter((l) => l.y > 0.04)
      .map((l) => ({ y: l.y, hit: TITLE_TO_KEY.get(cleanText(l.text).replace(/\s+/g, '')) }))
      .filter((r): r is { y: number; hit: { key: string; title: string } } => Boolean(r.hit))
      .sort((a, b) => a.y - b.y);
    const body = page.filter((l) => {
      if (l.y <= 0.04) return false;
      const text = cleanText(l.text);
      if (TITLE_TO_KEY.has(text.replace(/\s+/g, ''))) return false;
      const dx = l.x - bodyLeft;
      return (dx >= -0.06 && dx <= 0.13) || PERIOD_RE.test(text);
    });
    const lines = groupVisualLines(body);

    const pageEvents: Stamped[] = [];
    for (const t of titles) {
      // 标题与右侧内容在同一视觉行，略微提前，保证先切区块
      pageEvents.push({ y: t.y - 0.006, kind: 'title', key: t.hit.key, title: t.hit.title });
    }
    for (const vl of lines) {
      pageEvents.push({ y: vl.y, kind: 'line', line: vl });
    }
    pageEvents.sort((a, b) => a.y - b.y);

    // 跨屏重叠行去重（上一屏尾部与当前屏头部相同）
    let skip = 0;
    const prevTexts = events
      .filter((e): e is LineEvent => e.kind === 'line')
      .slice(-6)
      .map((e) => looseKey(e.line.left));
    const curTexts = pageEvents
      .filter((e): e is Stamped & LineEvent => e.kind === 'line')
      .slice(0, 6)
      .map((e) => looseKey(e.line.left));
    for (let n = Math.min(prevTexts.length, curTexts.length); n >= 2; n--) {
      if (curTexts.slice(0, n).join('\u0001') === prevTexts.slice(-n).join('\u0001')) {
        skip = n;
        break;
      }
    }
    let skipped = 0;
    for (const ev of pageEvents) {
      if (ev.kind === 'line' && skipped < skip) {
        skipped += 1;
        continue;
      }
      events.push(ev);
    }
  }

  const lineEvents = events.filter((e): e is LineEvent => e.kind === 'line');
  if (!lineEvents.length) return out;
  const hasTitle = events.length > lineEvents.length;

  if (process.env.BOSS_PARSE_DEBUG) {
    console.error('[parse] bodyLeft=', bodyLeft, 'columnLeft=', columnLeft);
    for (const ev of events) {
      console.error(
        ev.kind === 'title'
          ? `  [T] ${ev.title}`
          : `  ${ev.line.y.toFixed(3)} ${ev.line.left.slice(0, 46)}${ev.line.right ? ' || ' + ev.line.right : ''}`,
      );
    }
  }

  // 3) 头部：姓名（字号最大且像人名）→ 状态行
  let cursor = 0;
  const headWindow = Math.min(lineEvents.length, 6);
  let nameIdx = -1;
  let maxH = 0;
  for (let i = 0; i < headWindow; i++) {
    const l = lineEvents[i].line;
    if (isPersonName(l.left) && l.height >= maxH) {
      maxH = l.height;
      nameIdx = i;
    }
  }
  if (nameIdx >= 0) {
    out.name = lineEvents[nameIdx].line.left;
    cursor = nameIdx + 1;
  }
  for (let i = cursor; i < Math.min(lineEvents.length, cursor + 3); i++) {
    const t = lineEvents[i].line.left;
    if (!out.headline && /(\d{2}\s*岁|本科|硕士|大专|博士|在职|离职|应届)/.test(t)) {
      out.headline = t;
      cursor = i + 1;
      break;
    }
  }
  if (!out.name && opts.candidateName) out.name = opts.candidateName;

  // 4) 按事件顺序切分区块
  const sections: OnlineResumeSection[] = [];
  let current: OnlineResumeSection | null = null;
  let currentItem: OnlineResumeItem | null = null;
  let seenLines = 0;

  const flushSection = () => {
    if (current) {
      pushItemToSection(current, currentItem);
      sections.push(current);
    }
    current = null;
    currentItem = null;
  };
  const openSection = (key: string, title: string): OnlineResumeSection => {
    flushSection();
    const sec: OnlineResumeSection = { key, title, items: [] };
    current = sec;
    return sec;
  };

  for (const ev of events) {
    if (ev.kind === 'title') {
      openSection(ev.key, ev.title);
      continue;
    }
    const lineIdx = seenLines;
    seenLines += 1;
    if (lineIdx < cursor) continue;

    const line = ev.line;
    const text = line.left;
    const period = line.right || `${text} ${line.right}`.match(PERIOD_RE)?.[0] || '';

    // 期望行：记录期望信息；无标题时单独切成「期望职位」区块
    if (isExpectationLine(text)) {
      if (!out.expectation) {
        const parts = text.split(/\s*[｜|]\s*/).filter(Boolean);
        out.expectation = { city: parts[0], position: parts[1], industry: parts[2], salary: parts[3] };
      }
      const cur = current as OnlineResumeSection | null;
      if (!hasTitle && cur?.key !== 'expectation') {
        const sec = openSection('expectation', '期望职位');
        sec.paragraphs = [text];
        continue;
      }
    }

    // 无标题兜底：按内容特征推断区块
    let sec: OnlineResumeSection | null = current as OnlineResumeSection | null;
    if (!sec) {
      if (isEduHeadline(text, period)) sec = openSection('education', '教育经历');
      else if (isOrgHeadline(text, period)) sec = openSection('work', '工作经历');
      else sec = openSection('advantage', '个人优势');
    } else if (!hasTitle) {
      const canSwitch = sec.key === 'advantage' || sec.key === 'expectation';
      if (canSwitch && (isOrgHeadline(text, period) || isEduHeadline(text, period))) {
        sec = isEduHeadline(text, period)
          ? openSection('education', '教育经历')
          : openSection('work', '工作经历');
      }
    }
    if (!sec) continue;

    if (ITEM_SECTION_KEYS.has(sec.key)) {
      const hasSep = /[｜|]/.test(text);
      const hasRightPeriod = Boolean(line.right && PERIOD_RE.test(line.right));
      // 教育经历的第二行是「专业｜学历」，不能当成新的学校条目
      const isHeadline =
        sec.key === 'education' ? !currentItem || hasRightPeriod : hasSep || hasRightPeriod;

      if (isHeadline) {
        pushItemToSection(sec, currentItem);
        const withoutPeriod = text.replace(PERIOD_RE, '').trim();
        const { org, role } = splitOrgRole(withoutPeriod);
        currentItem = { headline: withoutPeriod, org, role, period: line.right || period, lines: [] };
        continue;
      }
    }

    if (currentItem) {
      currentItem.lines.push(text);
    } else {
      sec.paragraphs = sec.paragraphs ?? [];
      sec.paragraphs.push(text);
    }
  }
  flushSection();

  out.sections = finalizeSections(sections);
  return out;
}

function looseKey(text: string): string {
  return text.replace(/[\s·•.,，。、|｜:：;；()（）\[\]【】]/g, '').toLowerCase();
}

/** 同一屏内两轮 OCR 结果去重：同位置（y 相近、x 相近）只保留文字更长的一份 */
function dedupeLines(lines: OcrLineLike[]): OcrLineLike[] {
  const out: OcrLineLike[] = [];
  for (const l of lines) {
    const dupIdx = out.findIndex(
      (e) => Math.abs(e.y - l.y) < 0.012 && Math.abs(e.x - l.x) < 0.035,
    );
    if (dupIdx === -1) {
      out.push(l);
      continue;
    }
    if (looseKey(l.text).length > looseKey(out[dupIdx].text).length) {
      out[dupIdx] = l;
    }
  }
  return out;
}

const EXPECT_RE = /[｜|]/;
const SALARY_RE = /(K|k|元\/月|元\/天|面议|薪)/;

function isExpectationLine(text: string): boolean {
  return EXPECT_RE.test(text) && SALARY_RE.test(text);
}

function isOrgHeadline(text: string, period: string): boolean {
  if (!/[｜|]/.test(text)) return false;
  if (isExpectationLine(text)) return false;
  if (text.length > 60) return false;
  // 有明确时间，或下一行像时间（period 由调用方传入）
  return Boolean(period) || /公司|有限|科技|集团|工作室|事业部|中心|银行|医院|学校|大学/.test(text);
}

function isEduHeadline(text: string, period: string): boolean {
  if (!/(大学|学院|学校|中学|高中|职校|党校)/.test(text)) return false;
  if (text.length > 60) return false;
  return Boolean(period) || /[｜|]/.test(text) || /(本科|硕士|博士|大专|高中|中专)/.test(text);
}

/** 结构化结果是否「有内容」（用于判断是否需要回退到截图展示） */
export function hasStructuredContent(s: OnlineResumeStructured | null | undefined): boolean {
  if (!s) return false;
  if (s.name) return true;
  if (s.headline) return true;
  return s.sections.some((sec) => sec.items.length > 0 || (sec.paragraphs?.length ?? 0) > 0 || sec.tags?.length);
}

/** 把结构化简历还原成便于阅读/复制的纯文本 */
export function structuredToPlainText(s: OnlineResumeStructured): string {
  const lines: string[] = [];
  if (s.name) lines.push(s.name);
  if (s.headline) lines.push(s.headline);
  const e = s.expectation;
  if (e) {
    const parts = [e.city, e.position, e.industry, e.salary].filter(Boolean);
    if (parts.length) lines.push(`期望：${parts.join('｜')}`);
  }

  for (const sec of s.sections) {
    if (sec.key === 'expectation' && s.expectation) continue;
    lines.push('', sec.title);
    for (const p of sec.paragraphs ?? []) lines.push(p);
    for (const item of sec.items) {
      const head = [item.org || item.headline || '', item.role || ''].filter(Boolean).join(' ｜ ');
      lines.push(item.period ? `${head}    ${item.period}` : head);
      for (const l of item.lines) lines.push(l);
      if (item.tags?.length) lines.push(item.tags.join(' · '));
    }
    if (sec.tags?.length) lines.push(sec.tags.join(' · '));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
