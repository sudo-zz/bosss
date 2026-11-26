import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { BorderBeam } from 'border-beam'
import { BotAvatar } from 'bot-avatars'
import { ThinkingOrb } from 'thinking-orbs'
import { toast } from 'sonner'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  ExternalLink,
  Image as ImageIcon,
  ImagePlus,
  MessageSquarePlus,
  PanelRightClose,
  RefreshCw,
  Square,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'

import { ReasoningStream, StreamingText, ThinkingStates } from '@/components/motion/effects'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { appBasePrefix, type AssistantCandidateContext, type AssistantImageInput } from '@/lib/api'
import { STAGE_LABEL, statusLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useChat, type ChatMsg } from '@/store/chat'
import { useDesk } from '@/store/desk'

type PendingImage = AssistantImageInput & {
  id: string
  previewUrl: string
}

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const SUPPORTED_MIMES = new Set<AssistantImageInput['mediaType']>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

async function normalizeImageFile(file: File): Promise<PendingImage> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片「${file.name || '剪贴板图片'}」超过 10MB 限制`)
  }
  const rawMime = (file.type || '').toLowerCase()
  const mappedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime
  if (SUPPORTED_MIMES.has(mappedMime as AssistantImageInput['mediaType'])) {
    const dataUrl = await blobToDataUrl(file)
    const comma = dataUrl.indexOf(',')
    if (comma < 0) throw new Error('图片编码无效')
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mediaType: mappedMime as AssistantImageInput['mediaType'],
      data: dataUrl.slice(comma + 1),
      name: file.name || 'clipboard-image.png',
      previewUrl: dataUrl,
    }
  }
  // Convert other browser-decodable formats (e.g. TIFF/BMP from macOS clipboard) to PNG
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) throw new Error('无法转换图片格式')
  ctx2d.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pngDataUrl = canvas.toDataURL('image/png')
  const comma = pngDataUrl.indexOf(',')
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mediaType: 'image/png',
    data: pngDataUrl.slice(comma + 1),
    name: (file.name || 'clipboard-image').replace(/\.[^.]+$/, '') + '.png',
    previewUrl: pngDataUrl,
  }
}

export function AssistantPanel() {
  const { sessions, activeId, streamingId, createSession, selectSession, deleteSession, send, stop } = useChat()
  const {
    toggleAssistant,
    module,
    pipeline,
    evalData,
    selectedId,
    selectedEvalId,
    doctor,
    modelsCatalog,
    loadingModels,
    loadModels,
    selectModel,
  } = useDesk()
  const [draft, setDraft] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const active = useMemo(() => sessions.find((s) => s.id === activeId) || null, [sessions, activeId])
  const busy = Boolean(streamingId)
  const messages = active?.messages ?? []
  const inDshRuntime = modelsCatalog?.runtime === 'deepseek-harness' || Boolean(appBasePrefix())
  const currentModel = modelsCatalog?.current ?? (doctor?.provider && doctor?.modelId ? { provider: doctor.provider, model: doctor.modelId } : null)

  const suggestions = useMemo(() => {
    const total = pipeline?.stats.total ?? 0
    if (total === 0) {
      return [
        '如何用 Safari 开始巡检 Boss 未读消息？',
        '帮我制定一份 AI 应用开发岗的评分标准',
        '给我一份首轮要简历的沟通模板',
      ]
    }
    const firstPos = pipeline?.meta.positions?.[0]?.name || pipeline?.meta.positions?.[0]?.short
    return [
      '今天该优先跟进哪 3 个人？',
      '挑 3 个可以直接约面的候选人',
      firstPos ? `「${firstPos}」里目前最值得约面的是谁？` : '高分但还没联系的候选人有哪些？',
      '当前招聘漏斗卡在哪一步？',
    ]
  }, [pipeline])

  const focusedContext = useMemo<AssistantCandidateContext | null>(() => {
    if (module === 'source') {
      const c = pipeline?.candidates.find((item) => item.id === selectedId)
      if (!c) return null
      return {
        kind: 'source',
        name: c.name,
        job: c.job,
        stage: STAGE_LABEL[c.stage] || c.stage,
        score: c.score,
        summary: c.reason || c.summary,
        facts: c.facts,
        highlights: c.highlights,
        risks: c.risks,
        lastMessages: (c.messages || []).slice(-4).map((m) => `[${m.from}] ${m.text}`),
      }
    }
    const e = evalData?.candidates.find((item) => item.id === selectedEvalId)
    if (!e) return null
    return {
      kind: 'assess',
      name: e.name,
      job: e.intent || e.positionId,
      stage: statusLabel(e.status),
      score: e.composite ?? e.score,
      summary: e.tagline || e.current,
      facts: {
        age: e.age ? `${e.age}岁` : undefined,
        exp: e.years,
        edu: e.education,
        city: e.location,
        salary: e.salaryNote,
        school: [e.school, e.major].filter(Boolean).join(' · '),
        latestWork: e.current,
      },
      highlights: e.pros,
      risks: e.cons,
      questions: e.questions,
    }
  }, [module, pipeline, evalData, selectedId, selectedEvalId])

  const lastMessageContent = messages[messages.length - 1]?.content
  useEffect(() => {
    if (!messages.length) return
    const timer = setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 40)
    return () => clearTimeout(timer)
  }, [messages.length, lastMessageContent])

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name))
    if (!imageFiles.length) return
    const remaining = MAX_IMAGES - pendingImages.length
    if (remaining <= 0) {
      toast.warning(`单条消息最多附带 ${MAX_IMAGES} 张图片`)
      return
    }
    const batch = imageFiles.slice(0, remaining)
    const added: PendingImage[] = []
    for (const file of batch) {
      try {
        added.push(await normalizeImageFile(file))
      } catch (error) {
        toast.error((error as Error).message || '读取图片失败')
      }
    }
    if (added.length) {
      setPendingImages((prev) => [...prev, ...added].slice(0, MAX_IMAGES))
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length === 0 && event.clipboardData?.files?.length) {
      for (const f of Array.from(event.clipboardData.files)) {
        if (f.type.startsWith('image/')) imageFiles.push(f)
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault()
      void addImageFiles(imageFiles)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer?.files || [])
    if (files.length > 0) void addImageFiles(files)
  }

  const submit = async (text?: string, withContext = true) => {
    const value = (text ?? draft).trim()
    const imgs = text === undefined ? pendingImages : []
    if ((!value && imgs.length === 0) || busy) return
    if (text === undefined) {
      setDraft('')
      setPendingImages([])
    }
    await send(value, withContext ? focusedContext : null, currentModel, imgs)
  }

  const handleSelectModel = async (provider: string, model: string) => {
    try {
      await selectModel(provider, model)
      toast.success(`已切换 DSH 模型：${provider} / ${model}`)
    } catch (error) {
      toast.error((error as Error).message || '切换模型失败')
    }
  }

  const activeModelLabel = currentModel
    ? currentModel.model
    : doctor?.modelName || (inDshRuntime ? '未配置 DSH 模型' : '本地台账引擎')

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-muted/70 ring-1 ring-border">
          <BotAvatar type="droid" color="#27272a" state={busy ? 'working' : 'default'} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] leading-tight font-semibold">招聘助手</div>
          {inDshRuntime ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded px-1 -ml-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={currentModel ? `当前 DSH 模型：${currentModel.provider} / ${currentModel.model}` : '选择 DSH 模型'}
                >
                  <Cpu className="size-2.5 shrink-0" />
                  <span className="truncate">{busy ? '正在生成…' : activeModelLabel}</span>
                  <ChevronDown className="size-2.5 shrink-0 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                <DropdownMenuLabel className="flex items-center justify-between text-[11px] font-normal text-muted-foreground">
                  <span>DSH 已接入模型</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      void loadModels()
                    }}
                    className="inline-flex items-center gap-0.5 text-[10px] hover:text-foreground"
                  >
                    <RefreshCw className={cn('size-2.5', loadingModels && 'animate-spin')} />
                    刷新
                  </button>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!modelsCatalog?.providers.length && (
                  <div className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    暂无可用模型，请先在 DSH 设置中配置 API Key 或模型提供商。
                  </div>
                )}
                {modelsCatalog?.providers.map((provider) => (
                  <div key={provider.id}>
                    <DropdownMenuLabel className="py-1 text-[10px] font-medium text-muted-foreground/80">
                      {provider.name}
                    </DropdownMenuLabel>
                    {provider.models.map((m) => {
                      const selected =
                        currentModel?.provider === provider.id && currentModel?.model === m.id
                      return (
                        <DropdownMenuItem
                          key={`${provider.id}:${m.id}`}
                          className="text-[11.5px]"
                          onSelect={() => void handleSelectModel(provider.id, m.id)}
                        >
                          <span className="flex-1 truncate">{m.name || m.id}</span>
                          {selected && <Check className="size-3.5 text-emerald-600" />}
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="text-[11.5px]">
                  <a href="/" target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3" />
                    打开 DSH 设置管理模型
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="truncate text-[10px] text-muted-foreground">
              {busy ? '正在生成建议…' : `模型 · ${activeModelLabel}`}
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="会话列表">
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">会话历史</DropdownMenuLabel>
            <DropdownMenuItem className="text-[12px]" onSelect={() => createSession()}>
              <MessageSquarePlus className="size-3.5" />
              新建会话
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {sessions.length === 0 && (
              <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground">还没有会话</div>
            )}
            {sessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                className="text-[12px]"
                onSelect={() => selectSession(session.id)}
              >
                <span className="flex-1 truncate">{session.title}</span>
                {session.id === activeId && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
            {activeId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="text-[12px]"
                  onSelect={() => deleteSession(activeId)}
                >
                  <Trash2 className="size-3.5" />
                  删除当前会话
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon-sm" onClick={() => toggleAssistant(false)} aria-label="收起助手">
          <PanelRightClose className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-3">
          {messages.length === 0 ? (
            <div className="pt-5">
              <div className="flex justify-center">
                <BotAvatar type="droid" color="#27272a" size={50} state="default" />
              </div>
              <p className="mt-3 text-center text-[13px] font-semibold">今天想先推进哪一步？</p>
              <p className="mt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
                我会结合候选人台账、面试评估与当前选中的候选人，给出具体人名、风险和可执行话术。
              </p>
              <div className="mt-4 grid gap-1.5">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void submit(item, false)}
                    className="rounded-lg border bg-card px-2.5 py-2 text-left text-[11.5px] text-muted-foreground shadow-2xs transition-colors hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} inDshRuntime={inDshRuntime} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-muted/15 p-2.5">
        {focusedContext && (
          <div className="mb-2 flex flex-wrap items-center gap-1 rounded-lg border bg-card px-2 py-1.5">
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-foreground">
              <UserRound className="size-3 text-muted-foreground" />
              {focusedContext.name}
              {typeof focusedContext.score === 'number' && (
                <span className="text-muted-foreground tabular-nums">· {focusedContext.score}分</span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit(`深度分析「${focusedContext.name}」的亮点、风险与是否值得推进`, true)}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground hover:text-background"
              >
                分析此人
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit(`为「${focusedContext.name}」准备 3 个针对性面试追问`, true)}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground hover:text-background"
              >
                出面试题
              </button>
            </div>
          </div>
        )}

        <div
          onDragOver={(event) => {
            event.preventDefault()
            if (!dragOver) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            'relative rounded-xl border bg-card transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
            dragOver && 'border-dashed border-primary bg-primary/5',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || [])
              if (files.length) void addImageFiles(files)
              event.target.value = ''
            }}
          />

          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
              {pendingImages.map((img) => (
                <div
                  key={img.id}
                  className="group relative size-12 overflow-hidden rounded-lg border bg-muted/40 shadow-2xs"
                >
                  <img
                    src={img.previewUrl}
                    alt={img.name || '已粘贴图片'}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((item) => item.id !== img.id))}
                    className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background/85 text-foreground shadow-xs transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="移除图片"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            rows={2}
            placeholder={
              busy
                ? '正在回答…'
                : pendingImages.length > 0
                  ? '补充提问或直接 Enter 发送图片'
                  : '问候选人 / 招聘漏斗，或 ⌘V 粘贴简历截图'
            }
            className="min-h-[50px] resize-none border-0 bg-transparent pr-18 text-[12px] leading-relaxed shadow-none focus-visible:ring-0"
            disabled={busy}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            {!busy && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={pendingImages.length >= MAX_IMAGES}
                title="上传图片（也支持 ⌘V 粘贴或拖拽）"
                aria-label="上传图片"
              >
                <ImagePlus className="size-3.5" />
              </Button>
            )}
            {busy ? (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => stop()}
                aria-label="停止生成"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                onClick={() => void submit()}
                disabled={!draft.trim() && pendingImages.length === 0}
                aria-label="发送"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5 text-[9.5px] text-muted-foreground">
          <span>支持 ⌘V 粘贴 / 拖拽截图 · 绝不自动外发</span>
          <span>Shift + Enter 换行</span>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message, inDshRuntime }: { message: ChatMsg; inDshRuntime: boolean }) {
  const isUser = message.role === 'user'
  const streaming = Boolean(message.streaming)

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
        className="flex justify-end"
      >
        <div className="max-w-[88%] space-y-1.5 rounded-xl rounded-br-sm bg-primary px-3 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-primary-foreground">
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.images.map((img) =>
                img.previewUrl ? (
                  <img
                    key={img.id}
                    src={img.previewUrl}
                    alt={img.name || '图片'}
                    className="max-h-36 max-w-full rounded-md border border-primary-foreground/20 object-contain"
                  />
                ) : (
                  <span
                    key={img.id}
                    className="inline-flex items-center gap-1 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[10.5px]"
                  >
                    <ImageIcon className="size-3" />
                    {img.name || '已发送图片'}
                  </span>
                ),
              )}
            </div>
          )}
          {message.content && <div>{message.content}</div>}
        </div>
      </motion.div>
    )
  }

  const hasReasoning = Boolean(message.reasoning && message.reasoning.trim())
  const bubble = (
    <div
      className={cn(
        'relative w-full rounded-xl rounded-tl-sm border bg-card px-3 py-2 shadow-2xs',
        streaming && 'border-transparent',
      )}
    >
      {(message.thinking.length > 0 || hasReasoning) && (
        <div className="mb-1.5">
          {streaming ? (
            <ReasoningStream steps={message.thinking} />
          ) : (
            <Collapsible>
              <CollapsibleTrigger className="group flex items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
                {hasReasoning ? '查看模型推理过程' : `执行了 ${message.thinking.length} 步`}
              </CollapsibleTrigger>
              <CollapsibleContent>
                {hasReasoning ? (
                  <div className="mt-1 max-h-40 overflow-y-auto border-l pl-2 text-[10.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground/80">
                    {message.reasoning}
                  </div>
                ) : (
                  <ol className="mt-1 space-y-0.5 border-l pl-2">
                    {message.thinking.map((step) => (
                      <li key={step} className="text-[10.5px] leading-relaxed text-muted-foreground/80">
                        {step}
                      </li>
                    ))}
                  </ol>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {message.content ? (
        <div className="text-[12px] leading-relaxed break-words whitespace-pre-wrap">
          {streaming ? <StreamingText text={message.content} /> : message.content}
        </div>
      ) : streaming ? (
        <div className="flex items-center gap-2 py-0.5">
          <ThinkingOrb state="searching" size={20} />
          <ThinkingStates steps={message.thinking.length ? message.thinking : ['正在连接 DSH 模型']} />
        </div>
      ) : null}

      {message.error && (
        <div className="mt-1 space-y-1.5 text-[11px] leading-relaxed text-destructive">
          <div>{message.error}</div>
          {inDshRuntime && (
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[10.5px] font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <ExternalLink className="size-2.5" />
              前往 DSH 配置模型
            </a>
          )}
        </div>
      )}

      {!streaming && message.modelLabel && !message.error && (
        <div className="mt-1.5 text-[9.5px] text-muted-foreground/70">由 DSH 模型 {message.modelLabel} 生成</div>
      )}
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="flex gap-2"
    >
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <BotAvatar type="droid" color="#27272a" size={20} state={streaming ? 'working' : 'default'} />
      </div>
      <div className="min-w-0 flex-1">
        {streaming ? (
          <BorderBeam size="sm" colorVariant="mono" theme="auto">
            {bubble}
          </BorderBeam>
        ) : (
          bubble
        )}
      </div>
    </motion.div>
  )
}
