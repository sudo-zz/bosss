export type Stage =
  | 'new'
  | 'screened'
  | 'shortlisted'
  | 'greeted'
  | 'replied'
  | 'interview'
  | 'hold'
  | 'rejected'

export type StageMeta = { key: Stage; label: string; tone: string }

export type CandidateSource = 'message' | 'recommend' | 'featured' | 'external'

export type ChatMessage = {
  text: string
  time?: string
  from: 'friend' | 'myself' | 'system'
}

export type Candidate = {
  id: string
  geekId?: string
  name: string
  job: string
  positionId: string
  stage: Stage
  inferredStage: string
  score?: number
  tier?: string
  tierLabel?: string
  summary?: string
  reason?: string
  facts: {
    age?: string
    exp?: string
    edu?: string
    city?: string
    salary?: string
    roleText?: string
    latestWork?: string
    school?: string
  }
  dimensions?: Record<string, number>
  dimMeta?: Record<string, { label: string; max: number }>
  highlights?: string[]
  risks?: string[]
  messages?: ChatMessage[]
  lastText?: string
  lastTime?: string
  unread?: number
  avatar?: string
  hasResumeImage?: boolean
  resumePdfFile?: string
  evalPdfPath?: string
  onlineResumeFile?: string
  resumeScreenshotFile?: string
  activeStatus?: string
  canGreet?: boolean
  hasViewed?: boolean
  evalId?: string
  source?: CandidateSource | string
  updatedAt?: string
  history?: { at: string; event: string; detail?: string }[]
}

export type Pipeline = {
  meta: {
    product: string
    generatedAt: string
    generatedAtISO: string
    stageMeta: StageMeta[]
    positions: { id: string; name: string; short: string; salary?: string }[]
  }
  stats: {
    total: number
    byStage: Record<string, number>
    byJob: Record<string, number>
    bySource?: Record<CandidateSource, number>
    byJobAndSource?: Record<string, Record<CandidateSource, number>>
    todayNew: number
    awaitingReply: number
    quota?: {
      mode?: string
      quotas?: Record<string, { used: number; limit: number }>
    }
  }
  candidates: Candidate[]
}

export type LocalPdfFile = {
  filename: string
  candidateHint: string
  size: number
  updatedAt: string
  url: string
}

export type OnlineResumeItem = {
  headline?: string
  org?: string
  role?: string
  period?: string
  lines: string[]
  tags?: string[]
}

export type OnlineResumeSection = {
  key: string
  title: string
  items: OnlineResumeItem[]
  paragraphs?: string[]
  tags?: string[]
}

export type OnlineResumeStructured = {
  name: string
  headline?: string
  expectation?: {
    city?: string
    position?: string
    industry?: string
    salary?: string
  }
  sections: OnlineResumeSection[]
  source: 'ocr' | 'text'
  builtAt: string
}

export type OnlineResumeRecord = {
  found: boolean
  candidate: string
  capturedAt?: string
  method?: string
  text?: string
  screenshotFile?: string
  screenshotUrl?: string
  screenshotUrls?: string[]
  structured?: OnlineResumeStructured | null
  fileName?: string
  filePath?: string
}

export type EvalCandidate = {
  id: string
  name: string
  age?: number
  gender?: string
  education?: string
  school?: string
  schoolTag?: string
  major?: string
  years?: string
  current?: string
  location?: string
  intent?: string
  score: number
  status: string
  tagline?: string
  highlights?: string[]
  dimensions?: Record<string, number>
  pros?: string[]
  cons?: string[]
  questions?: string[]
  salaryNote?: string
  riskLevel?: string
  resumePages?: string[]
  pdf?: string
  sourceFile?: string
  rank?: number
  batch?: string
  positionId?: string
  interviewGuide?: { focus?: string; questions?: string[]; watch?: string[] } | string
  jdFit?: string
  interview?: {
    score?: number
    composite?: number
    band?: string
    date?: string
    interviewer?: string
    notes?: string
    conclusion?: string
    [key: string]: unknown
  }
  composite?: number
  compositeBand?: string
  result?: string
  addedAt?: string
}

export type EvalData = {
  meta: {
    position?: string
    company?: string
    city?: string
    salary?: string
    updatedAt?: string
    weights?: Record<string, number>
  }
  statusMeta?: { key: string; label: string; tone?: string }[]
  positions?: {
    id: string
    name: string
    short?: string
    dims?: { k: string; max: number }[]
  }[]
  candidates: EvalCandidate[]
}

export type Quota = {
  date?: string
  mode?: string
  intervalSec?: number
  quotas?: Record<string, { used: number; limit: number }>
}

export type DeskData = {
  pipeline: Pipeline
  evalData: EvalData
  quota: Quota | null
}

export type UpdateStatus = {
  currentVersion: string
  appRoot: string
  installAppDir: string
  dataDir: string
  isDevRepo: boolean
  isInstalledBundle: boolean
  canSelfUpdate: boolean
  config: {
    sourceUrl: string
    githubRepo: string
    hasToken: boolean
    tokenHint: string
  }
}

export type UpdateCheckResult = {
  ok: boolean
  channel: string
  sourceLabel: string
  releaseTag?: string
  releaseUrl?: string
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  publishedAt?: string
  assetName: string
  downloadUrl?: string
  sha256?: string
  size?: number
  notes?: string
  canSelfUpdate: boolean
  isDevRepo: boolean
}

export type UpdateInstallResult = {
  ok: boolean
  previousVersion: string
  updatedVersion: string
  installAppDir: string
  dataPreserved: boolean
  restartRequired: boolean
}
