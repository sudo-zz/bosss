import { useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileText,
  Globe,
  GraduationCap,
  MapPin,
  Quote,
  Sparkles,
  Target,
  UserRound,
  Wallet,
} from 'lucide-react'

import { PanelSwap } from '@/components/motion/effects'
import { ResumeViewerDialog, type ResumeViewerTab } from '@/components/resume/resume-viewer-dialog'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { AssistantCandidateContext } from '@/lib/api'
import { avatarUrl, initials, resumeSrc, scoreClass, statusLabel, tintFor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChat } from '@/store/chat'
import { useDesk } from '@/store/desk'
import type { EvalCandidate } from '@/types'

export function EvalDetail({ candidate }: { candidate: EvalCandidate | null }) {
  const { evalData, pipeline, setModule, select, toggleAssistant } = useDesk()
  const askAssistant = useChat((s) => s.send)
  const [resumeOpen, setResumeOpen] = useState(false)
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerTab, setPdfViewerTab] = useState<ResumeViewerTab>('pdf')
  const [pdfPage, setPdfPage] = useState(1)
  const [brokenPages, setBrokenPages] = useState<Record<string, boolean>>({})

  if (!candidate) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>还没有选中评估</EmptyTitle>
          <EmptyDescription>在左侧排行榜点选候选人，简历分、面试记录、证据与风险都会在此展开。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const score = candidate.composite ?? candidate.score
  const position = evalData?.positions?.find((p) => p.id === candidate.positionId)
  const dims = position?.dims || []
  const linked = pipeline?.candidates.find((c) => c.name === candidate.name)
  const localPdfFile = linked?.resumePdfFile || candidate.pdf || null
  const avatar = linked ? avatarUrl(linked) : null
  const openEmbeddedResume = (tab: ResumeViewerTab, page = 1) => {
    setPdfViewerTab(tab)
    setPdfPage(page)
    setPdfViewerOpen(true)
  }
  const interview = candidate.interview
  const modules = Array.isArray(interview?.modules)
    ? (interview.modules as { title?: string; items?: string[]; tone?: string }[])
    : []

  const askEvalAssistant = () => {
    toggleAssistant(true)
    const ctx: AssistantCandidateContext = {
      kind: 'assess',
      name: candidate.name,
      job: position?.name || candidate.intent,
      stage: statusLabel(candidate.status),
      score,
      summary: candidate.tagline || candidate.current,
      facts: {
        age: candidate.age ? `${candidate.age}岁` : undefined,
        exp: candidate.years,
        edu: candidate.education,
        city: candidate.location,
        salary: candidate.salaryNote,
        school: [candidate.school, candidate.major].filter(Boolean).join(' · '),
        latestWork: candidate.current,
      },
      highlights: candidate.pros,
      risks: candidate.cons,
      questions: candidate.questions,
    }
    void askAssistant(`结合面试深度评估，总结「${candidate.name}」的录用/淘汰建议与下轮关键追问。`, ctx)
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
              <Badge
                className={cn(
                  'h-4.5 rounded px-1.5 text-[10px] font-normal',
                  candidate.status === 'recommend'
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : candidate.status === 'reject'
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {statusLabel(candidate.status)}
              </Badge>
              {candidate.schoolTag && (
                <Badge variant="outline" className="h-4.5 rounded px-1.5 text-[10px] font-normal">
                  {candidate.schoolTag}
                </Badge>
              )}
            </div>
            <div className="mt-1 truncate text-[12px] text-muted-foreground">
              {[candidate.current, candidate.years].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/35 px-2.5 py-1.5 text-right">
            <div
              className={cn(
                'text-[22px] leading-none font-semibold tracking-tight tabular-nums',
                scoreClass(score),
              )}
            >
              {score}
            </div>
            <div className="mt-0.5 text-[9.5px] text-muted-foreground">
              {candidate.composite ? '综合分' : '简历分'}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEmbeddedResume('pdf', 1)}
            className="gap-1.5"
          >
            <FileText className={cn('size-3.5', localPdfFile && 'text-rose-600 dark:text-rose-400')} />
            {localPdfFile ? '内嵌 PDF 简历' : '绑定本地 PDF'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEmbeddedResume('online', 1)}
            className="gap-1.5"
          >
            <Globe className={cn('size-3.5', linked?.onlineResumeFile && 'text-emerald-600 dark:text-emerald-400')} />
            在线简历
          </Button>
          {candidate.resumePages?.length ? (
            <Button size="sm" variant="outline" onClick={() => setResumeOpen(true)} className="gap-1.5">
              <BookOpen className="size-3.5" />
              原简历 {candidate.resumePages.length} 页
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={askEvalAssistant} className="gap-1.5">
            <Bot className="size-3.5" />
            问助手深挖
          </Button>
          {linked && (
            <Button
              size="sm"
              onClick={() => {
                select(linked.id)
                setModule('source')
              }}
              className="gap-1.5"
            >
              <ArrowUpRight className="size-3.5" />
              去筛选页沟通
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-4 pb-6">
          {/* 简历分 → 面试分 → 综合分 一览 */}
          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border bg-muted/25 px-3 py-2">
              <div className="text-[10px] text-muted-foreground">简历分</div>
              <div className={cn('mt-0.5 text-[18px] font-semibold tabular-nums', scoreClass(candidate.score))}>
                {candidate.score}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/25 px-3 py-2">
              <div className="text-[10px] text-muted-foreground">一面评分</div>
              <div
                className={cn(
                  'mt-0.5 text-[18px] font-semibold tabular-nums',
                  typeof interview?.score === 'number' ? scoreClass(interview.score) : 'text-muted-foreground',
                )}
              >
                {interview?.score ?? '待面'}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/25 px-3 py-2">
              <div className="text-[10px] text-muted-foreground">
                综合{interview?.band ? ` · ${String(interview.band)}` : ''}
              </div>
              <div className={cn('mt-0.5 text-[18px] font-semibold tabular-nums', scoreClass(score))}>{score}</div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border bg-muted/25 p-3">
            <Fact
              icon={UserRound}
              label="年龄 / 性别"
              value={[candidate.age ? `${candidate.age} 岁` : '', candidate.gender].filter(Boolean).join(' / ')}
            />
            <Fact icon={GraduationCap} label="学历" value={candidate.education} />
            <Fact icon={Building2} label="学校" value={candidate.school} />
            <Fact icon={BriefcaseBusiness} label="专业" value={candidate.major} />
            <Fact icon={MapPin} label="城市" value={candidate.location} />
            <Fact icon={Wallet} label="薪资判断" value={candidate.salaryNote} multiline />
            <div className="col-span-2">
              <Fact icon={Target} label="求职意向" value={candidate.intent} />
            </div>
          </section>

          {candidate.tagline && (
            <div className="flex gap-2 rounded-xl border bg-muted/35 p-3">
              <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[12px] leading-relaxed text-foreground/85">{candidate.tagline}</p>
            </div>
          )}

          {dims.length > 0 && (
            <section>
              <SectionTitle>评分构成</SectionTitle>
              <div className="mt-2 space-y-2 rounded-xl border bg-card p-3">
                {dims.map((dim) => {
                  const value = candidate.dimensions?.[dim.k] ?? 0
                  return (
                    <div key={dim.k} className="grid grid-cols-[76px_minmax(0,1fr)_48px] items-center gap-2">
                      <span className="truncate text-[11px] text-muted-foreground">{dim.k}</span>
                      <Progress value={(value / dim.max) * 100} className="h-1.5" />
                      <span className="text-right text-[11px] font-medium tabular-nums">
                        {value}
                        <span className="font-normal text-muted-foreground/60">/{dim.max}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {interview && (
            <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3">
              <div className="flex items-center justify-between">
                <SectionTitle className="text-indigo-700 dark:text-indigo-300">面试结论</SectionTitle>
                <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                  <CalendarDays className="size-2.5" />
                  {String(interview.date || '')}
                  {interview.platform ? ` · ${String(interview.platform)}` : ''}
                </span>
              </div>
              {typeof interview.headline === 'string' && (
                <p className="mt-2 text-[12.5px] leading-relaxed font-semibold">{interview.headline}</p>
              )}
              {typeof interview.verdict === 'string' && (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/80">{interview.verdict}</p>
              )}
            </section>
          )}

          {!!candidate.pros?.length && (
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
              <SectionTitle className="text-emerald-700 dark:text-emerald-400">站得住的证据</SectionTitle>
              <ul className="mt-1.5 space-y-1">
                {candidate.pros.map((item) => (
                  <li key={item} className="flex gap-1.5 text-[11.5px] leading-relaxed text-foreground/85">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!candidate.cons?.length && (
            <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
              <SectionTitle className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3" />
                风险与不足
              </SectionTitle>
              <ul className="mt-1.5 space-y-1">
                {candidate.cons.map((item) => (
                  <li key={item} className="flex gap-1.5 text-[11.5px] leading-relaxed text-foreground/85">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!candidate.questions?.length && (
            <section>
              <SectionTitle>下轮重点追问</SectionTitle>
              <ol className="mt-1.5 space-y-1.5 rounded-xl border bg-muted/25 p-3">
                {candidate.questions.map((item, index) => (
                  <li key={item} className="flex gap-2 text-[11.5px] leading-relaxed text-foreground/85">
                    <span className="font-semibold text-muted-foreground tabular-nums">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {modules.length > 0 && (
            <section>
              <SectionTitle>面试逐项拆解</SectionTitle>
              <Accordion type="single" collapsible className="mt-1.5 rounded-xl border bg-card px-3">
                {modules.map((mod, index) => (
                  <AccordionItem key={index} value={`m-${index}`}>
                    <AccordionTrigger className="py-2.5 text-[12px] font-medium hover:no-underline">
                      {mod.title || `第 ${index + 1} 项`}
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1.5 pb-1">
                        {(mod.items || []).map((item) => (
                          <li key={item} className="text-[11.5px] leading-relaxed text-muted-foreground">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          )}

          <Separator />
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Sparkles className="size-3" />
            来源：{candidate.batch || '评估库'} · 排名 {candidate.rank ?? '—'}
          </div>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-muted/25 px-4 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
        {candidate.interview
          ? `已面 ${String(candidate.interview.date || '')}：${String(candidate.interview.round || '')}`
          : '尚未面试：可先结合亮点与风险决定是否转到「简历筛选」约面。'}
      </div>

      <Dialog open={resumeOpen} onOpenChange={setResumeOpen}>
        <DialogContent className="sm:max-w-[780px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <BookOpen className="size-4" />
              {candidate.name} · 原始简历页
            </DialogTitle>
            <DialogDescription>
              {candidate.sourceFile || `${candidate.resumePages?.length || 0} 页`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[68vh] rounded-xl border bg-muted/35">
            <div className="space-y-3 p-3">
              {(candidate.resumePages || []).map((page, index) => (
                <div key={page} className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-medium text-muted-foreground">第 {index + 1} 页</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="h-6 gap-1 text-[11px]"
                      onClick={() => {
                        setResumeOpen(false)
                        openEmbeddedResume('pdf', index + 1)
                      }}
                    >
                      <FileText className="size-3 text-rose-500" />
                      跳转到 PDF 第 {index + 1} 页
                    </Button>
                  </div>
                  {brokenPages[page] ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-4 py-10 text-center">
                      <FileText className="size-5 text-muted-foreground" />
                      <p className="mt-2 text-[12px] font-medium">第 {index + 1} 页原始截图仅保存在本地隐私目录</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        可点击右上角「跳转到 PDF 第 {index + 1} 页」在内嵌 PDF 查看器中打开或导入本地 PDF。
                      </p>
                    </div>
                  ) : (
                    <img
                      src={resumeSrc(page)}
                      alt={`第 ${index + 1} 页`}
                      onError={() => setBrokenPages((prev) => ({ ...prev, [page]: true }))}
                      onClick={() => {
                        setResumeOpen(false)
                        openEmbeddedResume('pdf', index + 1)
                      }}
                      className="w-full cursor-pointer rounded-lg border bg-background shadow-2xs transition-opacity hover:opacity-95"
                      title={`点击跳转到 PDF 第 ${index + 1} 页`}
                      loading="lazy"
                    />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <ResumeViewerDialog
        open={pdfViewerOpen}
        onOpenChange={setPdfViewerOpen}
        initialTab={pdfViewerTab}
        initialPage={pdfPage}
        totalPagesHint={candidate.resumePages?.length}
        candidateName={candidate.name}
        job={linked?.job || position?.name || candidate.intent}
        geekId={linked?.geekId}
        source={linked?.source || 'message'}
        pdfFile={localPdfFile}
        onlineResumeFile={linked?.onlineResumeFile}
      />
    </PanelSwap>
  )
}

function Fact({
  icon: Icon,
  label,
  value,
  multiline,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string
  multiline?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="size-2.5" />
        {label}
      </div>
      <div
        className={
          multiline
            ? 'mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed font-medium text-foreground/90'
            : 'mt-0.5 truncate text-[11.5px] font-medium text-foreground/90'
        }
        title={value || ''}
      >
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
