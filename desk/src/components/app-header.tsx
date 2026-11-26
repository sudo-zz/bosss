import { useState } from 'react'
import { ArrowDownToLine, Moon, RefreshCw, Search, Sun, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UpdateDialog } from '@/components/update/update-dialog'
import { cn } from '@/lib/utils'
import { useDesk } from '@/store/desk'

export function AppHeader() {
  const {
    module,
    setModule,
    query,
    setQuery,
    refresh,
    refreshing,
    liveConnected,
    pipeline,
    evalData,
    theme,
    toggleTheme,
  } = useDesk()
  const [updateOpen, setUpdateOpen] = useState(false)

  return (
    <header className="flex h-13 shrink-0 items-center gap-2.5 border-b bg-background/95 px-4 backdrop-blur-xs">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-[12px] font-semibold text-background shadow-xs">
          招
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-[13.5px] font-semibold tracking-tight">招聘助手</div>
          <div className="hidden text-[10px] text-muted-foreground lg:block">本地候选人展示看板</div>
        </div>
      </div>

      <Tabs value={module} onValueChange={(value) => setModule(value as 'source' | 'assess')} className="ml-1.5">
        <TabsList className="h-8 bg-muted/70 p-0.5">
          <TabsTrigger value="source" className="gap-1.5 px-3 text-[12.5px] data-[state=active]:shadow-2xs">
            简历筛选
            <span className="rounded bg-foreground/7 px-1 py-0.2 text-[10px] text-muted-foreground tabular-nums">
              {pipeline?.stats.total ?? 0}
            </span>
          </TabsTrigger>
          <TabsTrigger value="assess" className="gap-1.5 px-3 text-[12.5px] data-[state=active]:shadow-2xs">
            面试评估
            <span className="rounded bg-foreground/7 px-1 py-0.2 text-[10px] text-muted-foreground tabular-nums">
              {evalData?.candidates.length ?? 0}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative ml-auto w-[220px] max-w-[38vw] lg:w-[280px]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="desk-global-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={module === 'source' ? '搜姓名、岗位、亮点、消息…' : '搜姓名、学校、方向、亮点…'}
          className="h-8 bg-muted/40 pr-7 pl-8 text-[12px] transition-colors focus:bg-background"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清空搜索"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border bg-background px-1 text-[9.5px] font-medium text-muted-foreground/80 sm:inline-block">
            /
          </kbd>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className={cn(
              'hidden h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors md:inline-flex',
              liveConnected
                ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-300'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted/70',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                refreshing ? 'animate-pulse bg-sky-500' : liveConnected ? 'bg-emerald-500' : 'bg-zinc-400',
              )}
            />
            {refreshing ? '同步中' : liveConnected ? '实时同步' : '手动同步'}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          <div className="space-y-0.5 text-[11px]">
            <div className="font-medium">
              {liveConnected ? '正在监听 ~/.boss-cli/ 数据目录' : '实时监听未连接，点击手动刷新'}
            </div>
            <div className="opacity-80">
              当你的 Agent（如 WorkBuddy）写入新简历或台账时，页面会自动无感刷新。
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={() => setUpdateOpen(true)} aria-label="检查更新">
            <ArrowDownToLine className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>检查更新（安全更新程序，不影响简历与台账数据）</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{theme === 'dark' ? '切换浅色主题' : '切换深色主题'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="重新读取本地数据"
          >
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>立即重新读取本地数据</TooltipContent>
      </Tooltip>

      <UpdateDialog open={updateOpen} onOpenChange={setUpdateOpen} />
    </header>
  )
}
