import { useEffect, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { SOURCE_META, normalizeSource, pdfResumeUrl, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CandidateSource, OnlineResumeRecord } from '@/types'

export type ResumeViewerTab = 'pdf' | 'online'

export type ResumeViewerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: ResumeViewerTab
  initialPage?: number
  totalPagesHint?: number
  candidateName: string
  job?: string
  source?: CandidateSource | string
  pdfFile?: string | null
  onlineResumeFile?: string | null
}

export function ResumeViewerDialog(props: ResumeViewerProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <ResumeViewerBody
          key={`${props.candidateName}::${props.initialTab || 'pdf'}::${props.initialPage || 1}::${props.pdfFile || ''}`}
          {...props}
        />
      ) : null}
    </Dialog>
  )
}

function ResumeViewerBody({
  initialTab = 'pdf',
  initialPage = 1,
  totalPagesHint,
  candidateName,
  job,
  source,
  pdfFile,
  onlineResumeFile,
}: ResumeViewerProps) {
  const [tab, setTab] = useState<ResumeViewerTab>(initialTab)
  const [page, setPage] = useState<number>(Math.max(1, initialPage))
  const [pageInput, setPageInput] = useState<string>(String(Math.max(1, initialPage)))
  const activePdfUrl = pdfResumeUrl(pdfFile)

  const [onlineLoading, setOnlineLoading] = useState(Boolean(candidateName))
  const [showScreenshot, setShowScreenshot] = useState(false)
  const [onlineRecord, setOnlineRecord] = useState<OnlineResumeRecord | null>(null)
  const [copied, setCopied] = useState(false)

  const normalizedSrc = normalizeSource(source)
  const srcMeta = SOURCE_META[normalizedSrc]

  useEffect(() => {
    if (!candidateName) return
    let cancelled = false
    api
      .getOnlineResume(candidateName, onlineResumeFile || undefined)
      .then((rec) => {
        if (!cancelled) {
          setOnlineRecord(rec)
          // Canvas/图片简历没有可提取文本时，有截图就直接显示截图，避免打开后一片空白
          setShowScreenshot(Boolean(rec.screenshotUrl) && !String(rec.text || '').trim())
          setOnlineLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setOnlineLoading(false)
          toast.error((error as Error).message || '读取本地在线简历存档失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [candidateName, onlineResumeFile])

  const jumpToPage = (target: number) => {
    const clamped = Math.max(1, Math.min(99, Math.floor(target) || 1))
    setPage(clamped)
    setPageInput(String(clamped))
  }

  const copyText = async (text: string, label = '已复制到剪贴板') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(label)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('复制失败')
    }
  }

  const quickPageCount = Math.min(8, Math.max(totalPagesHint || 4, page))
  const iframeSrc = activePdfUrl ? `${activePdfUrl}#page=${page}&view=FitH` : null

  const agentFetchOnlinePrompt =
    normalizedSrc === 'recommend' || normalizedSrc === 'featured'
      ? `请帮我调用 boss preview "${candidateName}" --tab ${normalizedSrc}${job ? ` --job "${job}"` : ''} --json 读取并转存「${candidateName}」的 Boss 在线简历到本地。`
      : `请帮我打开「${candidateName}」的 Boss 对话并调用 boss action resume --json，把在线简历转存到本地。`

  const agentImportPdfPrompt = `请帮我把「${candidateName}」的 PDF 简历放入 ~/.boss-cli/resumes/pdf/${candidateName}.pdf，并更新本地台账。`

  return (
    <DialogContent className="flex h-[88vh] max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
      <DialogHeader className="shrink-0 border-b px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <FileText className="size-4 text-primary" />
            {candidateName} · 本地简历档案
          </DialogTitle>
          {job && (
            <Badge variant="outline" className="h-5 rounded px-1.5 text-[10.5px] font-normal">
              {job}
            </Badge>
          )}
          <Badge variant="outline" className={cn('h-5 rounded px-1.5 text-[10.5px] font-normal', srcMeta.className)}>
            {srcMeta.label}
          </Badge>
        </div>
        <DialogDescription className="text-[11.5px]">
          纯本地只读查看器：自动读取 ~/.boss-cli/resumes/pdf/ 中的 PDF 与 ~/.boss-cli/resumes/online/ 中的 Boss 在线简历存档。
        </DialogDescription>
      </DialogHeader>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ResumeViewerTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-5 py-2">
          <TabsList className="h-8 bg-muted/80 p-0.5">
            <TabsTrigger value="pdf" className="gap-1.5 px-3 text-[12px]">
              <FileText className="size-3.5" />
              PDF 附件简历
              {activePdfUrl && <span className="size-1.5 rounded-full bg-emerald-500" />}
            </TabsTrigger>
            <TabsTrigger value="online" className="gap-1.5 px-3 text-[12px]">
              <Globe className="size-3.5" />
              Boss 在线简历
              {onlineRecord?.found && <span className="size-1.5 rounded-full bg-emerald-500" />}
            </TabsTrigger>
          </TabsList>

          {tab === 'pdf' && activePdfUrl && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-0.5 rounded-lg border bg-card px-1 py-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  disabled={page <= 1}
                  onClick={() => jumpToPage(page - 1)}
                  title="上一页"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="px-1 text-[11px] text-muted-foreground">第</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => jumpToPage(Number(pageInput))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') jumpToPage(Number(pageInput))
                  }}
                  className="h-5.5 w-10 rounded border bg-background px-1 text-center text-[11.5px] font-medium tabular-nums outline-none focus:border-foreground/40"
                />
                <span className="px-1 text-[11px] text-muted-foreground">页</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  onClick={() => jumpToPage(page + 1)}
                  title="下一页"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>

              <div className="hidden items-center gap-1 md:flex">
                {Array.from({ length: quickPageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => jumpToPage(p)}
                    className={cn(
                      'h-6 min-w-6 rounded border px-1.5 text-[10.5px] font-medium tabular-nums transition-colors',
                      page === p
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    P{p}
                  </button>
                ))}
              </div>

              <Button variant="outline" size="xs" className="h-7 gap-1 text-[11.5px]" asChild>
                <a href={`${activePdfUrl}#page=${page}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3" />
                  新窗口
                </a>
              </Button>
              <Button variant="outline" size="xs" className="h-7 gap-1 text-[11.5px]" asChild>
                <a href={activePdfUrl} download={`${candidateName}-简历.pdf`}>
                  <Download className="size-3" />
                  下载
                </a>
              </Button>
            </div>
          )}

          {tab === 'online' && onlineRecord?.found && (
            <div className="flex items-center gap-1.5">
              {onlineRecord.screenshotUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-7 gap-1 text-[11.5px]"
                  onClick={() => setShowScreenshot((s) => !s)}
                >
                  <ImageIcon className="size-3" />
                  {showScreenshot ? '切回文本视图' : '查看截图'}
                </Button>
              )}
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-7 gap-1 text-[11.5px]"
                onClick={() => void copyText(onlineRecord.text || '', '已复制在线简历全文')}
              >
                {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                {copied ? '已复制' : '复制全文'}
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="pdf" className="mt-0 flex min-h-0 flex-1 flex-col">
          {iframeSrc ? (
            <div className="relative flex min-h-0 flex-1 flex-col bg-muted/40">
              <iframe
                key={iframeSrc}
                src={iframeSrc}
                title={`${candidateName} PDF 简历 第 ${page} 页`}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          ) : (
            <div className="m-5 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-2xs">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <h3 className="mt-3 text-[14px] font-semibold">本地尚未存放 {candidateName} 的 PDF 简历</h3>
              <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                将 PDF 放到本机{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  ~/.boss-cli/resumes/pdf/{candidateName}.pdf
                </code>
                （或直接在左侧 Agent 对话中让它按规范归档），本页面会在 1 秒内自动感知并支持内嵌跳页查看。
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText(agentImportPdfPrompt, '已复制归档指令，可粘贴到左侧 Agent 对话')}
                  className="gap-1.5"
                >
                  <Copy className="size-3.5" />
                  复制给 Agent 归档 PDF
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTab('online')} className="gap-1.5">
                  <Globe className="size-3.5" />
                  查看 Boss 在线简历存档
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="online" className="mt-0 flex min-h-0 flex-1 flex-col">
          {onlineLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在检查本地在线简历存档…
            </div>
          ) : onlineRecord?.found ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-emerald-500/[0.04] px-5 py-2 text-[11.5px]">
                <div className="flex flex-wrap items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <HardDrive className="size-3.5" />
                  <span className="font-medium">本地已存档 · 离线零额度查看</span>
                  {onlineRecord.capturedAt && (
                    <span className="text-muted-foreground">采集于 {relativeTime(onlineRecord.capturedAt)}</span>
                  )}
                  {onlineRecord.method && (
                    <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] font-normal">
                      {onlineRecord.method}
                    </Badge>
                  )}
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-5">
                  {showScreenshot && onlineRecord.screenshotUrl ? (
                    <img
                      src={onlineRecord.screenshotUrl}
                      alt={`${candidateName} 在线简历截图`}
                      className="w-full rounded-xl border bg-background shadow-2xs"
                    />
                  ) : (
                    <FormattedOnlineResume text={onlineRecord.text || ''} />
                  )}
                  {onlineRecord.filePath && (
                    <div className="border-t pt-3 text-[10.5px] text-muted-foreground">
                      本地存档路径：<code className="rounded bg-muted px-1.5 py-0.5">{onlineRecord.filePath}</code>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="m-5 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-2xs">
                <Globe className="size-6 text-muted-foreground" />
              </div>
              <h3 className="mt-3 text-[14px] font-semibold">尚未转存 {candidateName} 的 Boss 在线简历</h3>
              <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                在左侧 Agent（WorkBuddy / 千问办公 / 豆包工作）对话中下达指令，通过本机 Safari 读取并转存到{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/.boss-cli/resumes/online/</code>{' '}
                后，此处会自动显示并永久支持离线查看。
              </p>
              <div className="mt-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText(agentFetchOnlinePrompt, '已复制指令，粘贴给左侧 Agent 即可抓取')}
                  className="gap-1.5"
                >
                  <Copy className="size-3.5" />
                  复制抓取指令给 Agent
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}

const SECTION_HEADINGS = new Set([
  '个人优势',
  '期望职位',
  '求职期望',
  '工作经历',
  '项目经历',
  '教育经历',
  '专业技能',
  '资格证书',
  '语言能力',
  '在校经历',
  '志愿服务经历',
  '获奖经历',
  '社交主页',
  '作品集',
])

function FormattedOnlineResume({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (!lines.length) {
    return <p className="text-[12px] text-muted-foreground">（本次采集未提取到可见文本）</p>
  }

  const sections: { title: string; body: string[] }[] = []
  let current: { title: string; body: string[] } = { title: '基本信息', body: [] }

  for (const line of lines) {
    if (SECTION_HEADINGS.has(line)) {
      if (current.body.length > 0) sections.push(current)
      current = { title: line, body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.length > 0) sections.push(current)

  return (
    <div className="space-y-3">
      {sections.map((sec, idx) => (
        <section key={`${sec.title}-${idx}`} className="rounded-xl border bg-card p-3.5 shadow-2xs">
          <h4 className="text-[11.5px] font-semibold tracking-wide text-primary">{sec.title}</h4>
          <div className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-foreground/90">
            {sec.body.map((line, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {line}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
