import { useEffect, useRef, useState } from 'react'
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
  RefreshCw,
  Upload,
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
import { useDesk } from '@/store/desk'
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
  geekId?: string
  source?: CandidateSource | string
  pdfFile?: string | null
  onlineResumeFile?: string | null
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取本地 PDF 文件失败'))
    reader.readAsDataURL(file)
  })
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
  geekId,
  source,
  pdfFile,
  onlineResumeFile,
}: ResumeViewerProps) {
  const { quota, pipeline, applyPipelinePatch } = useDesk()
  const [tab, setTab] = useState<ResumeViewerTab>(initialTab)
  const [page, setPage] = useState<number>(Math.max(1, initialPage))
  const [pageInput, setPageInput] = useState<string>(String(Math.max(1, initialPage)))
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(() => pdfResumeUrl(pdfFile))
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [onlineLoading, setOnlineLoading] = useState(Boolean(candidateName))
  const [onlineFetching, setOnlineFetching] = useState(false)
  const [withScreenshot, setWithScreenshot] = useState(false)
  const [showScreenshot, setShowScreenshot] = useState(false)
  const [onlineRecord, setOnlineRecord] = useState<OnlineResumeRecord | null>(null)
  const [copied, setCopied] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const normalizedSrc = normalizeSource(source)
  const srcMeta = SOURCE_META[normalizedSrc]

  const previewQuota = quota?.quotas?.preview ?? pipeline?.stats.quota?.quotas?.preview
  const previewRemaining = previewQuota ? Math.max(0, previewQuota.limit - previewQuota.used) : null

  useEffect(() => {
    if (!candidateName) return
    let cancelled = false
    api
      .getOnlineResume(candidateName, onlineResumeFile || undefined)
      .then((rec) => {
        if (!cancelled) {
          setOnlineRecord(rec)
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

  const handlePdfFile = async (file: File | null | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      toast.error('请选择 PDF 格式的简历文件（.pdf）')
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error('PDF 文件不能超过 25MB')
      return
    }
    setUploadingPdf(true)
    try {
      const dataBase64 = await readFileAsBase64(file)
      const res = await api.uploadResumePdf({
        name: candidateName,
        job,
        geekId,
        source: normalizedSrc,
        filename: file.name,
        dataBase64,
      })
      setActivePdfUrl(res.pdfUrl)
      jumpToPage(1)
      applyPipelinePatch(res.pipeline, undefined)
      toast.success(`已为 ${candidateName} 保存本地 PDF 简历`, {
        description: `存储在 ~/.boss-cli/resumes/pdf/${res.pdfFile}`,
      })
    } catch (error) {
      toast.error((error as Error).message || '上传保存 PDF 失败')
    } finally {
      setUploadingPdf(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFetchFromBoss = async () => {
    setOnlineFetching(true)
    try {
      const res = await api.fetchOnlineResume({
        name: candidateName,
        geekId: geekId || undefined,
        job: job || undefined,
        source: normalizedSrc,
        screenshot: withScreenshot,
      })
      setOnlineRecord(res.resume)
      applyPipelinePatch(res.pipeline, res.quota)
      toast.success(`已读取并转存 ${candidateName} 的 Boss 在线简历`, {
        description: '已保存至本地 ~/.boss-cli/resumes/online/，后续可离线零额度查看。',
      })
    } catch (error) {
      toast.error((error as Error).message || '从 Boss 读取在线简历失败')
    } finally {
      setOnlineFetching(false)
    }
  }

  const copyOnlineText = async () => {
    if (!onlineRecord?.text) return
    try {
      await navigator.clipboard.writeText(onlineRecord.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('复制失败')
    }
  }

  const quickPageCount = Math.min(8, Math.max(totalPagesHint || 4, page))
  const iframeSrc = activePdfUrl ? `${activePdfUrl}#page=${page}&view=FitH` : null

  return (
      <DialogContent className="flex h-[88vh] max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <DialogHeader className="shrink-0 border-b px-5 pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <FileText className="size-4 text-primary" />
              {candidateName} · 简历中心
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
            内嵌 PDF 附件查看器与 Boss 在线简历本地存档，所有简历均保存在本机 `~/.boss-cli/resumes/`。
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

            {tab === 'pdf' && (
              <div className="flex flex-wrap items-center gap-1.5">
                {activePdfUrl && (
                  <>
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
                  </>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => void handlePdfFile(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  size="xs"
                  variant={activePdfUrl ? 'outline' : 'default'}
                  className="h-7 gap-1 text-[11.5px]"
                  disabled={uploadingPdf}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingPdf ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                  {activePdfUrl ? '替换本地 PDF' : '上传 / 绑定本地 PDF'}
                </Button>
              </div>
            )}

            {tab === 'online' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={withScreenshot}
                    onChange={(e) => setWithScreenshot(e.target.checked)}
                    className="size-3.5 rounded accent-foreground"
                  />
                  同时保存截图
                </label>
                {previewRemaining !== null && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground tabular-nums">
                    今日在线简历额度剩 {previewRemaining}/{previewQuota?.limit ?? 30}
                  </span>
                )}
                {onlineRecord?.found && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="h-7 gap-1 text-[11.5px]"
                    onClick={() => void copyOnlineText()}
                  >
                    {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                    {copied ? '已复制' : '复制全文'}
                  </Button>
                )}
                <Button
                  type="button"
                  size="xs"
                  variant={onlineRecord?.found ? 'outline' : 'default'}
                  className="h-7 gap-1 text-[11.5px]"
                  disabled={onlineFetching || previewRemaining === 0}
                  onClick={() => void handleFetchFromBoss()}
                >
                  {onlineFetching ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  {onlineFetching
                    ? '正在通过 Safari 读取 Boss…'
                    : onlineRecord?.found
                      ? '重新从 Boss 读取'
                      : '从 Boss 读取并转存本地'}
                </Button>
              </div>
            )}
          </div>

          <TabsContent value="pdf" className="mt-0 flex min-h-0 flex-1 flex-col">
            {iframeSrc ? (
              <div
                className={cn('relative flex min-h-0 flex-1 flex-col bg-muted/40', dragOver && 'ring-2 ring-primary')}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  void handlePdfFile(e.dataTransfer.files?.[0])
                }}
              >
                <iframe
                  key={iframeSrc}
                  src={iframeSrc}
                  title={`${candidateName} PDF 简历 第 ${page} 页`}
                  className="h-full w-full border-0 bg-white"
                />
              </div>
            ) : (
              <div
                className={cn(
                  'm-5 flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/20 p-8 text-center transition-colors',
                  dragOver ? 'border-primary bg-primary/5' : 'border-border',
                )}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  void handlePdfFile(e.dataTransfer.files?.[0])
                }}
              >
                <div className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-2xs">
                  <FileText className="size-6 text-muted-foreground" />
                </div>
                <h3 className="mt-3 text-[14px] font-semibold">尚未为 {candidateName} 绑定本地 PDF 简历</h3>
                <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                  将候选人在 Boss 发过来的 PDF 简历拖拽到此处，或点击下方按钮导入。文件会永久保存在本机
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">~/.boss-cli/resumes/pdf/</code>
                  并自动与该候选人关联，支持页面内嵌查看和按页跳转。
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={uploadingPdf}
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-1.5"
                  >
                    {uploadingPdf ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                    选择本地 PDF 文件
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setTab('online')} className="gap-1.5">
                    <Globe className="size-3.5" />
                    改看 Boss 在线简历
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
                      <span className="text-muted-foreground">
                        采集于 {relativeTime(onlineRecord.capturedAt)}
                      </span>
                    )}
                    {onlineRecord.method && (
                      <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] font-normal">
                        {onlineRecord.method}
                      </Badge>
                    )}
                  </div>
                  {onlineRecord.screenshotUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-6.5 gap-1 text-[11px]"
                      onClick={() => setShowScreenshot((s) => !s)}
                    >
                      <ImageIcon className="size-3" />
                      {showScreenshot ? '切回文本视图' : '查看原始截图'}
                    </Button>
                  )}
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
                <h3 className="mt-3 text-[14px] font-semibold">尚未采集 {candidateName} 的 Boss 在线简历</h3>
                <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                  点击下方按钮将通过本机 Safari 直接打开该候选人的 Boss 在线简历，自动提取全文并永久转存至本地
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">~/.boss-cli/resumes/online/</code>
                  。后续再次点开或交给右侧 AI 助手分析时均直接读本地副本，不重复消耗 Boss 查看额度。
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={onlineFetching || previewRemaining === 0}
                    onClick={() => void handleFetchFromBoss()}
                    className="gap-1.5"
                  >
                    {onlineFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    {onlineFetching ? '正在通过 Safari 抓取中…' : '立即从 Boss 读取并转存本地'}
                  </Button>
                </div>
                {previewRemaining === 0 && (
                  <p className="mt-2 text-[11px] text-amber-600">今日在线简历查看额度已用完，明天自动重置。</p>
                )}
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
    return <p className="text-[12px] text-muted-foreground">（本次采集未提取到可见文本，请尝试勾选「同时保存截图」重新读取）</p>
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
