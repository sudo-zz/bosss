import { useEffect, useMemo } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { AppHeader } from '@/components/app-header'
import { EvalDetail } from '@/components/assess/eval-detail'
import { AssessPanel } from '@/components/assess/assess-panel'
import { useMediaQuery } from '@/components/motion/effects'
import { CandidateDetail } from '@/components/source/candidate-detail'
import { SourcePanel } from '@/components/source/source-panel'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { subscribeDataEvents } from '@/lib/api'
import { filterCandidates, topEval, useDesk } from '@/store/desk'

export function DeskPage() {
  // 右侧浏览器分屏通常只有 700-900px：这个宽度也要用双栏，详情才不会以 Sheet 盖住列表分数列
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const {
    load,
    setLiveConnected,
    loading,
    error,
    pipeline,
    evalData,
    module,
    sourceFilter,
    stage,
    quickFilter,
    position,
    query,
    sort,
    advanced,
    detailOpen,
    closeDetail,
    selectedId,
    selectedEvalId,
    select,
    selectEval,
  } = useDesk()

  useEffect(() => {
    void load(false)
    const unsubscribe = subscribeDataEvents({
      onReady: () => setLiveConnected(true),
      onUpdate: () => void load(true),
      onError: () => setLiveConnected(false),
    })
    return unsubscribe
  }, [load, setLiveConnected])

  const filteredSource = useMemo(
    () =>
      filterCandidates(pipeline?.candidates ?? [], {
        sourceFilter,
        stage,
        quickFilter,
        position,
        query,
        sort,
        advanced,
      }),
    [pipeline?.candidates, sourceFilter, stage, quickFilter, position, query, sort, advanced],
  )
  const filteredEval = useMemo(
    () => topEval(evalData?.candidates ?? [], position, query),
    [evalData?.candidates, position, query],
  )

  const candidate = pipeline?.candidates.find((c) => c.id === selectedId) ?? null
  const evalCandidate = evalData?.candidates.find((c) => c.id === selectedEvalId) ?? null

  /** 键盘快捷浏览：/ 聚焦搜索、↑↓ / J K 切换候选人 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const editing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (event.key === '/' && !editing) {
        event.preventDefault()
        const input = document.getElementById('desk-global-search') as HTMLInputElement | null
        input?.focus()
        input?.select()
        return
      }
      if (editing) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return

      const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        if (module === 'source' && filteredSource.length > 0) {
          const idx = filteredSource.findIndex((c) => c.id === selectedId)
          const nextIdx = idx < 0 ? 0 : Math.max(0, Math.min(filteredSource.length - 1, idx + step))
          select(filteredSource[nextIdx]!.id)
        } else if (module === 'assess' && filteredEval.length > 0) {
          const idx = filteredEval.findIndex((c) => c.id === selectedEvalId)
          const nextIdx = idx < 0 ? 0 : Math.max(0, Math.min(filteredEval.length - 1, idx + step))
          selectEval(filteredEval[nextIdx]!.id)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [module, filteredSource, filteredEval, selectedId, selectedEvalId, select, selectEval])

  if (loading && !pipeline) {
    return (
      <div className="flex h-svh flex-col bg-canvas">
        <AppHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <p className="text-[12px]">正在读取本地候选人与简历档案…</p>
        </div>
      </div>
    )
  }

  if (error && !pipeline) {
    return (
      <div className="flex h-svh flex-col bg-canvas">
        <AppHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-[12.5px] text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load(false)}>
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (!isDesktop) {
    return (
      <div className="flex h-svh flex-col bg-canvas">
        <AppHeader />
        <div className="min-h-0 flex-1">{module === 'source' ? <SourcePanel /> : <AssessPanel />}</div>

        <Sheet open={detailOpen} onOpenChange={(open) => !open && closeDetail()}>
          <SheetContent side="right" className="w-full gap-0 bg-background p-0 sm:max-w-[520px]">
            <SheetTitle className="sr-only">候选人详情</SheetTitle>
            <div className="flex h-full flex-col">
              {module === 'source' ? (
                <CandidateDetail candidate={candidate} />
              ) : (
                <EvalDetail candidate={evalCandidate} />
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  return (
    <div className="flex h-svh flex-col bg-canvas">
      <AppHeader />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="54%" minSize="36%" className="min-w-0">
          <div className="h-full min-h-0 bg-canvas">{module === 'source' ? <SourcePanel /> : <AssessPanel />}</div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="46%" minSize="30%" className="min-w-0">
          <div className="h-full min-h-0 border-l bg-background">
            {module === 'source' ? (
              <CandidateDetail candidate={candidate} />
            ) : (
              <EvalDetail candidate={evalCandidate} />
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
