import { create } from 'zustand'
import { api } from '@/lib/api'
import { normalizeSource, resolvedFacts } from '@/lib/format'
import type {
  Candidate,
  CandidateSource,
  DeskData,
  DoctorStatus,
  DshModelsCatalog,
  EvalCandidate,
  EvalData,
  Pipeline,
  Quota,
  Stage,
} from '@/types'

export type ModuleKey = 'source' | 'assess'
export type SourceView = 'list' | 'board'
export type SortKey = 'score' | 'recent'
export type SourceFilterKey = 'all' | CandidateSource
export type QuickFilterKey =
  | 'all'
  | 'high_uncontacted'
  | 'shanghai'
  | 'awaiting_reply'
  | 'has_eval_or_img'
  | 'has_local_resume'
  | 'active_now'
  | 'not_greeted'
export type ThemeMode = 'light' | 'dark'

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem('bole-theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeClass(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    window.localStorage.setItem('bole-theme', theme)
  } catch {
    /* ignore storage failures */
  }
}

type DeskState = {
  pipeline: Pipeline | null
  evalData: EvalData | null
  quota: Quota | null
  doctor: DoctorStatus | null
  modelsCatalog: DshModelsCatalog | null
  checkingDoctor: boolean
  loadingModels: boolean
  loading: boolean
  refreshing: boolean
  syncingSourcing: boolean
  error: string | null
  loadedAt: number

  theme: ThemeMode
  module: ModuleKey
  sourceView: SourceView
  sourceFilter: SourceFilterKey
  stage: Stage | 'all'
  quickFilter: QuickFilterKey
  position: string
  query: string
  sort: SortKey
  selectedId: string | null
  selectedEvalId: string | null
  assistantOpen: boolean
  detailOpen: boolean
  sendDialogOpen: boolean

  load: (force?: boolean) => Promise<void>
  checkDoctor: (force?: boolean) => Promise<void>
  loadModels: () => Promise<void>
  selectModel: (provider: string, model: string) => Promise<void>
  refresh: () => Promise<void>
  syncSourcing: (payload: {
    tab: 'recommend' | 'featured'
    job?: string
    limit?: number
    skipViewed?: boolean
    skipColleague?: boolean
  }) => Promise<{ count: number; job: string; tab: 'recommend' | 'featured' }>
  applyPipelinePatch: (pipeline?: Pipeline | null, quota?: Quota | null) => void
  toggleTheme: () => void
  setModule: (module: ModuleKey) => void
  setSourceView: (view: SourceView) => void
  setSourceFilter: (sourceFilter: SourceFilterKey) => void
  setStage: (stage: Stage | 'all') => void
  setQuickFilter: (quickFilter: QuickFilterKey) => void
  resetSourceFilters: () => void
  setPosition: (position: string) => void
  setQuery: (query: string) => void
  setSort: (sort: SortKey) => void
  select: (id: string | null) => void
  selectEval: (id: string | null) => void
  closeDetail: () => void
  toggleAssistant: (open?: boolean) => void
  setSendDialogOpen: (open: boolean) => void
  moveStage: (candidate: Candidate, stage: Stage) => Promise<Stage>
  sendMessage: (candidate: Candidate, text: string) => Promise<void>
  greetCandidate: (candidate: Candidate) => Promise<void>
}

const initialTheme = readInitialTheme()
applyThemeClass(initialTheme)

