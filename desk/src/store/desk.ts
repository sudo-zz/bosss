import { create } from 'zustand'
import { api } from '@/lib/api'
import { normalizeSource, resolvedFacts } from '@/lib/format'
import type {
  Candidate,
  CandidateSource,
  DeskData,
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
  loading: boolean
  refreshing: boolean
  liveConnected: boolean
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
  detailOpen: boolean

  load: (silent?: boolean) => Promise<void>
  refresh: () => Promise<void>
  setLiveConnected: (connected: boolean) => void
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
}

const initialTheme = readInitialTheme()
applyThemeClass(initialTheme)

export const useDesk = create<DeskState>((set) => ({
  pipeline: null,
  evalData: null,
  quota: null,
  loading: false,
  refreshing: false,
  liveConnected: false,
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
  detailOpen: false,

  load: async (silent = false) => {
    if (!silent) set({ loading: true, error: null })
    try {
      const data = (await api.data()) as DeskData
      set((state) => {
        const sorted = [...data.pipeline.candidates].sort(sortCandidates(state.sort))
        const keepSelected =
          state.selectedId && data.pipeline.candidates.some((c) => c.id === state.selectedId)
            ? state.selectedId
            : sorted[0]?.id ?? null
        const keepEval =
          state.selectedEvalId && data.evalData.candidates.some((c) => c.id === state.selectedEvalId)
            ? state.selectedEvalId
            : [...data.evalData.candidates].sort((a, b) => (b.composite ?? b.score) - (a.composite ?? a.score))[0]?.id ??
              null
        return {
          pipeline: data.pipeline,
          evalData: data.evalData,
          quota: data.quota,
          loading: false,
          refreshing: false,
          error: null,
          loadedAt: Date.now(),
          selectedId: keepSelected,
          selectedEvalId: keepEval,
        }
      })
    } catch (error) {
      if (!silent) {
        set({ loading: false, refreshing: false, error: (error as Error).message })
      }
    }
  },

  refresh: async () => {
    set({ refreshing: true })
    try {
      const data = (await api.data()) as DeskData
      set((state) => ({
        pipeline: data.pipeline,
        evalData: data.evalData,
        quota: data.quota,
        refreshing: false,
        loadedAt: Date.now(),
        error: null,
        selectedId:
          state.selectedId && data.pipeline.candidates.some((c) => c.id === state.selectedId)
            ? state.selectedId
            : data.pipeline.candidates[0]?.id ?? null,
      }))
    } catch (error) {
      set({ refreshing: false, error: (error as Error).message })
    }
  },

  setLiveConnected: (liveConnected) => set({ liveConnected }),

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
}))

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
