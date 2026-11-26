import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Check,
  Copy,
  FileText,
  Globe,
  GraduationCap,
  ImageIcon,
  MapPin,
  Sparkles,
  UserRound,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'

import { PanelSwap } from '@/components/motion/effects'
import { ResumeViewerDialog, type ResumeViewerTab } from '@/components/resume/resume-viewer-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  PIPELINE_STEPS,
  SOURCE_META,
  STAGE_CLASS,
  STAGE_LABEL,
  avatarUrl,
  dimEntries,
  initials,
  normalizeSource,
  positionShortLabel,
  resolvedFacts,
  scoreClass,
  tierBadge,
  tintFor,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDesk } from '@/store/desk'
import type { Candidate } from '@/types'
import { TechStack } from './tech-stack'

export function CandidateDetail({ candidate }: { candidate: Candidate | null }) {
  const { pipeline, setModule, selectEval } = useDesk()
  const [resumeOpen, setResumeOpen] = useState(false)
  const [resumeTab, setResumeTab] = useState<ResumeViewerTab>('pdf')
  const [copiedSummary, setCopiedSummary] = useState(false)

  if (!candidate) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserRound />
          </EmptyMedia>
          <EmptyTitle>还没有选中候选人</EmptyTitle>
          <EmptyDescription>在左侧列表点选候选人（或按 ↑ / ↓ 方向键），档案、PDF 简历与在线简历都会在此展开。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const avatar = avatarUrl(candidate)
  const tier = tierBadge(candidate.score, candidate.tier)
  const dims = dimEntries(candidate)
  const facts = resolvedFacts(candidate)
  const stackText = [
    candidate.summary,
    facts.latestWork,
    ...(candidate.highlights || []),
    ...(candidate.messages || []).slice(0, 4).map((m) => m.text),
  ]
    .filter(Boolean)
    .join(' ')
  const isRejected = candidate.stage === 'rejected'
  const evalExists = Boolean(candidate.evalId)
  const currentStepIdx = PIPELINE_STEPS.indexOf(candidate.stage)
  const sourceKey = normalizeSource(candidate.source)
  const sourceMeta = SOURCE_META[sourceKey]
  const posLabel = positionShortLabel(candidate, pipeline)
  const localPdfFile = candidate.resumePdfFile || candidate.evalPdfPath || null
  const hasLocalOnline = Boolean(candidate.onlineResumeFile)

  const openResumeViewer = (tab: ResumeViewerTab) => {
    setResumeTab(tab)
    setResumeOpen(true)
  }

  const copyForAgent = async () => {
    const snippet = [
      `候选人：${candidate.name}${typeof candidate.score === 'number' ? `（${candidate.score}分）` : ''}`,
      `岗位：${candidate.job}｜来源：${sourceMeta.label}｜阶段：${STAGE_LABEL[candidate.stage]}`,
      candidate.geekId ? `geekId：${candidate.geekId}` : '',
      `基础画像：${[facts.age, facts.exp, facts.edu, facts.city, facts.salary, facts.latestWork].filter(Boolean).join(' · ') || '待补充'}`,
      candidate.reason ? `综合研判：${candidate.reason}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(snippet)
      setCopiedSummary(true)
      toast.success(`已复制「${candidate.name}」档案摘要`, { description: '可直接粘贴给左侧 Agent（如 WorkBuddy）继续操作' })
      setTimeout(() => setCopiedSummary(false), 1800)
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <PanelSwap id={candidate.id}>
      <div className="shrink-0 border-b bg-background px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <Avatar className="size-12 rounded-xl border">
            {avatar && <AvatarImage src={avatar} alt={candidate.name} className="object-cover" />}
            <AvatarFallback
              className="rounded-xl text-[15px] font-medium text-white"
              style={{ backgroundColor: tintFor(candidate.name) }}
            >
              {initials(candidate.name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-[15.5px] font-semibold tracking-tight">{candidate.name}</h2>
              {tier && (
                <span className={cn('rounded px-1.5 py-0.2 text-[10px] font-semibold', tier.className)}>
                  {tier.label}级
                </span>
              )}
              <Badge className={cn('h-4.5 rounded px-1.5 text-[10px] font-normal', STAGE_CLASS[candidate.stage])}>
                {STAGE_LABEL[candidate.stage]}
              </Badge>
              <Badge variant="outline" className="h-4.5 gap-0.5 rounded px-1.5 text-[10px] font-normal text-foreground/80">
                <Briefcase className="size-2.5 text-muted-foreground" />
                {posLabel}
              </Badge>
              <Badge variant="outline" className={cn('h-4.5 rounded px-1.5 text-[10px] font-normal', sourceMeta.className)}>
                {sourceMeta.label}
              </Badge>
              {candidate.activeStatus && (
                <Badge
                  variant="outline"
                  className="h-4.5 gap-1 rounded border-emerald-500/30 bg-emerald-500/8 px-1.5 text-[10px] font-normal text-emerald-700 dark:text-emerald-300"
                >
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {candidate.activeStatus}
                </Badge>
              )}
              {candidate.hasResumeImage && (
                <Badge
                  variant="outline"
                  className="h-4.5 gap-0.5 rounded border-emerald-500/30 px-1.5 text-[10px] font-normal text-emerald-700 dark:text-emerald-300"
                >
                  <ImageIcon className="size-2.5" />
                  含图片简历
                </Badge>
              )}
            </div>
            <div className="mt-1 truncate text-[12px] text-muted-foreground">{facts.latestWork || candidate.job}</div>
          </div>

          <div className="rounded-xl border bg-muted/35 px-2.5 py-1.5 text-right">
            <div
              className={cn(
                'text-[22px] leading-none font-semibold tracking-tight tabular-nums',
                scoreClass(candidate.score),
              )}
            >
              {candidate.score ?? '—'}
            </div>
            <div className="mt-0.5 text-[9.5px] text-muted-foreground">匹配分</div>
          </div>
        </div>

        {/* 只读阶段进度条 */}
        {!isRejected && (
          <div className="mt-3 grid grid-cols-6 gap-1">
            {PIPELINE_STEPS.map((step, index) => {
              const reached = currentStepIdx >= index
              const isCurrent = candidate.stage === step
              return (
                <div
                  key={step}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md py-1',
                    isCurrent && 'bg-foreground/6',
                  )}
                >
                  <span
                    className={cn(
                      'h-1 w-full rounded-full',
                      isCurrent ? 'bg-foreground' : reached ? 'bg-foreground/35' : 'bg-border',
                    )}
                  />
                  <span
                    className={cn(
                      'truncate text-[9.5px] leading-none',
                      isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {STAGE_LABEL[step].replace('通过', '').replace('进', '').replace('已', '')}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 纯只读本地查看按钮栏 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={localPdfFile ? 'default' : 'outline'}
            onClick={() => openResumeViewer('pdf')}
            className="gap-1.5"
          >
            <FileText className={cn('size-3.5', !localPdfFile && 'text-muted-foreground')} />
            {localPdfFile ? '查看 PDF 简历' : 'PDF 简历（未归档）'}
          </Button>
          <Button
            size="sm"
            variant={hasLocalOnline ? 'secondary' : 'outline'}
            onClick={() => openResumeViewer('online')}
            className="gap-1.5"
          >
            <Globe className={cn('size-3.5', hasLocalOnline && 'text-emerald-600 dark:text-emerald-400')} />
            {hasLocalOnline ? 'Boss 在线简历' : '在线简历（未转存）'}
          </Button>
          {evalExists && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                selectEval(candidate.evalId!)
                setModule('assess')
              }}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5 text-indigo-500" />
              面试评估
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void copyForAgent()} className="ml-auto gap-1.5 text-muted-foreground">
            {copiedSummary ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
            {copiedSummary ? '已复制' : '复制给 Agent'}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-4 pb-6">
          <section className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border bg-muted/25 p-3">
            <Fact icon={UserRound} label="年龄 / 年限" value={[facts.age, facts.exp].filter(Boolean).join(' / ')} />
            <Fact icon={GraduationCap} label="学历" value={facts.edu} />
            <Fact icon={MapPin} label="期望城市" value={facts.city} />
            <Fact icon={Wallet} label="期望薪资" value={facts.salary} />
            <Fact
              icon={Briefcase}
              label="目标岗位"
              value={pipeline?.meta.positions.find((p) => p.id === candidate.positionId)?.name || candidate.job}
            />
            <Fact icon={Building2} label="最近经历" value={facts.latestWork} />
            {facts.school && (
              <div className="col-span-2">
                <Fact icon={GraduationCap} label="院校 / 专业" value={facts.school} />
              </div>
            )}
          </section>

          <TechStack text={stackText} />

          {dims.length > 0 && (
            <section>
              <SectionTitle>评分维度拆解</SectionTitle>
              <div className="mt-2 space-y-2 rounded-xl border bg-card p-3">
                {dims.map((dim) => (
                  <div key={dim.key} className="grid grid-cols-[72px_minmax(0,1fr)_48px] items-center gap-2.5">
                    <span className="truncate text-[11px] text-muted-foreground">{dim.label}</span>
                    <Progress value={(dim.value / dim.max) * 100} className="h-1.5" />
                    <span className="text-right text-[11px] font-medium tabular-nums">
                      {dim.value}
                      <span className="font-normal text-muted-foreground/60">/{dim.max}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {candidate.reason && (
            <section>
              <SectionTitle>综合研判</SectionTitle>
              <p className="mt-1.5 rounded-xl border bg-muted/25 px-3 py-2 text-[12px] leading-relaxed text-foreground/85">
                {candidate.reason}
              </p>
            </section>
          )}

          {(!!candidate.highlights?.length || !!candidate.risks?.length) && (
            <div className="grid gap-2.5">
              {!!candidate.highlights?.length && (
                <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                  <SectionTitle className="text-emerald-700 dark:text-emerald-400">核心亮点</SectionTitle>
                  <ul className="mt-1.5 space-y-1">
                    {candidate.highlights.map((item) => (
                      <li key={item} className="flex gap-1.5 text-[11.5px] leading-relaxed text-foreground/85">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-emerald-500" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!!candidate.risks?.length && (
                <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
                  <SectionTitle className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3" />
                    需提前确认
                  </SectionTitle>
                  <ul className="mt-1.5 space-y-1">
                    {candidate.risks.map((item) => (
                      <li key={item} className="flex gap-1.5 text-[11.5px] leading-relaxed text-foreground/85">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          <Separator />

          <section>
            <div className="flex items-center justify-between">
              <SectionTitle>沟通记录</SectionTitle>
              <span className="text-[10.5px] text-muted-foreground tabular-nums">
                {(candidate.messages || []).length} 条
              </span>
            </div>
            <div className="mt-2.5 space-y-2">
              <AnimatePresence initial={false}>
                {(candidate.messages || []).map((message, index) => (
                  <motion.div
                    key={`${index}-${message.time || ''}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                    className={cn(
                      'flex',
                      message.from === 'myself'
                        ? 'justify-end'
                        : message.from === 'system'
                          ? 'justify-center'
                          : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[88%] rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap',
                        message.from === 'myself'
                          ? 'rounded-br-sm bg-primary text-primary-foreground'
                          : message.from === 'system'
                            ? 'bg-transparent px-0 py-0.5 text-center text-[10.5px] text-muted-foreground/80'
                            : 'rounded-bl-sm border bg-muted/45 text-foreground',
                      )}
                    >
                      {message.text}
                      {message.time && message.from !== 'system' && (
                        <div
                          className={cn(
                            'mt-0.5 text-[9.5px] tabular-nums',
                            message.from === 'myself' ? 'text-primary-foreground/65' : 'text-muted-foreground/70',
                          )}
                        >
                          {message.time}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {!candidate.messages?.length && (
                <p className="rounded-lg border border-dashed py-4 text-center text-[11.5px] text-muted-foreground">
                  暂无历史聊天记录（可通过左侧 Agent 调用 boss CLI 发起沟通或读取最新对话）。
                </p>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-muted/25 px-4 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
        只读展示模式：需要发消息、打招呼、改阶段或拉取在线简历时，直接在左侧 Agent 对话框下达指令即可自动同步。
      </div>

      <ResumeViewerDialog
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        initialTab={resumeTab}
        candidateName={candidate.name}
        job={candidate.job}
        source={sourceKey}
        pdfFile={localPdfFile}
        onlineResumeFile={candidate.onlineResumeFile}
      />
    </PanelSwap>
  )
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="size-2.5" />
        {label}
      </div>
      <div className="mt-0.5 truncate text-[11.5px] font-medium text-foreground/90" title={value || ''}>
        {value || '—'}
      </div>
    </div>
  )
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase', className)}>
      {children}
    </h3>
  )
}
