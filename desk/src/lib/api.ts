import type {
  CandidateSource,
  DeskData,
  DoctorStatus,
  DshModelsCatalog,
  LocalPdfFile,
  OnlineResumeRecord,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateStatus,
} from '@/types'

/**
 * 兼容独立部署（`/`）与嵌入 DeepSeek Harness WebServer（`/boss-desk/`）两种挂载路径。
 */
export function appBasePrefix(): string {
  if (typeof window === 'undefined') return ''
  const path = window.location.pathname
  if (path === '/boss-desk' || path.startsWith('/boss-desk/')) return '/boss-desk'
  return ''
}

function apiUrl(subPath: string): string {
  return `${appBasePrefix()}${subPath}`
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  const text = await res.text()
  const payload = text ? safeParse(text) : {}
  if (!res.ok) {
    throw new ApiError(payload?.error || `请求失败（${res.status}）`, res.status)
  }
  return payload as T
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 200) }
  }
}

export const api = {
  data: (refresh = false) => request<DeskData>(`/api/data${refresh ? '?refresh=1' : ''}`),
  doctor: (refresh = false) => request<DoctorStatus>(`/api/doctor${refresh ? '?refresh=1' : ''}`),
  models: () => request<DshModelsCatalog>('/api/models'),
  selectModel: (provider: string, model: string) =>
    request<{ ok: boolean; savedToDsh?: boolean; current: { provider: string; model: string } }>('/api/models/select', {
      method: 'POST',
      body: JSON.stringify({ provider, model }),
    }),
  refresh: () => request<{ pipeline: DeskData['pipeline']; quota: DeskData['quota'] }>('/api/refresh', { method: 'POST' }),
  setStage: (payload: { name: string; job: string; stage: string; score?: number }) =>
    request<{ ok: boolean; pipeline: DeskData['pipeline'] }>('/api/stage', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  send: (name: string, text: string) =>
    request<{ ok: boolean; result: string; quota: DeskData['quota']; pipeline?: DeskData['pipeline'] }>('/api/send', {
      method: 'POST',
      body: JSON.stringify({ name, text }),
    }),
  greet: (payload: { name?: string; geekId?: string; job?: string; tab?: 'recommend' | 'featured' }) =>
    request<{ ok: boolean; result: unknown; quota: DeskData['quota']; pipeline?: DeskData['pipeline'] }>('/api/greet', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  syncSourcing: (payload: {
    tab: 'recommend' | 'featured'
    job?: string
    limit?: number
    skipViewed?: boolean
    skipColleague?: boolean
  }) =>
    request<{
      ok: boolean
      tab: 'recommend' | 'featured'
      job: string
      count: number
      pipeline: DeskData['pipeline']
      quota: DeskData['quota']
    }>('/api/sourcing/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listResumePdfs: () => request<{ files: LocalPdfFile[] }>('/api/resume/pdfs'),
  uploadResumePdf: (payload: {
    name: string
    job?: string
    geekId?: string
    source?: CandidateSource | string
    filename?: string
    dataBase64: string
  }) =>
    request<{
      ok: boolean
      pdfFile: string
      pdfUrl: string
      pdfPath: string
      pipeline?: DeskData['pipeline']
    }>('/api/resume/upload-pdf', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getOnlineResume: (name: string, file?: string) => {
    const qs = new URLSearchParams()
    if (name) qs.set('name', name)
    if (file) qs.set('file', file)
    return request<OnlineResumeRecord>(`/api/resume/online?${qs.toString()}`)
  },
  fetchOnlineResume: (payload: {
    name: string
    geekId?: string
    job?: string
    source?: CandidateSource | string
    screenshot?: boolean
  }) =>
    request<{
      ok: boolean
      resume: OnlineResumeRecord
      quota: DeskData['quota']
      pipeline?: DeskData['pipeline']
    }>('/api/resume/fetch', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  ping: () => request<{ ok: boolean }>('/api/ping'),
  updateStatus: () => request<UpdateStatus>('/api/update/status'),
  updateSaveConfig: (payload: { sourceUrl?: string; githubRepo?: string; githubToken?: string }) =>
    request<{ ok: boolean; status: UpdateStatus }>('/api/update/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCheck: (payload?: { sourceUrl?: string; githubRepo?: string; githubToken?: string }) =>
    request<UpdateCheckResult>('/api/update/check', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  updateInstall: (payload?: { sourceUrl?: string; githubRepo?: string; githubToken?: string }) =>
    request<UpdateInstallResult>('/api/update/install', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  updateUpload: (payload: { filename: string; dataBase64: string }) =>
    request<UpdateInstallResult>('/api/update/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRestart: () =>
    request<{ ok: boolean; restarting: boolean }>('/api/update/restart', {
      method: 'POST',
    }),
}

export type AssistantCandidateContext = {
  kind: 'source' | 'assess'
  name: string
  job?: string
  stage?: string
  score?: number
  summary?: string
  facts?: Record<string, string | undefined>
  highlights?: string[]
  risks?: string[]
  questions?: string[]
  lastMessages?: string[]
}

export type AssistantImageInput = {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  data: string
  name?: string
}

export type AssistantStream = {
  onMeta?: (meta: { provider?: string; model?: string }) => void
  onThinking?: (steps: string[]) => void
  onReasoning?: (text: string) => void
  onDelta?: (text: string) => void
  onDone?: () => void
  onError?: (message: string, code?: string) => void
}

/** 读取 /api/assistant 的 SSE 流；调用方通过返回的 abort 取消。 */
export function streamAssistant(
  payload: {
    message: string
    history: { role: 'user' | 'assistant'; content: string }[]
    contextCandidate?: AssistantCandidateContext | null
    images?: AssistantImageInput[]
    provider?: string
    model?: string
  },
  handlers: AssistantStream,
): () => void {
  const controller = new AbortController()

  ;(async () => {
    let settled = false
    try {
      const res = await fetch(apiUrl('/api/assistant'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const text = await res.text()
        throw new Error(safeParse(text)?.error || `服务返回 ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''
        for (const frame of frames) {
          let event = 'message'
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          const parsed = safeParse(data)
          if (event === 'meta') handlers.onMeta?.(parsed)
          else if (event === 'thinking') handlers.onThinking?.(parsed.steps || [])
          else if (event === 'reasoning') handlers.onReasoning?.(parsed.text || '')
          else if (event === 'delta') handlers.onDelta?.(parsed.text || '')
          else if (event === 'done') {
            settled = true
            handlers.onDone?.()
          } else if (event === 'error') {
            settled = true
            handlers.onError?.(parsed.message || '生成失败', parsed.code)
          }
        }
      }
      if (!settled) handlers.onDone?.()
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      handlers.onError?.((error as Error).message)
    }
  })()

  return () => controller.abort()
}
