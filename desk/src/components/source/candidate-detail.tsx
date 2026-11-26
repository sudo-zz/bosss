import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  Bot,
  Briefcase,
  Building2,
  Check,
  FileText,
  Globe,
  GraduationCap,
  Hand,
  ImageIcon,
  Loader2,
  MapPin,
  MessageSquarePlus,
  MoreHorizontal,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  UserRound,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'

import { PanelSwap } from '@/components/motion/effects'
import { ResumeViewerDialog, type ResumeViewerTab } from '@/components/resume/resume-viewer-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { AssistantCandidateContext } from '@/lib/api'
import {
  MESSAGE_TEMPLATES,
  PIPELINE_STEPS,
  SOURCE_META,
  STAGE_CLASS,
  STAGE_LABEL,
  avatarUrl,
  resolvedFacts,
  dimEntries,
  greetingTemplate,
  initials,
  normalizeSource,
  positionShortLabel,
  scoreClass,
  tierBadge,
  tintFor,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChat } from '@/store/chat'
import { useDesk } from '@/store/desk'
import type { Candidate, Stage } from '@/types'
import { TechStack } from './tech-stack'

export function CandidateDetail({ candidate }: { candidate: Candidate | null }) {
  const {
    pipeline,
    quota,
    moveStage,
    greetCandidate,
    setModule,
    selectEval,
    toggleAssistant,
    sendDialogOpen,
    setSendDialogOpen,
  } = useDesk()
  const askAssistant = useChat((s) => s.send)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [greetOpen, setGreetOpen] = useState(false)
  const [greetingBusy, setGreetingBusy] = useState(false)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [resumeTab, setResumeTab] = useState<ResumeViewerTab>('pdf')

  if (!candidate) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserRound />
          </EmptyMedia>
          <EmptyTitle>还没有选中候选人</EmptyTitle>
          <EmptyDescription>在左侧列表点选候选人（或按 ↑ / ↓ 方向键），资料、对话与推进动作都会在此展开。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const avatar = avatarUrl(candidate)
  const tier = tierBadge(candidate.score, candidate.tier)
  const dims = dimEntries(candidate)
  const stackText = [
    candidate.summary,
    candidate.facts?.latestWork,
    ...(candidate.highlights || []),
    ...(candidate.messages || []).slice(0, 4).map((m) => m.text),
  ]
    .filter(Boolean)
    .join(' ')
  const sendQuota = quota?.quotas?.send ?? pipeline?.stats.quota?.quotas?.send
  const remaining = sendQuota ? Math.max(0, sendQuota.limit - sendQuota.used) : null
  const greetQuota = quota?.quotas?.greet ?? pipeline?.stats.quota?.quotas?.greet
  const greetRemaining = greetQuota ? Math.max(0, greetQuota.limit - greetQuota.used) : null
  const isRejected = candidate.stage === 'rejected'
  const evalExists = Boolean(candidate.evalId)
  const currentStepIdx = PIPELINE_STEPS.indexOf(candidate.stage)
  const sourceKey = normalizeSource(candidate.source)
  const sourceMeta = SOURCE_META[sourceKey]
  const posLabel = positionShortLabel(candidate, pipeline)
  const localPdfFile = candidate.resumePdfFile || candidate.evalPdfPath || null
  const hasLocalOnline = Boolean(candidate.onlineResumeFile)
  const isSourcingCandidate = sourceKey === 'recommend' || sourceKey === 'featured'
  const showPrimaryGreet =
    isSourcingCandidate && candidate.canGreet !== false && ['new', 'screened', 'shortlisted'].includes(candidate.stage)

  const openResumeViewer = (tab: ResumeViewerTab) => {
    setResumeTab(tab)
    setResumeOpen(true)
  }

  const handleConfirmGreet = async () => {
    setGreetingBusy(true)
    try {
      await greetCandidate(candidate)
      toast.success(`已向 ${candidate.name} 打招呼`, {
        description: `来源：${sourceMeta.label} · 已更新本地台账`,
      })
      setGreetOpen(false)
    } catch (error) {
      toast.error((error as Error).message || '打招呼失败')
    } finally {
      setGreetingBusy(false)
    }
  }

  const changeStage = async (stage: Stage) => {
    try {
      const previous = await moveStage(candidate, stage)
      toast.success(`${candidate.name} → ${STAGE_LABEL[stage]}`, {
        action: { label: '撤销', onClick: () => void moveStage(candidate, previous) },
      })
    } catch (error) {
      toast.error((error as Error).message || '改阶段失败')
    }
  }

  const analyzeWithAssistant = () => {
    toggleAssistant(true)
    const ctx: AssistantCandidateContext = {
      kind: 'source',
      name: candidate.name,
      job: candidate.job,
      stage: STAGE_LABEL[candidate.stage] || candidate.stage,
      score: candidate.score,
      summary: candidate.reason || candidate.summary,
      facts: candidate.facts,
      highlights: candidate.highlights,
      risks: candidate.risks,
      lastMessages: (candidate.messages || []).slice(-4).map((m) => `[${m.from}] ${m.text}`),
    }
    void askAssistant(`深度评估候选人「${candidate.name}」的岗位匹配度、核心风险，并给出一句沟通切入点。`, ctx)
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
            <div className="mt-1 truncate text-[12px] text-muted-foreground">
              {candidate.facts?.latestWork || candidate.job}
            </div>
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

        {/* 漏斗推进条：一眼看清当前所处阶段，点击直接流转 */}
        {!isRejected && (
          <div className="mt-3 grid grid-cols-6 gap-1">
            {PIPELINE_STEPS.map((step, index) => {
              const reached = currentStepIdx >= index
              const isCurrent = candidate.stage === step
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => void changeStage(step)}
                  className={cn(
                    'group flex flex-col items-center gap-1 rounded-md py-1 transition-colors',
                    isCurrent ? 'bg-foreground/7' : 'hover:bg-muted/70',
                  )}
                  title={`调整为：${STAGE_LABEL[step]}`}
                >
                  <span
                    className={cn(
                      'h-1 w-full rounded-full transition-colors',
                      isCurrent
                        ? 'bg-foreground'
                        : reached
                          ? 'bg-foreground/35'
                          : 'bg-border group-hover:bg-foreground/20',
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
                </button>
              )
            })}
          </div>
        )}

        {candidate.inferredStage && candidate.inferredStage !== candidate.stage && (
          <button
            type="button"
            onClick={() => void changeStage(candidate.inferredStage as Stage)}
            className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-sky-500/25 bg-sky-500/8 px-2.5 py-1.5 text-[11px] text-sky-700 transition-colors hover:bg-sky-500/12 dark:text-sky-300"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3 shrink-0" />
              对话内容显示像是「{STAGE_LABEL[candidate.inferredStage]}」
            </span>
            <span className="font-medium underline underline-offset-2">一键同步</span>
          </button>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {!isRejected && showPrimaryGreet && (
            <Button size="sm" onClick={() => setGreetOpen(true)} className="flex-1 gap-1.5 shadow-2xs">
              <Hand className="size-3.5" />
              打招呼
              {greetRemaining !== null && (
                <span className="text-[10.5px] opacity-75 tabular-nums">剩 {greetRemaining}</span>
              )}
            </Button>
          )}
          {!isRejected && (
            <Button
              size="sm"
              variant={showPrimaryGreet ? 'outline' : 'default'}
              onClick={() => setSendDialogOpen(true)}
              className={cn('gap-1.5', !showPrimaryGreet && 'flex-1 shadow-2xs')}
            >
              <Send className="size-3.5" />
              发消息
              {!showPrimaryGreet && remaining !== null && (
                <span className="text-[10.5px] opacity-75 tabular-nums">剩 {remaining}</span>
              )}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => openResumeViewer('pdf')} className="gap-1.5">
            <FileText className={cn('size-3.5', localPdfFile && 'text-rose-600 dark:text-rose-400')} />
            {localPdfFile ? 'PDF 简历' : '导入 PDF'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openResumeViewer('online')} className="gap-1.5">
            <Globe className={cn('size-3.5', hasLocalOnline && 'text-emerald-600 dark:text-emerald-400')} />
            {hasLocalOnline ? '在线简历' : '读在线简历'}
          </Button>
          <Button size="sm" variant="outline" onClick={analyzeWithAssistant} className="gap-1.5">
            <Bot className="size-3.5" />
            问助手
          </Button>
          {candidate.stage !== 'shortlisted' && !isRejected && (
            <Button size="sm" variant="outline" onClick={() => void changeStage('shortlisted')} className="gap-1">
              <MessageSquarePlus className="size-3.5" />
              短名单
            </Button>
          )}
          {isRejected && (
            <Button size="sm" variant="outline" onClick={() => void changeStage('shortlisted')} className="flex-1 gap-1.5">
              <Undo2 className="size-3.5" />
              恢复为短名单
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label="更多操作">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-42">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">调整阶段</DropdownMenuLabel>
              {(['screened', 'shortlisted', 'greeted', 'replied', 'interview', 'hold'] as Stage[]).map((st) => (
                <DropdownMenuItem
                  key={st}
                  className="text-[12px]"
                  disabled={candidate.stage === st}
                  onSelect={() => void changeStage(st)}
                >
                  <span className="flex-1">{STAGE_LABEL[st]}</span>
                  {candidate.stage === st && <Check className="size-3" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {evalExists && (
                <DropdownMenuItem
                  className="text-[12px]"
                  onSelect={() => {
                    selectEval(candidate.evalId!)
                    setModule('assess')
                  }}
                >
                  <Sparkles className="size-3.5" />
                  查看面试评估详情
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" className="text-[12px]" onSelect={() => setRejectOpen(true)}>
                <Trash2 className="size-3.5" />
                标记淘汰
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-4 pb-6">
          {(() => {
            const facts = resolvedFacts(candidate)
            return (
              <section className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border bg-muted/25 p-3">
                <Fact
                  icon={UserRound}
                  label="年龄 / 年限"
                  value={[facts.age, facts.exp].filter(Boolean).join(' / ')}
                />
                <Fact icon={GraduationCap} label="学历" value={facts.edu} />
                <Fact icon={MapPin} label="期望城市" value={facts.city} />
                <Fact icon={Wallet} label="期望薪资" value={facts.salary} />
                <Fact
                  icon={Briefcase}
                  label="沟通职位"
                  value={pipeline?.meta.positions.find((p) => p.id === candidate.positionId)?.name || candidate.job}
                />
                <Fact icon={Building2} label="最近经历" value={facts.latestWork} />
                {facts.school && (
                  <div className="col-span-2">
                    <Fact icon={GraduationCap} label="院校 / 专业" value={facts.school} />
                  </div>
                )}
              </section>
            )
          })()}

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
                  暂无历史消息，可点击上方「发消息」使用标准要简历话术。
                </p>
              )}
            </div>
          </section>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-muted/25 px-4 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
        {isRejected
          ? '已淘汰：不再出现在跟进队列，需要时可随时恢复。'
          : remaining === 0
            ? '今日发送额度已达上限，明天自动重置。'
            : '点击发送会切到本机 Safari 实时投递，发出后无法撤回（快捷键 M）。'}
      </div>

      <SendDialog
        key={candidate.id}
        open={sendDialogOpen}
        candidate={candidate}
        remaining={remaining}
        onOpenChange={setSendDialogOpen}
      />

      <ResumeViewerDialog
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        initialTab={resumeTab}
        candidateName={candidate.name}
        job={candidate.job}
        geekId={candidate.geekId}
        source={sourceKey}
        pdfFile={localPdfFile}
        onlineResumeFile={candidate.onlineResumeFile}
      />

      <AlertDialog open={greetOpen} onOpenChange={setGreetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>在「{sourceMeta.label}」向 {candidate.name} 打招呼？</AlertDialogTitle>
            <AlertDialogDescription>
              将通过本机 Safari 切换到「{sourceMeta.label}」并点击该候选人的「打招呼」按钮（今日打招呼剩余{' '}
              {greetRemaining ?? '—'} 次），发出后无法撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={greetingBusy}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmGreet()} disabled={greetingBusy || greetRemaining === 0}>
              {greetingBusy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {greetingBusy ? '正在通过 Safari 打招呼…' : '确认打招呼'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>标记淘汰 {candidate.name}？</AlertDialogTitle>
            <AlertDialogDescription>
              本地台账会更新为「已淘汰」并移出待跟进队列，不会自动给对方发拒绝消息；后续可随时恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void changeStage('rejected')}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              确认淘汰
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function SendDialog({
  open,
  candidate,
  remaining,
  onOpenChange,
}: {
  open: boolean
  candidate: Candidate
  remaining: number | null
  onOpenChange: (open: boolean) => void
}) {
  const sendMessage = useDesk((s) => s.sendMessage)
  const [activeTpl, setActiveTpl] = useState(MESSAGE_TEMPLATES[0]!.id)
  const [text, setText] = useState(() => greetingTemplate(candidate))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overLimit = remaining === 0

  const applyTemplate = (tplId: string) => {
    const found = MESSAGE_TEMPLATES.find((t) => t.id === tplId)
    if (!found) return
    setActiveTpl(found.id)
    setText(found.build(candidate))
  }

  const submit = async () => {
    if (!text.trim()) {
      setError('消息不能为空')
      return
    }
    setSending(true)
    setError(null)
    try {
      await sendMessage(candidate, text.trim())
      toast.success(`已发给 ${candidate.name}`, { description: '已通过本机 Safari 确认送达并更新台账。' })
      onOpenChange(false)
      setText(greetingTemplate(candidate))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>发送消息给 {candidate.name}</DialogTitle>
          <DialogDescription>
            {[candidate.job, candidate.facts?.city, candidate.facts?.salary || '薪资未标'].filter(Boolean).join(' · ')}
            {' · '}今日剩余 {remaining ?? '—'} 条
          </DialogDescription>
        </DialogHeader>

        {!!candidate.risks?.length && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>提醒：{candidate.risks.slice(0, 2).join('；')}</span>
          </div>
        )}

        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {MESSAGE_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                disabled={sending}
                onClick={() => applyTemplate(tpl.id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  activeTpl === tpl.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={6}
            className="resize-none text-[12.5px] leading-relaxed"
            disabled={sending}
          />

          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>发送会切到本机 Safari 并直接提交，发出后无法撤回。</span>
            <span className="tabular-nums">{text.length}/800</span>
          </div>
          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
          {overLimit && <p className="text-[11.5px] text-amber-600">今日发送额度已用完，明天再发。</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            取消
          </Button>
          <Button onClick={submit} disabled={sending || overLimit || !text.trim()}>
            {sending && <Loader2 className="size-3.5 animate-spin" />}
            {sending ? '正在通过 Safari 发送…' : '确认发送'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
