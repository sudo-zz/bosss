import type { Candidate, CandidateSource, EvalCandidate, Pipeline, Stage } from '@/types'
import { appBasePrefix } from '@/lib/api'

export const SOURCE_ORDER: CandidateSource[] = ['message', 'recommend', 'featured']

export const SOURCE_META: Record<
  CandidateSource,
  { label: string; shortLabel: string; className: string; dotClass: string }
> = {
  message: {
    label: '消息列表',
    shortLabel: '消息',
    className:
      'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-300',
    dotClass: 'bg-sky-500',
  },
  recommend: {
    label: '推荐牛人',
    shortLabel: '推荐',
    className:
      'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-300',
    dotClass: 'bg-violet-500',
  },
  featured: {
    label: '精选牛人',
    shortLabel: '精选',
    className:
      'border-amber-500/30 bg-amber-500/12 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
}

export function normalizeSource(raw?: string): CandidateSource {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'featured' || v === 'selected' || v === 'jingxuan' || v === '精选') return 'featured'
  if (v === 'recommend' || v === '推荐') return 'recommend'
  return 'message'
}

export function pdfResumeUrl(fileOrRelPath?: string | null): string | null {
  if (!fileOrRelPath) return null
  const clean = String(fileOrRelPath).replace(/^\/+/, '').replace(/^pdfs\//, '')
  if (!clean) return null
  return `${appBasePrefix()}/media/resumes/pdf/${encodeURIComponent(clean)}`
}

export function resumeScreenshotUrl(file?: string | null): string | null {
  if (!file) return null
  return `${appBasePrefix()}/media/resumes/screenshots/${encodeURIComponent(file)}`
}

export const STAGE_ORDER: Stage[] = [
  'new',
  'screened',
  'shortlisted',
  'greeted',
  'replied',
  'interview',
  'hold',
  'rejected',
]

export const PIPELINE_STEPS: Stage[] = [
  'new',
  'screened',
  'shortlisted',
  'greeted',
  'replied',
  'interview',
]

export const STAGE_LABEL: Record<string, string> = {
  new: '新线索',
  screened: '初筛通过',
  shortlisted: '进短名单',
  greeted: '已打招呼',
  replied: '已回复',
  interview: '已约面',
  hold: '暂缓',
  rejected: '已淘汰',
}

export const STAGE_DOT: Record<string, string> = {
  new: 'bg-zinc-400',
  screened: 'bg-sky-500',
  shortlisted: 'bg-indigo-500',
  greeted: 'bg-amber-500',
  replied: 'bg-teal-500',
  interview: 'bg-emerald-500',
  hold: 'bg-zinc-400/70',
  rejected: 'bg-rose-400',
}

/** 克制的语义状态标签 */
export const STAGE_CLASS: Record<string, string> = {
  new: 'bg-muted text-muted-foreground',
  screened: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  shortlisted: 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
  greeted: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  replied: 'bg-teal-500/12 text-teal-700 dark:text-teal-300',
  interview: 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-300',
  hold: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  rejected: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
}

export function avatarUrl(candidate: Candidate | EvalCandidate): string | null {
  if ('avatar' in candidate && candidate.avatar) {
    return `${appBasePrefix()}/media/avatars/${encodeURIComponent(candidate.avatar)}`
  }
  return null
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 1).toUpperCase()
}

/** 同一份名字生成稳定的柔和低饱和底色 */
export function tintFor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) % 360
  return `hsl(${hash} 36% 48%)`
}

export function scoreClass(score?: number): string {
  if (typeof score !== 'number') return 'text-muted-foreground'
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 68) return 'text-indigo-600 dark:text-indigo-400'
  if (score >= 55) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

