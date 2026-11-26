import { Briefcase, Building2, GraduationCap, Sparkles, Target } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { OnlineResumeSection, OnlineResumeStructured } from '@/types'

const SECTION_ICON: Record<string, typeof Briefcase> = {
  advantage: Sparkles,
  expectation: Target,
  work: Briefcase,
  project: Building2,
  education: GraduationCap,
}

/** 「26岁 ｜本科｜6年｜离职-随时到岗」拆成可读片段 */
function splitMeta(text?: string): string[] {
  if (!text) return []
  return text
    .split(/\s*[｜|·]\s*|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 编号列表行（1、 / 1. / ① ）保留为独立条目，其余合并成段落 */
function isListItem(line: string): boolean {
  return /^\s*(\d+\s*[、.．)）]|[①-⑩]|[·•\-–—]\s)/.test(line)
}

function ResumeItemBlock({ item }: { item: OnlineResumeSection['items'][number] }) {
  const title = item.org || item.headline || ''
  const role = item.role && item.role !== title ? item.role : ''
  const numbered = item.lines.filter(isListItem)
  const prose = item.lines.filter((l) => !isListItem(l))

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0 text-[13.5px] leading-6">
          <span className="font-semibold text-foreground">{title}</span>
          {role && <span className="ml-2 text-[12.5px] text-muted-foreground">{role}</span>}
        </div>
        {item.period && (
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{item.period}</span>
        )}
      </div>

      {prose.length > 0 && (
        <div className="mt-1 space-y-1">
          {prose.map((line, i) => (
            <p key={i} className="text-[12.8px] leading-[1.75] text-foreground/85">
              {line}
            </p>
          ))}
        </div>
      )}

      {numbered.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {numbered.map((line, i) => (
            <li key={i} className="text-[12.8px] leading-[1.75] text-foreground/85">
              {line}
            </li>
          ))}
        </ul>
      )}

      {item.tags && item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ResumeSectionBlock({ section }: { section: OnlineResumeSection }) {
  const Icon = SECTION_ICON[section.key]
  const hasItems = section.items.length > 0
  const hasParas = (section.paragraphs?.length ?? 0) > 0

  return (
    <section className="grid gap-2 px-6 py-4.5 @[600px]:grid-cols-[92px_minmax(0,1fr)] @[600px]:gap-5 @[600px]:px-7">
      <h3 className="flex items-center gap-1.5 self-start text-[11.5px] font-medium tracking-wide text-muted-foreground @[600px]:pt-0.5">
        {Icon && <Icon className="size-3.5 shrink-0 opacity-70" />}
        <span className="truncate">{section.title}</span>
      </h3>

      <div className="min-w-0 space-y-3.5">
        {hasParas &&
          section.paragraphs!.map((para, i) => (
            <p key={i} className="text-[12.8px] leading-[1.8] text-foreground/85">
              {para}
            </p>
          ))}

        {hasItems && section.items.map((item, i) => <ResumeItemBlock key={i} item={item} />)}

        {section.tags && section.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {section.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export type OnlineResumePaperProps = {
  data: OnlineResumeStructured
  candidateName: string
  capturedAt?: string
  className?: string
}

/**
 * 自有版式的「在线简历」渲染：与 BOSS 官方在线简历的左标题 / 右内容两栏结构相近，
 * 但排版、字重与留白按工作台阅读场景重新设计，避免直接展示模糊截图。
 */
export function OnlineResumePaper({ data, candidateName, capturedAt, className }: OnlineResumePaperProps) {
  const name = data.name || candidateName
  const meta = splitMeta(data.headline)
  const exp = data.expectation
  const expParts = [exp?.position, exp?.salary, exp?.city, exp?.industry].filter(Boolean)
  // 期望信息已经在头部展示，不再重复渲染「期望职位」区块
  const sections = data.sections.filter((sec) => {
    if (sec.key === 'expectation' && expParts.length > 0) return false
    return sec.items.length > 0 || (sec.paragraphs?.length ?? 0) > 0 || (sec.tags?.length ?? 0) > 0
  })

  return (
    <article
      className={cn(
        '@container mx-auto w-full max-w-[780px] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs',
        className,
      )}
    >
      <header className="border-b bg-gradient-to-b from-muted/40 to-transparent px-6 py-5 @[600px]:px-7">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">{name}</h1>
          {meta.slice(-1).map((status) => (
            <span
              key={status}
              className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
            >
              {status}
            </span>
          ))}
        </div>

        {meta.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
            {meta.slice(0, -1).map((part, i) => (
              <span key={`${part}-${i}`} className="flex items-center gap-2.5">
                {i > 0 && <span className="text-muted-foreground/70">·</span>}
                {part}
              </span>
            ))}
          </div>
        )}

        {expParts.length > 0 && (
          <div className="mt-2.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-background/70 px-2.5 py-1.5 text-[12px]">
            {expParts.map((part, i) => (
              <span key={`${part}-${i}`} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground/40">|</span>}
                <span className={i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}>{part}</span>
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="divide-y">
        {sections.map((sec) => (
          <ResumeSectionBlock key={sec.key + sec.title} section={sec} />
        ))}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-6 py-2.5 text-[10.5px] text-muted-foreground @[600px]:px-7">
        <span>本页由工作台按 BOSS 在线简历内容重新排版，原文以官方页面为准</span>
        <span className="tabular-nums">
          {capturedAt ? `采集于 ${new Date(capturedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
          {data.source === 'ocr' ? ' · 本地 OCR' : ' · 页面文本'}
        </span>
      </footer>
    </article>
  )
}
