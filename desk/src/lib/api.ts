import type {
  DeskData,
  LocalPdfFile,
  OnlineResumeRecord,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateStatus,
} from '@/types'

export function appBasePrefix(): string {
  return ''
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
  ping: () => request<{ ok: boolean; mode?: string; version?: string }>('/api/ping'),
  data: () => request<DeskData>('/api/data'),
  listResumePdfs: () => request<{ files: LocalPdfFile[] }>('/api/resume/pdfs'),
  getOnlineResume: (name: string, file?: string) => {
    const qs = new URLSearchParams()
    if (name) qs.set('name', name)
    if (file) qs.set('file', file)
    return request<OnlineResumeRecord>(`/api/resume/online?${qs.toString()}`)
  },
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

/** 订阅服务端 SSE 文件监听事件：WorkBuddy 写入 ~/.boss-cli 后自动触发界面静默刷新 */
export function subscribeDataEvents(handlers: {
  onReady?: () => void
  onUpdate: () => void
  onError?: () => void
}): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {}
  }
  const source = new EventSource('/api/events')
  source.addEventListener('ready', () => handlers.onReady?.())
  source.addEventListener('update', () => handlers.onUpdate())
  source.onerror = () => handlers.onError?.()
  return () => source.close()
}
