import { useMemo, useState } from 'react'
import { ArrowDownUp, CheckCircle2, GraduationCap, ListFilter, SearchX, Sparkles, Star, Target } from 'lucide-react'

import { NumberPopIn } from '@/components/motion/effects'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { avatarUrl, initials, scoreClass, statusLabel, tintFor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDesk } from '@/store/desk'
import type { EvalCandidate } from '@/types'

type EvalSort = 'composite' | 'resume' | 'interview'
type InterviewFilter = 'all' | 'interviewed' | 'pending'

export function AssessPanel() {
  const { evalData, pipeline, selectedEvalId, selectEval, position, setPosition, query } = useDesk()
  const [status, setStatus] = useState('all')
  const [interviewFilter, setInterviewFilter] = useState<InterviewFilter>('all')
  const [evalSort, setEvalSort] = useState<EvalSort>('composite')

  const avatarByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of pipeline?.candidates || []) {
      const url = avatarUrl(c)
      if (url && !map.has(c.name)) map.set(c.name, url)
    }
    return map
  }, [pipeline?.candidates])

  const list = useMemo(() => {
    if (!evalData) return []
    const q = query.trim().toLowerCase()
    return evalData.candidates
      .filter((c) => (position === 'all' ? true : c.positionId === position))
      .filter((c) => (status === 'all' ? true : c.status === status))
      .filter((c) => {
        if (interviewFilter === 'interviewed') return Boolean(c.interview)
        if (interviewFilter === 'pending') return !c.interview
        return true
      })
      .filter((c) => {
        if (!q) return true
        return [c.name, c.current, c.tagline, c.school, c.schoolTag, c.intent]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        if (evalSort === 'resume') return (b.score || 0) - (a.score || 0)
        if (evalSort === 'interview') {
          const ai = typeof a.interview?.score === 'number' ? a.interview.score : -1
          const bi = typeof b.interview?.score === 'number' ? b.interview.score : -1
          return bi - ai || (b.composite ?? b.score) - (a.composite ?? a.score)
        }
        return (b.composite ?? b.score) - (a.composite ?? a.score)
      })
  }, [evalData, position, status, interviewFilter, evalSort, query])

  if (!evalData) {
    return (
      <div className="space-y-3 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/70" />
        ))}
      </div>
    )
  }

  const all = evalData.candidates
  const recommended = all.filter((c) => c.status === 'recommend').length
  const interviewed = all.filter((c) => c.interview).length
  const avg = Math.round(all.reduce((sum, c) => sum + (c.composite ?? c.score), 0) / Math.max(1, all.length))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-2.5 px-4 pt-3.5 sm:grid-cols-4">
        <StatCard
          label="评估库"
          value={all.length}
          unit="份"
          hint={`${evalData.positions?.length ?? 0} 个在招岗位`}
          active={status === 'all' && interviewFilter === 'all'}
          onClick={() => {
            setStatus('all')
            setInterviewFilter('all')
          }}
        />
        <StatCard
          label="推荐面试"
          value={recommended}
          unit="人"
          hint="简历分达标"
          accent="emerald"
          active={status === 'recommend'}
          onClick={() => setStatus((prev) => (prev === 'recommend' ? 'all' : 'recommend'))}
        />
        <StatCard
          label="已完成面试"
          value={interviewed}
          unit="人"
          hint="含一面评分"
          accent="indigo"
          active={interviewFilter === 'interviewed'}
          onClick={() => setInterviewFilter((prev) => (prev === 'interviewed' ? 'all' : 'interviewed'))}
        />
        <StatCard label="平均综合分" value={avg} unit="分" hint="满分 100" />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
        <Tabs value={position} onValueChange={setPosition} className="min-w-0">
          <TabsList className="h-7.5 bg-muted/80 p-0.5">
            <TabsTrigger value="all" className="px-2.5 text-[11.5px]">
              全部
            </TabsTrigger>
            {(evalData.positions || []).map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="px-2.5 text-[11.5px]">
                {item.short || item.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          {(['all', 'interviewed', 'pending'] as InterviewFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setInterviewFilter(key)}
              className={cn(
                'h-7 rounded-lg border px-2 text-[11px] font-medium transition-colors',
                interviewFilter === key
                  ? 'border-foreground/30 bg-foreground text-background'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {key === 'all' ? '不限进度' : key === 'interviewed' ? '已面试' : '待面试'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm" className="h-7.5 w-[116px] bg-card text-[11.5px] shadow-2xs">
              <ListFilter className="size-3 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="recommend">推荐面试</SelectItem>
              <SelectItem value="backup">备选</SelectItem>
              <SelectItem value="reject">淘汰</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="h-7.5 gap-1 bg-card px-2 text-[11.5px] shadow-2xs">
                <ArrowDownUp className="size-3 text-muted-foreground" />
                {evalSort === 'composite' ? '综合分' : evalSort === 'resume' ? '简历分' : '面试分'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEvalSort('composite')} className="text-[12px]">
                按综合分
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEvalSort('resume')} className="text-[12px]">
                按简历分
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEvalSort('interview')} className="text-[12px]">
                按面试分优先
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1.5 px-4 pb-4">
          {list.length === 0 ? (
            <Empty className="border border-dashed bg-card/70">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>没有匹配的评估记录</EmptyTitle>
                <EmptyDescription>换个岗位、面试进度或清空搜索。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            list.map((candidate, index) => (
              <EvalRow
                key={candidate.id}
                candidate={candidate}
                avatar={avatarByName.get(candidate.name) ?? null}
                rank={index + 1}
                active={candidate.id === selectedEvalId}
                onSelect={() => selectEval(candidate.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between border-t bg-background/80 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3" />
          <span className="tabular-nums">{list.length} 份评估</span>
          <span className="mx-0.5 opacity-35">·</span>
          <span>简历分 + 面试分 = 综合分</span>
        </span>
        <span>更新 {evalData.meta.updatedAt}</span>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  unit,
  hint,
  accent,
  active,
  onClick,
}: {
  label: string
  value: number
  unit: string
  hint: string
  accent?: 'emerald' | 'indigo'
  active?: boolean
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card px-3 py-2.5 text-left shadow-2xs transition-all',
        onClick && 'cursor-pointer hover:border-foreground/20 hover:shadow-xs',
        active &&
          (accent === 'emerald'
            ? 'border-emerald-500/45 bg-emerald-500/[0.04] ring-1 ring-emerald-500/20'
            : accent === 'indigo'
              ? 'border-indigo-500/45 bg-indigo-500/[0.04] ring-1 ring-indigo-500/20'
              : 'border-foreground/25 ring-1 ring-foreground/10'),
      )}
    >
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        {accent === 'emerald' && <span className="size-1.5 rounded-full bg-emerald-500" />}
        {accent === 'indigo' && <span className="size-1.5 rounded-full bg-indigo-500" />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <NumberPopIn value={value} className="text-[20px] leading-none font-semibold tracking-tight" />
        <span className="text-[10.5px] text-muted-foreground">{unit}</span>
      </div>
      <div className="mt-1.5 truncate text-[10.5px] text-muted-foreground/90">{hint}</div>
    </Tag>
  )
}

function EvalRow({
  candidate,
  avatar,
  rank,
  active,
  onSelect,
}: {
  candidate: EvalCandidate
  avatar: string | null
  rank: number
  active: boolean
  onSelect: () => void
}) {
  const score = candidate.composite ?? candidate.score
  const statusTone =
    candidate.status === 'recommend'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : candidate.status === 'reject'
        ? 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : 'border-border bg-muted/60 text-muted-foreground'

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
        active
          ? 'border-foreground/30 bg-card shadow-xs ring-1 ring-foreground/8'
          : 'border-border/80 bg-card/85 hover:border-foreground/18 hover:bg-card hover:shadow-2xs',
      )}
    >
      {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full bg-foreground" />}

      <div
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
          rank === 1
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            : rank <= 3
              ? 'bg-foreground/8 text-foreground'
              : 'text-muted-foreground/65',
        )}
      >
        {rank}
      </div>

      <Avatar className="size-9 shrink-0 rounded-lg">
        {avatar && <AvatarImage src={avatar} alt={candidate.name} className="object-cover" />}
        <AvatarFallback
          className="rounded-lg text-[11.5px] font-medium text-white"
          style={{ backgroundColor: tintFor(candidate.name) }}
        >
          {initials(candidate.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold tracking-tight">{candidate.name}</span>
          {candidate.status === 'recommend' && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
          {candidate.schoolTag && (
            <Badge variant="outline" className="h-4 rounded px-1 text-[9.5px] font-normal text-muted-foreground">
              {candidate.schoolTag}
            </Badge>
          )}
          {candidate.interview && (
            <Badge className="h-4 gap-0.5 rounded bg-indigo-500/12 px-1.5 text-[9.5px] font-medium text-indigo-700 dark:text-indigo-300">
              <CheckCircle2 className="size-2.5" />
              一面 {candidate.interview.score ?? '—'}
            </Badge>
          )}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">{candidate.tagline || candidate.current}</div>
        <div className="flex items-center gap-2.5 text-[10.5px] text-muted-foreground/80">
          <span className="flex min-w-0 items-center gap-0.5 truncate">
            <GraduationCap className="size-2.5 shrink-0" />
            <span className="truncate">{candidate.school || candidate.education}</span>
          </span>
          <span className="flex min-w-0 items-center gap-0.5 truncate">
            <Target className="size-2.5 shrink-0" />
            <span className="truncate">{candidate.intent || candidate.positionId}</span>
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className={cn('text-[18px] leading-none font-semibold tracking-tight tabular-nums', scoreClass(score))}>
          {score}
        </div>
        <span className={cn('rounded border px-1.5 py-0.2 text-[9.5px] font-medium', statusTone)}>
          {statusLabel(candidate.status)}
        </span>
      </div>
    </button>
  )
}