export function tierBadge(score?: number, explicitTier?: string): { label: string; className: string } | null {
  const tier = explicitTier || (typeof score === 'number' ? (score >= 80 ? 'S' : score >= 68 ? 'A' : score >= 55 ? 'B' : '') : '')
  if (!tier) return null
  if (tier === 'S') return { label: 'S', className: 'bg-emerald-500/14 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300' }
  if (tier === 'A') return { label: 'A', className: 'bg-indigo-500/12 text-indigo-700 ring-1 ring-indigo-500/20 dark:text-indigo-300' }
  if (tier === 'B') return { label: 'B', className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' }
  if (tier === 'INTERN') return { label: '实习', className: 'bg-violet-500/12 text-violet-700 dark:text-violet-300' }
  return null
}

export function positionShortLabel(candidate: Candidate, pipeline?: Pipeline | null): string {
  const matched = pipeline?.meta.positions?.find((p) => p.id === candidate.positionId)
  if (matched) return matched.short || matched.name
  if (candidate.positionId === 'xmt') return '新媒体'
  if (candidate.positionId === 'ai-dev') return 'AI 开发'
  return candidate.job || '未分类'
}

const EXP_LIKE_RE = /^(?:\d+(?:-\d+)?年(?:以上|以内)?|\d{2}年应届生?|应届生?|在校生?|暂无经验|经验不限)$/
const AGE_LIKE_RE = /^\d+\s*岁$/
const EDU_LIKE_RE = /^(?:大专|本科|硕士|博士|中专|高中|初中|MBA|EMBA|统招本科|统招硕士)/i
const SALARY_LIKE_RE = /^(?:\d+\s*[-–~]\s*\d+\s*k(?:\s*·\s*\d+薪)?|面议)$/i
const NOISE_TEXT_RE = /^(?:页面调整阶段|伯乐台\s*·\s*寻才|招聘助手\s*·\s*简历筛选|DSH\s*招聘助手|招聘助手调整阶段)$/

export function isProfileSummaryString(text?: string): boolean {
  if (!text) return false
  const parts = text
    .split(/[｜|]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 3) return false
  return parts.some((p) => AGE_LIKE_RE.test(p) || EXP_LIKE_RE.test(p) || EDU_LIKE_RE.test(p) || SALARY_LIKE_RE.test(p))
}

export function resolvedFacts(candidate: Candidate): Candidate['facts'] {
  const raw = candidate.facts || {}
  const out: Candidate['facts'] = { ...raw }

  // 修正历史数据里 city 错填了年限（如 "3年"、"26年应届生"）的情况
  if (out.city && EXP_LIKE_RE.test(out.city.trim())) {
    if (!out.exp) out.exp = out.city.trim()
    out.city = undefined
  }

  // 若 summary 或 lastText 是竖线分隔的个人信息摘要，补齐缺失字段
  const profileSource = isProfileSummaryString(candidate.summary)
    ? candidate.summary
    : isProfileSummaryString(candidate.lastText)
      ? candidate.lastText
      : undefined

  if (profileSource) {
    const parts = profileSource
      .split(/[｜|]/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const part of parts) {
      if (AGE_LIKE_RE.test(part)) {
        if (!out.age) out.age = part
      } else if (EXP_LIKE_RE.test(part)) {
        if (!out.exp) out.exp = part
      } else if (EDU_LIKE_RE.test(part)) {
        if (!out.edu) out.edu = part
      } else if (SALARY_LIKE_RE.test(part)) {
        if (!out.salary) out.salary = part
      } else if (
        part.includes('·') ||
        /(?:科技|股份|公司|有限|集团|研究院|网络|信息|数据|智能|流域|问界|工作室|银行|医院|报社)/.test(part)
      ) {
        if (!out.latestWork) out.latestWork = part
      } else if (!out.city && part.length <= 16) {
        out.city = part
      } else if (!out.latestWork) {
        out.latestWork = part
      }
    }
  }

  return out
}

export function factsLine(candidate: Candidate): string {
  const f = resolvedFacts(candidate)
  return [f.age, f.exp, f.edu, f.city, f.salary, f.latestWork].filter(Boolean).join(' · ')
}

function compactText(raw: string, maxLen = 78): string {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  // 优先在句号/分号处截断，避免半句话显得生硬
  const slice = clean.slice(0, maxLen)
  const stopIdx = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('；'))
  if (stopIdx >= Math.floor(maxLen * 0.48)) {
    return slice.slice(0, stopIdx + 1)
  }
  return `${slice.replace(/[，,、；;：:\s]+$/, '')}…`
}

export type ConciseVerdict = {
  tag?: string
  tone: 'strong' | 'good' | 'neutral' | 'muted'
  text: string
  isFallbackMessage?: boolean
}