export const useDesk = create<DeskState>((set) => ({
  pipeline: null,
  evalData: null,
  quota: null,
  doctor: null,
  modelsCatalog: null,
  checkingDoctor: false,
  loadingModels: false,
  loading: false,
  refreshing: false,
  syncingSourcing: false,
  error: null,
  loadedAt: 0,

  theme: initialTheme,
  module: 'source',
  sourceView: 'list',
  sourceFilter: 'all',
  stage: 'all',
  quickFilter: 'all',
  position: 'all',
  query: '',
  sort: 'score',
  selectedId: null,
  selectedEvalId: null,
  assistantOpen: typeof window !== 'undefined' ? window.innerWidth >= 1360 : true,
  detailOpen: false,
  sendDialogOpen: false,

  load: async (force = false) => {
    set({ loading: true, error: null })
    try {
      const data = (await api.data(force)) as DeskData
      set((state) => {
        const sorted = [...data.pipeline.candidates].sort(sortCandidates(state.sort))
        return {
          pipeline: data.pipeline,
          evalData: data.evalData,
          quota: data.quota,
          loading: false,
          loadedAt: Date.now(),
          selectedId: state.selectedId ?? sorted[0]?.id ?? null,
          selectedEvalId:
            state.selectedEvalId ??
            [...data.evalData.candidates].sort((a, b) => (b.composite ?? b.score) - (a.composite ?? a.score))[0]?.id ??
            null,
        }
      })
    } catch (error) {
      set({ loading: false, error: (error as Error).message })
    }
  },

  checkDoctor: async (force = false) => {
    set({ checkingDoctor: true })
    try {
      const doctor = await api.doctor(force)
      set({ doctor, checkingDoctor: false })
    } catch (error) {
      set({
        doctor: { ok: false, message: (error as Error).message || '检查失败' },
        checkingDoctor: false,
      })
    }
  },

  loadModels: async () => {
    set({ loadingModels: true })
    try {
      const modelsCatalog = await api.models()
      set({ modelsCatalog, loadingModels: false })
    } catch {
      set({ loadingModels: false })
    }
  },

  selectModel: async (provider, model) => {
    const res = await api.selectModel(provider, model)
    set((state) => ({
      modelsCatalog: state.modelsCatalog
        ? { ...state.modelsCatalog, current: res.current }
        : { runtime: 'deepseek-harness', current: res.current, providers: [] },
      doctor: state.doctor
        ? {
            ...state.doctor,
            modelMode: 'llm',
            provider: res.current.provider,
            modelId: res.current.model,
            modelName: `${res.current.provider} / ${res.current.model}`,
          }
        : state.doctor,
    }))
  },

  refresh: async () => {
    set({ refreshing: true })
    try {
      const { pipeline, quota } = await api.refresh()
      set((state) => ({
        pipeline,
        quota,
        refreshing: false,
        loadedAt: Date.now(),
        error: null,
        selectedId: state.selectedId,
      }))
    } catch (error) {
      set({ refreshing: false, error: (error as Error).message })
    }
  },

  syncSourcing: async (payload) => {
    set({ syncingSourcing: true })
    try {
      const res = await api.syncSourcing(payload)
      set({
        pipeline: res.pipeline,
        quota: res.quota,
        syncingSourcing: false,
        loadedAt: Date.now(),
        sourceFilter: payload.tab,
        stage: 'all',
        quickFilter: 'all',
      })
      return { count: res.count, job: res.job, tab: res.tab }
    } catch (error) {
      set({ syncingSourcing: false })
      throw error
    }
  },

  applyPipelinePatch: (pipeline, quota) =>
    set((state) => ({
      ...(pipeline ? { pipeline } : {}),
      ...(quota !== undefined && quota !== null ? { quota } : {}),
      loadedAt: pipeline ? Date.now() : state.loadedAt,
    })),

  toggleTheme: () =>
    set((state) => {
      const next: ThemeMode = state.theme === 'dark' ? 'light' : 'dark'
      applyThemeClass(next)
      return { theme: next }
    }),

  setModule: (module) => set({ module, query: '' }),
  setSourceView: (sourceView) => set({ sourceView }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter, quickFilter: 'all' }),
  setStage: (stage) => set({ stage, quickFilter: 'all' }),
  setQuickFilter: (quickFilter) =>
    set((state) => ({
      quickFilter: state.quickFilter === quickFilter ? 'all' : quickFilter,
      stage: quickFilter === 'high_uncontacted' ? 'all' : state.stage,
    })),
  resetSourceFilters: () => set({ sourceFilter: 'all', stage: 'all', quickFilter: 'all', position: 'all', query: '' }),
  setPosition: (position) => set({ position }),
  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  select: (selectedId) => set({ selectedId, detailOpen: Boolean(selectedId) }),
  selectEval: (selectedEvalId) => set({ selectedEvalId, detailOpen: Boolean(selectedEvalId) }),
  closeDetail: () => set({ detailOpen: false }),
  toggleAssistant: (open) => set((state) => ({ assistantOpen: open ?? !state.assistantOpen })),
  setSendDialogOpen: (sendDialogOpen) => set({ sendDialogOpen }),

  moveStage: async (candidate, stage) => {
    const previous = candidate.stage
    if (previous === stage) return previous
    applyStage(set, candidate.id, stage)
    try {
      const { pipeline } = await api.setStage({
        name: candidate.name,
        job: candidate.job,
        stage,
        score: candidate.score,
      })
      set({ pipeline })
      return previous
    } catch (error) {
      applyStage(set, candidate.id, previous)
      throw error
    }
  },

  sendMessage: async (candidate, text) => {
    const res = await api.send(candidate.name, text)
    if (res.pipeline) {
      set({ pipeline: res.pipeline, ...(res.quota ? { quota: res.quota } : {}) })
      return
    }
    set((state) => {
      if (!state.pipeline) return state
      const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      return {
        pipeline: {
          ...state.pipeline,
          candidates: state.pipeline.candidates.map((item) =>
            item.id === candidate.id
              ? {
                  ...item,
                  stage: item.stage === 'new' ? ('greeted' as Stage) : item.stage,
                  lastText: text,
                  lastTime: now,
                  messages: [...(item.messages || []), { text, time: now, from: 'myself' as const }],
                }
              : item,
          ),
        },
        ...(res.quota ? { quota: res.quota } : {}),
      }
    })
  },

  greetCandidate: async (candidate) => {
    const src = normalizeSource(candidate.source)
    const tab = src === 'featured' ? 'featured' : 'recommend'
    const res = await api.greet({
      name: candidate.name,
      geekId: candidate.geekId || undefined,
      job: candidate.job || undefined,
      tab,
    })
    if (res.pipeline) {
      set({ pipeline: res.pipeline, ...(res.quota ? { quota: res.quota } : {}) })
      return
    }
    set((state) => {
      if (!state.pipeline) return state
      return {
        pipeline: {
          ...state.pipeline,
          candidates: state.pipeline.candidates.map((item) =>
            item.id === candidate.id ? { ...item, stage: 'greeted' as Stage, canGreet: false } : item,
          ),
        },
        ...(res.quota ? { quota: res.quota } : {}),
      }
    })
  },
}))

