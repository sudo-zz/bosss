import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  ArrowDownUp,
  Briefcase,
  Columns3,
  Crown,
  DownloadCloud,
  FileText,
  Flame,
  Globe,
  Hand,
  ImageIcon,
  Inbox,
  List,
  Loader2,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
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
    quota,
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
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)

  const candidates = pipeline?.candidates ?? EMPTY_CANDIDATES

  // 按岗位先做一次切片，便于展示该岗位下各来源（消息列表 / 推荐牛人 / 精选牛人）的精确统计
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

  // 当前来源（+岗位）切片，用于动态计算阶段统计与 KPI
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

  if (loading && !pipeline) {
    return <ListSkeleton />
  }

  const stats = pipeline?.stats
  const sendQuota = quota?.quotas?.send ?? pipeline?.stats.quota?.quotas?.send
  const greetQuota = quota?.quotas?.greet ?? pipeline?.stats.quota?.quotas?.greet
  const isSourcingView = sourceFilter === 'recommend' || sourceFilter === 'featured'
  const reached =
    (stageCounts.greeted || 0) + (stageCounts.replied || 0) + (stageCounts.interview || 0)
  const awaiting = (stageCounts.greeted || 0) + (stageCounts.shortlisted || 0)
  const hasActiveFilter =
    sourceFilter !== 'all' || stage !== 'all' || quickFilter !== 'all' || position !== 'all' || Boolean(query.trim())
  const quickFilters = quickFiltersForSource(sourceFilter)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部 KPI 统计卡（随来源与岗位实时联动） */}
      <div className="grid shrink-0 grid-cols-2 gap-2.5 px-4 pt-3.5 sm:grid-cols-4">
        <StatCard
          label={sourceFilter === 'all' ? '在库候选人' : `${SOURCE_META[sourceFilter].label}`}
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
            hint={`在线/刚活跃可优先打招呼`}
            accent="emerald"
            active={quickFilter === 'not_greeted'}
            onClick={() => setQuickFilter('not_greeted')}
          />
        ) : (
          <StatCard
            label="高分待触达"
            value={highUncontactedCount}
            unit="人"
            hint="≥70分 · 优先发消息"
            accent="emerald"
            active={quickFilter === 'high_uncontacted'}
            onClick={() => setQuickFilter('high_uncontacted')}
          />
        )}
        <StatCard
          label="已触达 / 跟进"
          value={reached}
          unit="人"
          hint={`待回复 ${awaiting} 人 · 今日新增 +${stats?.todayNew ?? 0}`}
          accent="amber"
          active={quickFilter === 'awaiting_reply'}
          onClick={() => setQuickFilter('awaiting_reply')}
        />
        {isSourcingView ? (
          <StatCard
            label="今日打招呼额度"
            value={greetQuota?.used ?? 0}
            unit={`/ ${greetQuota?.limit ?? 20}`}
            hint="推荐 / 精选牛人受控确认"
            progress={greetQuota ? Math.min(100, (greetQuota.used / Math.max(1, greetQuota.limit)) * 100) : 0}
          />
        ) : (
          <StatCard
            label="今日发送额度"
            value={sendQuota?.used ?? 0}
            unit={`/ ${sendQuota?.limit ?? 40}`}
            hint={pipeline?.stats.quota?.mode?.includes('dry') ? '受控确认模式' : '已确认发送'}
            progress={sendQuota ? Math.min(100, (sendQuota.used / Math.max(1, sendQuota.limit)) * 100) : 0}
          />
        )}
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

        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => setSyncDialogOpen(true)}
          className="ml-auto h-7.5 gap-1.5 border-primary/25 bg-primary/[0.04] px-2.5 text-[11.5px] font-medium text-primary hover:bg-primary/10"
        >
          <DownloadCloud className="size-3.5" />
          拉取推荐 / 精选
        </Button>
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
            <ScrollArea className="h-full">
              <div className="space-y-1.5 px-4 pb-4">
                {list.length === 0 ? (
                  <Empty className="border border-dashed bg-card/70">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SearchX />
                      </EmptyMedia>
                      <EmptyTitle>
                        {isSourcingView && sourceScoped.length === 0
                          ? `暂无「${SOURCE_META[sourceFilter].label}」记录`
                          : '没有符合条件的候选人'}
                      </EmptyTitle>
                      <EmptyDescription>
                        {isSourcingView && sourceScoped.length === 0
                          ? `点击上方「拉取推荐 / 精选」通过本机 Safari 拉取 Boss ${SOURCE_META[sourceFilter].label} 列表并自动打上岗位与来源标签。`
                          : '尝试切换来源、阶段、关闭快捷筛选或清空搜索关键词。'}
                      </EmptyDescription>
                    </EmptyHeader>
                    <div className="flex items-center gap-2">
                      {isSourcingView && sourceScoped.length === 0 && (
                        <Button size="sm" onClick={() => setSyncDialogOpen(true)} className="gap-1.5">
                          <DownloadCloud className="size-3.5" />
                          立即拉取{SOURCE_META[sourceFilter].label}
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
          <span className="ml-2 hidden text-[10px] text-muted-foreground/75 xl:inline">
            ↑↓ 切人 · S 短名单 · M 发消息
          </span>
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? 'size-3 animate-spin' : 'size-3'} />
          {refreshing ? '同步中' : '同步台账'}
        </Button>
      </div>

      <SourcingSyncDialog
        key={`${sourceFilter}-${position}-${syncDialogOpen ? '1' : '0'}`}
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        defaultTab={sourceFilter === 'featured' ? 'featured' : 'recommend'}
        defaultJob={
          position !== 'all'
            ? pipeline?.meta.positions.find((p) => p.id === position)?.short || ''
            : ''
        }
        positions={pipeline?.meta.positions || []}
      />
    </div>
  )
}

function SourcingSyncDialog({
  open,
  onOpenChange,
  defaultTab,
  defaultJob,
  positions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab: 'recommend' | 'featured'
  defaultJob: string
  positions: { id: string; name: string; short: string }[]
}) {
  const { syncSourcing, syncingSourcing } = useDesk()
  const [tab, setTab] = useState<'recommend' | 'featured'>(defaultTab)
  const [job, setJob] = useState(defaultJob)
  const [limit, setLimit] = useState(20)
  const [skipViewed, setSkipViewed] = useState(true)
  const [skipColleague, setSkipColleague] = useState(true)

  const handleSync = async () => {
    try {
      const res = await syncSourcing({
        tab,
        job: job.trim() || undefined,
        limit,
        skipViewed,
        skipColleague,
      })
      toast.success(`已拉取 ${res.count} 位「${SOURCE_META[res.tab].label}」候选人`, {
        description: `${res.job ? `岗位：${res.job} · ` : ''}已自动写入台账并打上岗位标签 + 来源标签`,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message || '拉取失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <DownloadCloud className="size-4 text-primary" />
            从 Boss 拉取推荐 / 精选牛人
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            通过本机 Safari 读取「推荐牛人」中的「推荐」或「精选」列表（不含「最新」），并按所选岗位自动入库打标。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label className="text-[11.5px] font-medium text-foreground">拉取来源（二选一）</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTab('recommend')}
                disabled={syncingSourcing}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all',
                  tab === 'recommend'
                    ? 'border-violet-500/50 bg-violet-500/8 ring-1 ring-violet-500/20'
                    : 'border-border bg-card hover:border-foreground/20',
                )}
              >
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <UserPlus className="size-3.5 text-violet-600 dark:text-violet-400" />
                  推荐牛人
                </span>
                <span className="text-[11px] text-muted-foreground">Boss「推荐」默认算法推荐池</span>
              </button>

              <button
                type="button"
                onClick={() => setTab('featured')}
                disabled={syncingSourcing}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all',
                  tab === 'featured'
                    ? 'border-amber-500/50 bg-amber-500/8 ring-1 ring-amber-500/20'
                    : 'border-border bg-card hover:border-foreground/20',
                )}
              >
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <Crown className="size-3.5 text-amber-600 dark:text-amber-400" />
                  精选牛人
                </span>
                <span className="text-[11px] text-muted-foreground">Boss「精选」高匹配严选池</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11.5px] font-medium text-foreground">目标岗位（将切换 Boss 岗位下拉并打岗位标签）</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={syncingSourcing}
                onClick={() => setJob('')}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  !job
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
              >
                保持 Safari 当前岗位
              </button>
              {positions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={syncingSourcing}
                  onClick={() => setJob(p.short)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    job === p.short
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.short}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={job}
              onChange={(e) => setJob(e.target.value)}
              disabled={syncingSourcing}
              placeholder="也可直接输入岗位关键词，如：新媒体运营 / AI应用开发"
              className="mt-1 h-8 w-full rounded-lg border bg-background px-2.5 text-[12px] outline-none focus:border-foreground/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11.5px] font-medium text-foreground">本次拉取数量</label>
              <div className="flex gap-1.5">
                {[10, 20, 30].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={syncingSourcing}
                    onClick={() => setLimit(n)}
                    className={cn(
                      'flex-1 rounded-lg border py-1.5 text-[11.5px] font-medium tabular-nums transition-colors',
                      limit === n
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {n} 人
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11.5px] font-medium text-foreground">过滤规则</label>
              <div className="space-y-1.5 pt-0.5 text-[11.5px] text-muted-foreground">
                <label className="flex cursor-pointer items-center gap-1.5 select-none">
                  <input
                    type="checkbox"
                    checked={skipViewed}
                    disabled={syncingSourcing}
                    onChange={(e) => setSkipViewed(e.target.checked)}
                    className="size-3.5 rounded accent-foreground"
                  />
                  跳过已看过
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 select-none">
                  <input
                    type="checkbox"
                    checked={skipColleague}
                    disabled={syncingSourcing}
                    onChange={(e) => setSkipColleague(e.target.checked)}
                    className="size-3.5 rounded accent-foreground"
                  />
                  跳过同事已沟通
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={syncingSourcing}>
            取消
          </Button>
          <Button onClick={() => void handleSync()} disabled={syncingSourcing} className="gap-1.5">
            {syncingSourcing ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
            {syncingSourcing ? '正在读取本机 Safari…' : `开始拉取${SOURCE_META[tab].label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  progress,
  accent,
  active,
  onClick,
}: {
  label: string
  value: number
  unit: string
  hint: string
  progress?: number
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
        {typeof progress === 'number' && <Progress value={progress} className="h-1 w-11 shrink-0" />}
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
            {/* 岗位标签 */}
            <Badge variant="outline" className="h-4.5 gap-0.5 rounded px-1.5 text-[10px] font-normal text-foreground/80">
              <Briefcase className="size-2.5 text-muted-foreground" />
              {posLabel}
            </Badge>
            {/* 来源标签 */}
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

        <div className="flex shrink-0 flex-col items-end justify-between self-stretch py-0.5">
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