/** 提取适合卡片底部展示的精简 AI 综合研判（绝不重复个人信息） */
export function conciseVerdict(candidate: Candidate): ConciseVerdict | null {
  const reason = (candidate.reason || '').trim()
  if (reason && !NOISE_TEXT_RE.test(reason) && !isProfileSummaryString(reason)) {
    // 形式 1：【强烈建议约面·Java+Python双栈...】正文...
    const bracket = /^【([^】]+)】\s*(.*)$/s.exec(reason)
    if (bracket) {
      const inside = bracket[1].trim()
      const body = bracket[2].trim()
      const splitIdx = inside.indexOf('·')
      const tag = splitIdx > 0 ? inside.slice(0, splitIdx).trim() : inside
      const tagExtra = splitIdx > 0 ? inside.slice(splitIdx + 1).trim() : ''
      const tone: ConciseVerdict['tone'] = /强烈|推荐|优先|S级/.test(tag)
        ? 'strong'
        : /重点|不错|可约|A级/.test(tag)
          ? 'good'
          : 'neutral'
      const combined = tagExtra && body ? `${tagExtra}；${body}` : tagExtra || body
      return { tag, tone, text: compactText(combined, 76) }
    }

    // 形式 2：优势：xxx 风险：yyy
    if (reason.startsWith('优势：') || reason.startsWith('优势:')) {
      const [proPart, riskPart] = reason.split(/\s*风险[：:]\s*/)
      const pros = proPart
        .replace(/^优势[：:]\s*/, '')
        .split(/[、,，]/)
        .map((s) => s.replace(/[（(][^）)]*[）)]/g, '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ')
      const risk = riskPart
        ? riskPart
            .split(/[、,，]/)
            .map((s) => s.replace(/[（(][^）)]*[）)]/g, '').trim())
            .filter(Boolean)[0]
        : ''
      const summary = [pros, risk ? `注意：${risk}` : ''].filter(Boolean).join(' ｜ ')
      return {
        tag: (candidate.score ?? 0) >= 80 ? '高匹配' : 'AI 研判',
        tone: (candidate.score ?? 0) >= 80 ? 'strong' : (candidate.score ?? 0) >= 68 ? 'good' : 'neutral',
        text: compactText(summary || reason, 76),
      }
    }

    return {
      tag: 'AI 研判',
      tone: (candidate.score ?? 0) >= 80 ? 'strong' : 'neutral',
      text: compactText(reason, 78),
    }
  }

  // 形式 3：亮点 + 风险数组（如阶段调整覆盖了 reason 时）
  if (candidate.highlights?.length) {
    const pros = candidate.highlights
      .slice(0, 3)
      .map((s) => s.replace(/[（(][^）)]*[）)]/g, '').trim())
      .join(' · ')
    const risk = candidate.risks?.[0]?.replace(/[（(][^）)]*[）)]/g, '').trim()
    return {
      tag: (candidate.score ?? 0) >= 80 ? '强烈推荐' : 'AI 亮点',
      tone: (candidate.score ?? 0) >= 80 ? 'strong' : 'good',
      text: compactText([pros, risk ? `注意：${risk}` : ''].filter(Boolean).join(' ｜ '), 76),
    }
  }

  // 形式 4：非个人信息型的 summary
  const summary = (candidate.summary || '').trim()
  if (summary && !NOISE_TEXT_RE.test(summary) && !isProfileSummaryString(summary)) {
    return { tag: '摘要', tone: 'neutral', text: compactText(summary, 76) }
  }

  // 形式 5：仅当 lastText 是真实候选人发言时兜底展示
  const lastText = (candidate.lastText || '').trim()
  if (lastText && !NOISE_TEXT_RE.test(lastText) && !isProfileSummaryString(lastText)) {
    return { tone: 'muted', text: compactText(lastText, 76), isFallbackMessage: true }
  }

  return null
}

export function resumeSrc(page: string): string {
  return `${appBasePrefix()}/media/eval/${page.replace(/^\/+/, '').replace(/^assets\//, '')}`
}

export function relativeTime(value?: string): string {
  if (!value) return ''
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return value
  const diff = Date.now() - then
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.round(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(then).toLocaleDateString('zh-CN')
}

export type MessageTemplate = {
  id: string
  label: string
  build: (candidate: Candidate) => string
}

/** 严格保留仓库 AGENTS.md 记录的默认首选要简历文案，并提供高频场景快捷切换 */
export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'standard-resume',
    label: '标准要简历',
    build: () =>
      `你好，感谢投递，公司地点在奉贤区南上海科创中心,请问是否方便通勤？
我们的面试流程是一轮线上初面 + 现场进行技术面试（需要携带电脑）,请问是否方便呢？
可以的话麻烦发送一份附件简历过来，谢谢！`,
  },
  {
    id: 'follow-up',
    label: '追问进度',
    build: (c) =>
      `你好${c.name ? ` ${c.name}` : ''}，之前给你留过言，看你背景和我们岗位很契合。方便的话发一份附件简历过来，或者告知一下目前看机会的进度？`,
  },
  {
    id: 'schedule-first',
    label: '约线上初面',
    build: (c) =>
      `你好${c.name ? ` ${c.name}` : ''}，简历看过了很不错！我们想先安排一轮 20 分钟左右的线上初面，请问你明天或后天哪个时间段方便？`,
  },
  {
    id: 'verify-onsite',
    label: '核实到场与预算',
    build: (c) =>
      `你好${c.name ? ` ${c.name}` : ''}，看到你的经历很匹配。由于岗位需在上海奉贤区南上海科创中心现场技术面试与办公（可提供单人人才公寓），想先确认一下是否方便来沪现场面试及薪资预期？方便的话发一份附件简历，谢谢！`,
  },
]

export function greetingTemplate(candidate?: Candidate | string): string {
  if (!candidate || typeof candidate === 'string') {
    return MESSAGE_TEMPLATES[0]!.build({ name: typeof candidate === 'string' ? candidate : '' } as Candidate)
  }
  return MESSAGE_TEMPLATES[0]!.build(candidate)
}

export function dimEntries(candidate: Candidate): { key: string; label: string; value: number; max: number }[] {
  if (!candidate.dimensions) return []
  return Object.entries(candidate.dimensions).map(([key, value]) => {
    const meta = candidate.dimMeta?.[key]
    return { key, label: meta?.label || key, value, max: meta?.max || Math.max(value, 1) }
  })
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    recommend: '推荐面试',
    backup: '备选',
    reserve: '备选',
    pending: '待定',
    reject: '淘汰',
    hired: '已入职',
  }
  return map[status] || status
}
