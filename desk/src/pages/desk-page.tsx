import { useEffect, useMemo } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { AppHeader } from '@/components/app-header'
import { EvalDetail } from '@/components/assess/eval-detail'
import { AssessPanel } from '@/components/assess/assess-panel'
import { AssistantPanel } from '@/components/assistant/assistant-panel'
import { useMediaQuery } from '@/components/motion/effects'
import { CandidateDetail } from '@/components/source/candidate-detail'
import { SourcePanel } from '@/components/source/source-panel'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { STAGE_LABEL } from '@/lib/format'
import { filterCandidates, topEval, useDesk } from '@/store/desk'

export function DeskPage() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const {
    load,
    checkDoctor,
    loadModels,
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
    assistantOpen,
    detailOpen,
    closeDetail,
    toggleAssistant,
    selectedId,
    selectedEvalId,
    select,
    selectEval,
    moveStage,
    setSendDialogOpen,
  } = useDesk()

  useEffect(() => {
    void load()
    void checkDoctor(false)
    void loadModels()
  }, [load, checkDoctor, loadModels])

  const filteredSource = useMemo(
    () => filterCandidates(pipeline?.candidates ?? [], { sourceFilter, stage, quickFilter, position, query, sort }),
    [pipeline?.candidates, sourceFilter, stage, quickFilter, position, query, sort],
  )
  const filteredEval = useMemo(
    () => topEval(evalData?.candidates ?? [], position, query),
    [evalData?.candidates, position, query],
  )

  const candidate = pipeline?.candidates.find((c) => c.id === selectedId) ?? null
  const evalCandidate = evalData?.candidates.find((c) => c.id === selectedEvalId) ?? null

  /** 键盘快捷筛选：/ 聚焦搜索、↑↓ / J K 切换候选人、S 进短名单、M 发消息 */
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
        return
      }

      if (module === 'source' && candidate) {
        if (event.key === 'm' && candidate.stage !== 'rejected') {
          event.preventDefault()
          setSendDialogOpen(true)
        } else if (event.key === 's' && candidate.stage !== 'shortlisted' && candidate.stage !== 'rejected') {
          event.preventDefault()
          void moveStage(candidate, 'shortlisted')
            .then((previous) => {
              toast.success(`${candidate.name} → ${STAGE_LABEL.shortlisted}`, {
                action: { label: '撤销', onClick: () => void moveStage(candidate, previous) },
              })
            })
            .catch((err) => toast.error((err as Error).message || '改阶段失败'))
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [module, filteredSource, filteredEval, selectedId, selectedEvalId, candidate, select, selectEval, moveStage, setSendDialogOpen])

  if (loading && !pipeline) {
    return (
      <div className="flex h-svh flex-col bg-canvas">
        <AppHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <p className="text-[12px]">正在读取本地台账与评估库…</p>
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
          <Button variant="outline" size="sm" onClick={() => load()}>
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
          <SheetContent side="right" className="w-full gap-0 bg-background p-0 sm:max-w-[460px]">
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

        <Sheet open={assistantOpen} onOpenChange={(open) => toggleAssistant(open)}>
          <SheetContent side="right" className="w-full gap-0 bg-background p-0 sm:max-w-[420px]">
            <SheetTitle className="sr-only">招聘助手</SheetTitle>
            <AssistantPanel />
          </SheetContent>
        </Sheet>
      </div>
    )
  }

  return (
    <div className="flex h-svh flex-col bg-canvas">
      <AppHeader />
      <ResizablePanelGroup
        key={assistantOpen ? 'assistant-on' : 'assistant-off'}
        orientation="horizontal"
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={assistantOpen ? '46%' : '54%'} minSize="34%" className="min-w-0">
          <div className="h-full min-h-0 bg-canvas">{module === 'source' ? <SourcePanel /> : <AssessPanel />}</div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={assistantOpen ? '32%' : '46%'} minSize="26%" className="min-w-0">
          <div className="h-full min-h-0 border-l bg-background">
            {module === 'source' ? (
              <CandidateDetail candidate={candidate} />
            ) : (
              <EvalDetail candidate={evalCandidate} />
            )}
          </div>
        </ResizablePanel>

        {assistantOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="22%" minSize="18%" className="min-w-0">
              <div className="h-full min-h-0 border-l bg-background">
                <AssistantPanel />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