function applyStage(
  set: (partial: Partial<DeskState> | ((state: DeskState) => Partial<DeskState>)) => void,
  id: string,
  stage: Stage,
) {
  set((state) => {
    if (!state.pipeline) return state
    return {
      pipeline: {
        ...state.pipeline,
        candidates: state.pipeline.candidates.map((c) => (c.id === id ? { ...c, stage } : c)),
      },
    }
  })
}

export function sortCandidates(sort: SortKey) {
  return (a: Candidate, b: Candidate) => {
    if (sort === 'recent') {
      return (b.lastTime || '').localeCompare(a.lastTime || '') || (b.score || 0) - (a.score || 0)
    }
    return (b.score || 0) - (a.score || 0) || (a.name || '').localeCompare(b.name || '')
  }
}

export function matchesQuickFilter(candidate: Candidate, quickFilter: QuickFilterKey): boolean {
  if (quickFilter === 'all') return true
  if (quickFilter === 'high_uncontacted') {
    return (candidate.score ?? 0) >= 70 && ['new', 'screened', 'shortlisted'].includes(candidate.stage)
  }
  if (quickFilter === 'shanghai') {
    const city = resolvedFacts(candidate).city
    return Boolean(city && city.includes('上海'))
  }
  if (quickFilter === 'awaiting_reply') {
    return (
      ['greeted', 'replied'].includes(candidate.stage) ||
      candidate.inferredStage === 'replied' ||
      (candidate.unread ?? 0) > 0
    )
  }
  if (quickFilter === 'has_eval_or_img') {
    return Boolean(candidate.evalId || candidate.hasResumeImage)
  }
  if (quickFilter === 'has_local_resume') {
    return Boolean(candidate.resumePdfFile || candidate.evalPdfPath || candidate.onlineResumeFile)
  }
  if (quickFilter === 'active_now') {
    const status = `${candidate.activeStatus || ''} ${candidate.lastTime || ''}`
    return /在线|刚刚活跃|今日活跃|刚刚/.test(status)
  }
  if (quickFilter === 'not_greeted') {
    return candidate.canGreet !== false && ['new', 'screened', 'shortlisted'].includes(candidate.stage)
  }
  return true
}

export function filterCandidates(
  candidates: Candidate[],
  filters: {
    sourceFilter?: SourceFilterKey
    stage: Stage | 'all'
    quickFilter: QuickFilterKey
    position: string
    query: string
    sort: SortKey
  },
): Candidate[] {
  const q = filters.query.trim().toLowerCase()
  const sf = filters.sourceFilter ?? 'all'
  return candidates
    .filter((c) => (sf === 'all' ? true : normalizeSource(c.source) === sf))
    .filter((c) => (filters.stage === 'all' ? true : c.stage === filters.stage))
    .filter((c) => matchesQuickFilter(c, filters.quickFilter))
    .filter((c) => (filters.position === 'all' ? true : c.positionId === filters.position))
    .filter((c) => {
      if (!q) return true
      return [
        c.name,
        c.job,
        c.summary,
        c.lastText,
        c.activeStatus,
        c.facts?.latestWork,
        c.facts?.school,
        c.facts?.city,
        ...(c.highlights || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
    .sort(sortCandidates(filters.sort))
}

export function topEval(candidates: EvalCandidate[], position: string, query: string): EvalCandidate[] {
  const q = query.trim().toLowerCase()
  return candidates
    .filter((c) => (position === 'all' ? true : c.positionId === position))
    .filter((c) => {
      if (!q) return true
      return [c.name, c.current, c.tagline, c.school, c.intent, c.schoolTag]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
    .sort((a, b) => (b.composite ?? b.score) - (a.composite ?? a.score))
}
