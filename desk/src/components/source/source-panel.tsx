import { useMemo } from 'react'
import { motion } from 'motion/react'
import {
  ArrowDownUp,
  Briefcase,
  Columns3,
  Copy,
  Crown,
  FileText,
  Flame,
  Globe,
  Hand,
  ImageIcon,
  Inbox,
  List,
  MapPin,
  MessageSquare,
  Radio,
  RefreshCw,
  RotateCcw,
  SearchX,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

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
import {
  SOURCE_META,
  STAGE_CLASS,
  STAGE_DOT,
  STAGE_LABEL,
  STAGE_ORDER,
  avatarUrl,
  conciseVerdict,
  factsLine,
  initials,
  normalizeSource,
  positionShortLabel,
  scoreClass,
  tierBadge,
  tintFor,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { filterCandidates, useDesk, type QuickFilterKey, type SourceFilterKey } from '@/store/desk'
import type { Candidate, CandidateSource, Pipeline } from '@/types'
import { Board } from './board'

const EMPTY_CANDIDATES: Candidate[] = []

type QuickFilterSpec = {
  key: QuickFilterKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}

function quickFiltersForSource(sourceFilter: SourceFilterKey): QuickFilterSpec[] {
  if (sourceFilter === 'recommend' || sourceFilter === 'featured') {
    return [
      { key: 'not_greeted', label: '待打招呼', icon: Hand },
      { key: 'active_now', label: '在线 / 刚活跃', icon: Radio },
      { key: 'shanghai', label: '仅上海', icon: MapPin },
      { key: 'has_local_resume', label: '已存本地简历', icon: FileText },
      { key: 'high_uncontacted', label: '高分 ≥70', icon: Flame },
    ]
  }
  if (sourceFilter === 'message') {
    return [
      { key: 'high_uncontacted', label: '高分 ≥70', icon: Flame },
      { key: 'shanghai', label: '仅上海', icon: MapPin },
      { key: 'awaiting_reply', label: '待跟进/未读', icon: MessageSquare },
      { key: 'has_local_resume', label: '已存简历', icon: FileText },
      { key: 'has_eval_or_img', label: '已评/附图', icon: Sparkles },
    ]
  }
  return [
    { key: 'high_uncontacted', label: '高分 ≥70', icon: Flame },
    { key: 'shanghai', label: '仅上海', icon: MapPin },
    { key: 'has_local_resume', label: '已存简历', icon: FileText },
    { key: 'active_now', label: '在线/刚活跃', icon: Radio },
    { key: 'has_eval_or_img', label: '已评/附图', icon: Sparkles },
  ]
}

export function SourcePanel() {
  const {
    pipeline,
    loading,
    sourceFilter,
    stage,
    quickFilter,
    position,
    query,
    sort,
    sourceView,
    setSourceFilter,
    setStage,
    setQuickFilter,
    resetSourceFilters,
    setPosition,
    setSort,
    setSourceView,
    selectedId,
    select,
    refresh,
    refreshing,
  } = useDesk()

  const candidates = pipeline?.candidates ?? EMPTY_CANDIDATES

  const positionScoped = useMemo(
    () => (position === 'all' ? candidates : candidates.filter((c) => c.positionId === position)),
    [candidates, position],
  )

  const sourceCounts = useMemo(() => {
    const counts: Record<CandidateSource, number> = { message: 0, recommend: 0, featured: 0 }
    for (const c of positionScoped) {
      counts[normalizeSource(c.source)] += 1
    }
    return counts
  }, [positionScoped])

  const sourceScoped = useMemo(
    () =>
      sourceFilter === 'all'
        ? positionScoped
        : positionScoped.filter((c) => normalizeSource(c.source) === sourceFilter),
    [positionScoped, sourceFilter],
  )

  const stageCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of sourceScoped) {
      out[c.stage] = (out[c.stage] || 0) + 1
    }
    return out
  }, [sourceScoped])

  const list = useMemo(
    () => filterCandidates(candidates, { sourceFilter, stage, quickFilter, position, query, sort }),
    [candidates, sourceFilter, stage, quickFilter, position, query, sort],
  )

  const highUncontactedCount = useMemo(
    () => sourceScoped.filter((c) => (c.score ?? 0) >= 70 && ['new', 'screened', 'shortlisted'].includes(c.stage)).length,
    [sourceScoped],
  )

  const notGreetedCount = useMemo(
    () => sourceScoped.filter((c) => c.canGreet !== false && ['new', 'screened', 'shortlisted'].includes(c.stage)).length,
    [sourceScoped],
  )

  const localResumeStats = useMemo(() => {
    let pdf = 0
    let online = 0
    for (const c of sourceScoped) {
      if (c.resumePdfFile || c.evalPdfPath) pdf += 1
      if (c.onlineResumeFile) online += 1
    }
    return { total: pdf + online, pdf, online }
  }, [sourceScoped])

  if (loading && !pipeline) {
    return <ListSkeleton />
  }

  const stats = pipeline?.stats
  const isSourcingView = sourceFilter === 'recommend' || sourceFilter === 'featured'
  const reached = (stageCounts.greeted || 0) + (stageCounts.replied || 0) + (stageCounts.interview || 0)
  const awaiting = (stageCounts.greeted || 0) + (stageCounts.shortlisted || 0)
  const hasActiveFilter =
    sourceFilter !== 'all' || stage !== 'all' || quickFilter !== 'all' || position !== 'all' || Boolean(query.trim())
  const quickFilters = quickFiltersForSource(sourceFilter)

  const copyAgentPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success('已复制 Agent 指令', { description: '直接粘贴到左侧 WorkBuddy / 千问办公 / 豆包工作 对话框即可执行' })
    } catch {
      toast.error('复制失败')
    }
  }

  const emptySourcingPrompt =
    sourceFilter === 'featured'
      ? '请调用 boss recommend --tab featured --limit 20 --sync-tracker --json 从 Boss 精选牛人拉取候选人并写入台账，右侧看板会自动刷新。'
      : sourceFilter === 'recommend'
        ? '请调用 boss recommend --tab recommend --limit 20 --sync-tracker --json 从 Boss 推荐牛人拉取候选人并写入台账，右侧看板会自动刷新。'
        : '请先调用 boss doctor --json 检查 Safari，再巡检未读消息或导入本地 PDF 简历到 ~/.boss-cli/，右侧看板会自动刷新。'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部 KPI 统计卡（随来源与岗位实时联动） */}
      <div className="grid shrink-0 grid-cols-2 gap-2.5 px-4 pt-3.5 sm:grid-cols-4">
        <StatCard
          label={sourceFilter === 'all' ? '在库候选人' : SOURCE_META[sourceFilter].label}
          value={sourceScoped.length}
          unit="人"
          hint={`消息 ${sourceCounts.message} · 推荐 ${sourceCounts.recommend} · 精选 ${sourceCounts.featured}`}
          active={sourceFilter === 'all' && stage === 'all' && quickFilter === 'all'}
          onClick={resetSourceFilters}
        />
        {isSourcingView ? (
          <StatCard
            label="待打招呼"
            value={notGreetedCount}
            unit="人"
            hint="在线/刚活跃可优先跟进"
            accent="emerald"
            active={quickFilter === 'not_greeted'}
            onClick={() => setQuickFilter('not_greeted')}
          />
        ) : (
          <StatCard
            label="高分待推进"
            value={highUncontactedCount}
            unit="人"
            hint="≥70分 · 待发起沟通"
            accent="emerald"
            active={quickFilter === 'high_uncontacted'}
            onClick={() => setQuickFilter('high_uncontacted')}
          />
        )}
        <StatCard
          label="已触达 / 跟进"
          value={reached}
          unit="人"
          hint={`待回复 ${awaiting} 人 · 今日 +${stats?.todayNew ?? 0}`}
          accent="amber"
          active={quickFilter === 'awaiting_reply'}
          onClick={() => setQuickFilter('awaiting_reply')}
        />
        <StatCard
          label="本地简历存档"
          value={localResumeStats.total}
          unit="份"
          hint={`PDF ${localResumeStats.pdf} · 在线简历 ${localResumeStats.online}`}
          active={quickFilter === 'has_local_resume'}
          onClick={() => setQuickFilter('has_local_resume')}
        />
      </div>

      {/* 来源渠道切换与统计栏（消息列表 / 推荐牛人 / 精选牛人，不含最新） */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-3">
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
          <SourceTabChip
            active={sourceFilter === 'all'}
            onClick={() => setSourceFilter('all')}
            icon={Users}
            label="全部来源"
            count={positionScoped.length}
          />
          <SourceTabChip
            active={sourceFilter === 'message'}
            onClick={() => setSourceFilter('message')}
            icon={Inbox}
            label="消息列表"
            count={sourceCounts.message}
            dotClass={SOURCE_META.message.dotClass}
          />
          <SourceTabChip
            active={sourceFilter === 'recommend'}
            onClick={() => setSourceFilter('recommend')}
            icon={UserPlus}
            label="推荐牛人"
            count={sourceCounts.recommend}
            dotClass={SOURCE_META.recommend.dotClass}
          />
          <SourceTabChip
            active={sourceFilter === 'featured'}
            onClick={() => setSourceFilter('featured')}
            icon={Crown}
            label="精选牛人"
            count={sourceCounts.featured}
            dotClass={SOURCE_META.featured.dotClass}
          />
        </div>
      </div>

      {/* 阶段流转筛选 */}
      <div className="shrink-0 px-4 pt-2">
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto pb-0.5">
          <StageChip
            active={stage === 'all' && quickFilter === 'all'}
            onClick={() => setStage('all')}
            label="全部"
            count={sourceScoped.length}
          />
          {STAGE_ORDER.map((key) => (
            <StageChip
              key={key}
              active={stage === key}
              onClick={() => setStage(key)}
              label={STAGE_LABEL[key]}
              dotClass={STAGE_DOT[key]}
              count={stageCounts[key] || 0}
            />
          ))}
        </div>
      </div>

      {/* 岗位筛选 + 差异化来源快捷筛选 + 排序/视图 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-2 pb-2.5">
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger size="sm" className="h-7.5 w-[132px] bg-card text-[11.5px] shadow-2xs">
            <SelectValue placeholder="全部岗位" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部岗位</SelectItem>
            {(pipeline?.meta.positions || []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.short}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {quickFilters.map((spec) => (
          <QuickChip
            key={spec.key}
            active={quickFilter === spec.key}
            onClick={() => setQuickFilter(spec.key)}
            icon={spec.icon}
            label={spec.label}
          />
        ))}

        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="xs"
            onClick={resetSourceFilters}
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            重置
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="h-7.5 gap-1 bg-card px-2 text-[11.5px] shadow-2xs">
                <ArrowDownUp className="size-3 text-muted-foreground" />
                {sort === 'score' ? '匹配分' : '最近活跃'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setSort('score')} className="text-[12px]">
                按匹配分从高到低
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSort('recent')} className="text-[12px]">
                按最近消息 / 活跃时间
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tabs value={sourceView} onValueChange={(value) => setSourceView(value as 'list' | 'board')}>
            <TabsList className="h-7.5 bg-muted/80 p-0.5">
              <TabsTrigger value="list" className="gap-1 px-2 text-[11.5px]">
                <List className="size-3" />
                列表
              </TabsTrigger>
              <TabsTrigger value="board" className="gap-1 px-2 text-[11.5px]">
                <Columns3 className="size-3" />
                看板
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {sourceView === 'list' ? (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14 }}
            className="h-full"
          >
            <ScrollArea className="desk-list-scroll h-full">
              <div className="space-y-1.5 px-4 pb-4">
                {list.length === 0 ? (
                  <Empty className="border border-dashed bg-card/70">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SearchX />
                      </EmptyMedia>
                      <EmptyTitle>
                        {sourceScoped.length === 0
                          ? sourceFilter === 'all'
                            ? '当前本地招聘台账为空'
                            : `暂无「${SOURCE_META[sourceFilter].label}」记录`
                          : '没有符合条件的候选人'}
                      </EmptyTitle>
                      <EmptyDescription>
                        {sourceScoped.length === 0
                          ? '在左侧 Agent（WorkBuddy / 千问办公 / 豆包工作）对话中下达 Boss 抓取或本地 PDF 简历归档指令，本页面将自动实时刷新展示。'
                          : '尝试切换来源、阶段、关闭快捷筛选或清空搜索关键词。'}
                      </EmptyDescription>
                    </EmptyHeader>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {sourceScoped.length === 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void copyAgentPrompt(emptySourcingPrompt)}
                          className="gap-1.5"
                        >
                          <Copy className="size-3.5" />
                          复制拉取指令给左侧 Agent
                        </Button>
                      )}
                      {hasActiveFilter && (
                        <Button variant="outline" size="sm" onClick={resetSourceFilters}>
                          重置筛选条件
                        </Button>
                      )}
                    </div>
                  </Empty>
                ) : (
                  list.map((candidate) => (
                    <CandidateRow
                      key={candidate.id}
                      candidate={candidate}
                      pipeline={pipeline}
                      active={candidate.id === selectedId}
                      onSelect={() => select(candidate.id)}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </motion.div>
        ) : (
          <motion.div
            key="board"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14 }}
            className="h-full"
          >
            <Board candidates={list} pipeline={pipeline} selectedId={selectedId} onOpen={(id) => select(id)} />
          </motion.div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t bg-background/80 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users className="size-3" />
          <span className="tabular-nums">
            {list.length} / {sourceScoped.length} 人
          </span>
          <span className="mx-0.5 opacity-35">·</span>
          <span>更新 {pipeline?.meta.generatedAt.slice(11, 16)}</span>
          <span className="ml-2 hidden text-[10px] text-muted-foreground/75 xl:inline">↑↓ 切人 · / 搜索 · 只读展示</span>
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? 'size-3 animate-spin' : 'size-3'} />
          {refreshing ? '读取中' : '刷新数据'}
        </Button>
      </div>
    </div>
  )
}

function SourceTabChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  dotClass,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  dotClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition-all',
        active
          ? 'border-foreground/30 bg-foreground text-background shadow-2xs'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground',
      )}
    >
      {dotClass ? (
        <span className={cn('size-1.5 rounded-full', active ? 'bg-background/80' : dotClass)} />
      ) : (
        <Icon className="size-3" />
      )}
      <span>{label}</span>
      <span
        className={cn(
          'rounded px-1 py-0.2 text-[10px] tabular-nums',
          active ? 'bg-background/15 text-background/90' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
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
  accent?: 'emerald' | 'amber'
  active?: boolean
  onClick?: () => void
}) {
  const interactive = Boolean(onClick)
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group rounded-xl border bg-card px-3 py-2.5 text-left shadow-2xs transition-all',
        interactive && 'cursor-pointer hover:border-foreground/20 hover:shadow-xs',
        active &&
          (accent === 'emerald'
            ? 'border-emerald-500/45 bg-emerald-500/[0.04] ring-1 ring-emerald-500/20'
            : accent === 'amber'
              ? 'border-amber-500/45 bg-amber-500/[0.04] ring-1 ring-amber-500/20'
              : 'border-foreground/25 ring-1 ring-foreground/10'),
      )}
    >
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        {accent === 'emerald' && <span className="size-1.5 rounded-full bg-emerald-500" />}
        {accent === 'amber' && <span className="size-1.5 rounded-full bg-amber-500" />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <NumberPopIn value={value} className="text-[20px] leading-none font-semibold tracking-tight" />
        <span className="text-[10.5px] text-muted-foreground tabular-nums">{unit}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[10.5px] text-muted-foreground/90">{hint}</span>
      </div>
    </Tag>
  )
}

function StageChip({
  active,
  onClick,
  label,
  dotClass,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  dotClass?: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors',
        active
          ? 'bg-foreground text-background shadow-2xs'
          : 'bg-transparent text-muted-foreground hover:bg-card hover:text-foreground',
      )}
    >
      {dotClass && <span className={cn('size-1.5 rounded-full', active ? 'bg-background/80' : dotClass)} />}
      <span>{label}</span>
      <span className={cn('text-[10px] tabular-nums', active ? 'text-background/75' : 'text-muted-foreground/80')}>
        {count}
      </span>
    </button>
  )
}

function QuickChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7.5 items-center gap-1 rounded-lg border px-2 text-[11.5px] font-medium transition-colors',
        active
          ? 'border-foreground/30 bg-foreground text-background shadow-2xs'
          : 'border-border bg-card text-muted-foreground shadow-2xs hover:border-foreground/20 hover:text-foreground',
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  )
}

export function CandidateRow({
  candidate,
  pipeline,
  active,
  onSelect,
}: {
  candidate: Candidate
  pipeline: Pipeline | null
  active: boolean
  onSelect: () => void
}) {
  const avatar = avatarUrl(candidate)
  const tier = tierBadge(candidate.score, candidate.tier)
  const posLabel = positionShortLabel(candidate, pipeline)
  const srcMeta = SOURCE_META[normalizeSource(candidate.source)]
  const hasUnread = (candidate.unread ?? 0) > 0
  const hasLocalPdf = Boolean(candidate.resumePdfFile || candidate.evalPdfPath)
  const hasLocalOnline = Boolean(candidate.onlineResumeFile)
  const profileLine = factsLine(candidate)
  const verdict = conciseVerdict(candidate)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex w-full flex-col gap-2 rounded-xl border px-3 py-2.5 text-left transition-all',
        active
          ? 'border-foreground/30 bg-card shadow-xs ring-1 ring-foreground/8'
          : 'border-border/80 bg-card/85 hover:border-foreground/18 hover:bg-card hover:shadow-2xs',
      )}
    >
      {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full bg-foreground" />}

      {/* 上半区：个人信息 + 状态栏（双标签：岗位标签 + 来源标签） + 匹配分 */}
      <div className="flex w-full items-start gap-2.5">
        <div className="relative shrink-0 pt-0.5">
          <Avatar className="size-9 rounded-lg">
            {avatar && <AvatarImage src={avatar} alt={candidate.name} className="object-cover" />}
            <AvatarFallback
              className="rounded-lg text-[12px] font-medium text-white"
              style={{ backgroundColor: tintFor(candidate.name) }}
            >
              {initials(candidate.name)}
            </AvatarFallback>
          </Avatar>
          {hasUnread && (
            <span
              title={`未读 ${candidate.unread} 条`}
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
            />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-tight">{candidate.name}</span>
            {tier && (
              <span className={cn('rounded px-1 py-0.2 text-[9.5px] leading-tight font-semibold', tier.className)}>
                {tier.label}
              </span>
            )}
            <Badge className={cn('h-4.5 rounded px-1.5 text-[10px] font-normal', STAGE_CLASS[candidate.stage])}>
              {STAGE_LABEL[candidate.stage]}
            </Badge>
            <Badge variant="outline" className="h-4.5 gap-0.5 rounded px-1.5 text-[10px] font-normal text-foreground/80">
              <Briefcase className="size-2.5 text-muted-foreground" />
              {posLabel}
            </Badge>
            <Badge variant="outline" className={cn('h-4.5 rounded px-1.5 text-[10px] font-normal', srcMeta.className)}>
              {srcMeta.label}
            </Badge>
            {candidate.activeStatus && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {candidate.activeStatus}
              </span>
            )}
            {hasLocalPdf && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600 dark:text-rose-400">
                <FileText className="size-2.5" />
                PDF
              </span>
            )}
            {hasLocalOnline && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                <Globe className="size-2.5" />
                在线简历
              </span>
            )}
            {candidate.evalId && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 dark:text-indigo-400">
                <Sparkles className="size-2.5" />
                有评估
              </span>
            )}
            {candidate.hasResumeImage && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                <ImageIcon className="size-2.5" />
                附图
              </span>
            )}
          </div>

          <div className="truncate text-[11.5px] text-muted-foreground">{profileLine || '基础信息待补充'}</div>
        </div>

        <div className="flex min-w-[46px] shrink-0 flex-col items-end justify-between self-stretch py-0.5">
          <div
            className={cn(
              'text-[18px] leading-none font-semibold tracking-tight tabular-nums',
              scoreClass(candidate.score),
            )}
          >
            {candidate.score ?? '—'}
          </div>
          <div className="text-[10px] text-muted-foreground/80 tabular-nums">
            {candidate.lastTime || candidate.activeStatus || '未联系'}
          </div>
        </div>
      </div>

      {/* 下半区：AI 精简综合研判 */}
      {verdict && (
        <div className="flex w-full items-start gap-1.5 border-t border-border/55 pt-1.5">
          {verdict.isFallbackMessage ? (
            <MessageSquare className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
          ) : (
            <Sparkles className="mt-0.5 size-3 shrink-0 text-indigo-500/80 dark:text-indigo-400/80" />
          )}
          <div className="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-[1.45] text-foreground/80">
            {verdict.tag && (
              <span
                className={cn(
                  'mr-1.5 inline-block rounded px-1.5 py-0.2 align-baseline text-[10px] font-medium',
                  verdict.tone === 'strong'
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : verdict.tone === 'good'
                      ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {verdict.tag}
              </span>
            )}
            <span className={verdict.isFallbackMessage ? 'text-muted-foreground' : undefined}>{verdict.text}</span>
          </div>
        </div>
      )}
    </button>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-4 gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-[74px] animate-pulse rounded-xl bg-muted/70" />
      ))}
    </div>
  )
}
