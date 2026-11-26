import { FileText, Globe, ImageIcon, Sparkles } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  SOURCE_META,
  STAGE_DOT,
  STAGE_LABEL,
  STAGE_ORDER,
  avatarUrl,
  initials,
  normalizeSource,
  oneSentenceSummary,
  positionShortLabel,
  resolvedFacts,
  scoreClass,
  tierBadge,
  tintFor,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Candidate, Pipeline, Stage } from '@/types'

/** 纯只读阶段看板（阶段更新由左侧 Agent 写入 ~/.boss-cli/tracker.json 后实时同步） */
export function Board({
  candidates,
  pipeline,
  selectedId,
  onOpen,
}: {
  candidates: Candidate[]
  pipeline: Pipeline | null
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  return (
    <div className="relative h-full">
      <div className="flex h-full gap-2.5 overflow-x-auto px-4 pb-3">
        {STAGE_ORDER.map((stage) => {
          const items = candidates.filter((c) => c.stage === stage)
          return (
            <Column
              key={stage}
              stage={stage}
              items={items}
              pipeline={pipeline}
              selectedId={selectedId}
              onOpen={onOpen}
            />
          )
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent" />
    </div>
  )
}

function Column({
  stage,
  items,
  pipeline,
  selectedId,
  onOpen,
}: {
  stage: Stage
  items: Candidate[]
  pipeline: Pipeline | null
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const scored = items.filter((c) => typeof c.score === 'number')
  const avg = scored.length ? Math.round(scored.reduce((acc, c) => acc + (c.score || 0), 0) / scored.length) : null

  return (
    <div className="flex h-full min-h-0 w-[238px] shrink-0 flex-col rounded-xl border border-border/80 bg-muted/35 p-2">
      <div className="mb-2 flex shrink-0 items-center gap-1.5 px-1 py-0.5">
        <span className={cn('size-2 rounded-full', STAGE_DOT[stage])} />
        <span className="text-[12px] font-semibold tracking-tight">{STAGE_LABEL[stage]}</span>
        <span className="rounded bg-background/80 px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground tabular-nums">
          {items.length}
        </span>
        {avg !== null && <span className="ml-auto text-[10px] text-muted-foreground/80 tabular-nums">均 {avg}</span>}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {items.slice(0, 60).map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => onOpen(candidate.id)}
            className="block w-full text-left"
          >
            <Card candidate={candidate} pipeline={pipeline} selected={candidate.id === selectedId} />
          </button>
        ))}
        {items.length === 0 && (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border/70 text-[11px] text-muted-foreground/70">
            暂无候选人
          </div>
        )}
        {items.length > 60 && (
          <div className="py-1.5 text-center text-[10.5px] text-muted-foreground">
            还有 {items.length - 60} 人（可切列表或筛选查看）
          </div>
        )}
      </div>
    </div>
  )
}

function Card({
  candidate,
  pipeline,
  selected,
}: {
  candidate: Candidate
  pipeline: Pipeline | null
  selected?: boolean
}) {
  const avatar = avatarUrl(candidate)
  const tier = tierBadge(candidate.score, candidate.tier)
  const posLabel = positionShortLabel(candidate, pipeline)
  const srcMeta = SOURCE_META[normalizeSource(candidate.source)]
  const hasLocalPdf = Boolean(candidate.resumePdfFile || candidate.evalPdfPath)
  const facts = resolvedFacts(candidate)
  const summary = oneSentenceSummary(candidate)

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-2.5 shadow-2xs transition-all hover:border-foreground/20',
        selected && 'border-foreground/35 ring-1 ring-foreground/10',
      )}
    >
      <div className="flex items-start gap-2">
        <Avatar className="size-7.5 rounded-md">
          {avatar && <AvatarImage src={avatar} alt={candidate.name} className="object-cover" />}
          <AvatarFallback
            className="rounded-md text-[10px] font-medium text-white"
            style={{ backgroundColor: tintFor(candidate.name) }}
          >
            {initials(candidate.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[12.5px] font-semibold">{candidate.name}</span>
            {tier && (
              <span className={cn('rounded px-1 py-0.2 text-[9px] font-semibold', tier.className)}>{tier.label}</span>
            )}
          </div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {[facts.exp, facts.city, facts.salary].filter(Boolean).join(' · ') || candidate.job}
          </div>
        </div>
        <span className={cn('text-[14px] font-semibold tabular-nums', scoreClass(candidate.score))}>
          {candidate.score ?? '—'}
        </span>
      </div>

      {summary && (
        <div className="mt-1.5 line-clamp-2 border-t border-border/50 pt-1.5 text-[10.5px] leading-snug text-foreground/75">
          {summary}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge variant="outline" className="h-4 rounded px-1 text-[9.5px] font-normal text-muted-foreground">
          {posLabel}
        </Badge>
        <Badge variant="outline" className={cn('h-4 rounded px-1 text-[9.5px] font-normal', srcMeta.className)}>
          {srcMeta.shortLabel}
        </Badge>
        {hasLocalPdf && (
          <span title="已存本地 PDF 简历" className="inline-flex">
            <FileText className="size-2.5 shrink-0 text-rose-500" />
          </span>
        )}
        {candidate.onlineResumeFile && (
          <span title="已存 Boss 在线简历" className="inline-flex">
            <Globe className="size-2.5 shrink-0 text-sky-500" />
          </span>
        )}
        {candidate.evalId && <Sparkles className="size-2.5 shrink-0 text-indigo-500" />}
        {candidate.hasResumeImage && <ImageIcon className="size-2.5 shrink-0 text-emerald-500" />}
        <span className="ml-auto truncate text-[9.5px] text-muted-foreground/75">{facts.latestWork || ''}</span>
      </div>
    </div>
  )
}
