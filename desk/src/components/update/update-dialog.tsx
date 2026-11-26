import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCw,
  Settings2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { UpdateCheckResult, UpdateInstallResult, UpdateStatus } from '@/types'

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const str = String(reader.result || '')
      const idx = str.indexOf(',')
      resolve(idx >= 0 ? str.slice(idx + 1) : str)
    }
    reader.onerror = () => reject(new Error('读取压缩包失败'))
    reader.readAsDataURL(file)
  })
}

export function UpdateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <UpdateDialogBody /> : null}
    </Dialog>
  )
}

function UpdateDialogBody() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)

  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const [installing, setInstalling] = useState(false)
  const [installResult, setInstallResult] = useState<UpdateInstallResult | null>(null)
  const [restarting, setRestarting] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .updateStatus()
      .then((res) => {
        if (cancelled) return
        setStatus(res)
        setSourceUrl(res.config.sourceUrl || '')
        setLoadingStatus(false)
      })
      .catch((err) => {
        if (cancelled) return
        setCheckError((err as Error).message || '读取版本状态失败')
        setLoadingStatus(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      const payload: { sourceUrl: string; githubToken?: string } = { sourceUrl: sourceUrl.trim() }
      if (githubToken.trim()) payload.githubToken = githubToken.trim()
      const res = await api.updateSaveConfig(payload)
      setStatus(res.status)
      setGithubToken('')
      toast.success('已保存更新源配置')
    } catch (err) {
      toast.error((err as Error).message || '保存配置失败')
    } finally {
      setSavingConfig(false)
    }
  }

  const clearToken = async () => {
    setSavingConfig(true)
    try {
      const res = await api.updateSaveConfig({ githubToken: '' })
      setStatus(res.status)
      toast.success('已清除已保存的 GitHub Token')
    } catch (err) {
      toast.error((err as Error).message || '清除失败')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleCheck = async () => {
    setChecking(true)
    setCheckError(null)
    setInstallResult(null)
    try {
      // 若用户刚在输入框填了更新地址或 Token，先一并保存
      const trimmedUrl = sourceUrl.trim()
      const trimmedToken = githubToken.trim()
      if (trimmedUrl !== (status?.config.sourceUrl || '') || trimmedToken) {
        const saved = await api.updateSaveConfig({
          sourceUrl: trimmedUrl,
          ...(trimmedToken ? { githubToken: trimmedToken } : {}),
        })
        setStatus(saved.status)
        setGithubToken('')
      }
      const res = await api.updateCheck()
      setCheckResult(res)
      if (!res.hasUpdate) {
        toast.success(`当前已是最新版本（v${res.currentVersion}）`)
      }
    } catch (err) {
      const msg = (err as Error).message || '检查更新失败'
      setCheckError(msg)
      setCheckResult(null)
      setShowSettings(true)
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    setCheckError(null)
    try {
      const res = await api.updateInstall()
      setInstallResult(res)
      toast.success(`已更新到 v${res.updatedVersion}`, {
        description: '本地简历、PDF、在线简历与台账数据已完整保留，点击「立即重启生效」即可使用新版本。',
      })
    } catch (err) {
      const msg = (err as Error).message || '安装更新失败'
      setCheckError(msg)
      toast.error(msg)
    } finally {
      setInstalling(false)
    }
  }

  const handleUploadTarball = async (file: File | null | undefined) => {
    if (!file) return
    if (!file.name.endsWith('.tar.gz') && !file.name.endsWith('.tgz')) {
      toast.error('请选择 .tar.gz 格式的安装包文件')
      return
    }
    setInstalling(true)
    setCheckError(null)
    try {
      const dataBase64 = await readFileBase64(file)
      const res = await api.updateUpload({ filename: file.name, dataBase64 })
      setInstallResult(res)
      toast.success(`离线包安装成功：v${res.previousVersion} → v${res.updatedVersion}`)
    } catch (err) {
      const msg = (err as Error).message || '离线包安装失败'
      setCheckError(msg)
      toast.error(msg)
    } finally {
      setInstalling(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await api.updateRestart()
    } catch {
      /* 进程重启时会断开连接，属正常现象 */
    }
    // 轮询等待新版本服务重新就绪后自动刷新页面
    const deadline = Date.now() + 25_000
    const poll = async () => {
      await new Promise((r) => setTimeout(r, 900))
      while (Date.now() < deadline) {
        try {
          const ping = await api.ping()
          if (ping.ok) {
            window.location.reload()
            return
          }
        } catch {
          /* 服务重启中 */
        }
        await new Promise((r) => setTimeout(r, 800))
      }
      setRestarting(false)
      toast.info('重启等待超时，请手动刷新页面或在终端重新运行 boss-dsh')
    }
    void poll()
  }

  const sizeKb = checkResult?.size ? `${(checkResult.size / 1024).toFixed(0)} KB` : ''

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-[15px]">
          <ArrowDownToLine className="size-4 text-primary" />
          检查更新
          {status && (
            <Badge variant="outline" className="h-5 rounded px-1.5 text-[10.5px] font-normal tabular-nums">
              v{status.currentVersion}
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription className="text-[12px]">
          检查并拉取最新安装包完成替换，仅更新程序本身。
        </DialogDescription>
      </DialogHeader>

      {loadingStatus ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          读取版本信息…
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* 数据安全保证提示 */}
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] px-3 py-2.5 text-[11.5px] leading-relaxed text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <div>
              <span className="font-medium">数据零影响保证：</span>
              更新仅原子替换程序目录，绝不改动 <code className="rounded bg-emerald-500/10 px-1">~/.boss-cli/</code>{' '}
              里的 PDF 简历、在线简历存档、候选人台账与头像，以及 DSH 模型配置。
            </div>
          </div>

          {status?.isDevRepo && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-300">
              当前处于本地 Git 开发源码目录，仅可测试检查更新；为保护源码不会覆盖当前目录（在人事电脑安装的发行版中可直接一键安装并重启）。
            </div>
          )}

          {/* 主操作区 */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleCheck()} disabled={checking || installing || restarting} className="gap-1.5">
              {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {checking ? '正在检查更新…' : '立即检查更新'}
            </Button>

            <input
              ref={fileRef}
              type="file"
              accept=".gz,.tgz,application/gzip"
              className="hidden"
              onChange={(e) => void handleUploadTarball(e.target.files?.[0])}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={checking || installing || restarting || Boolean(status?.isDevRepo)}
              onClick={() => fileRef.current?.click()}
              className="gap-1.5"
            >
              <Upload className="size-3.5" />
              上传离线包更新
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSettings((s) => !s)}
              className="ml-auto gap-1 text-[11.5px] text-muted-foreground"
            >
              <Settings2 className="size-3.5" />
              更新源设置
            </Button>
          </div>

          {/* 检查结果卡片 */}
          {checkResult && !installResult && (
            <div
              className={cn(
                'space-y-2.5 rounded-xl border p-3.5',
                checkResult.hasUpdate ? 'border-primary/30 bg-primary/[0.04]' : 'bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">
                    {checkResult.hasUpdate ? `发现新版本 v${checkResult.latestVersion}` : `已是最新版本 v${checkResult.currentVersion}`}
                  </span>
                  {sizeKb && (
                    <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] font-normal tabular-nums">
                      {sizeKb}
                    </Badge>
                  )}
                </div>
                <span className="text-[10.5px] text-muted-foreground">{checkResult.sourceLabel}</span>
              </div>

              {checkResult.notes && (
                <div className="max-h-28 overflow-y-auto rounded-lg border bg-background/80 p-2 text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {checkResult.notes}
                </div>
              )}

              {checkResult.hasUpdate && (
                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <Button
                    size="sm"
                    onClick={() => void handleInstall()}
                    disabled={installing || Boolean(status?.isDevRepo)}
                    className="gap-1.5"
                  >
                    {installing ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}
                    {installing ? '正在下载、校验并安装…' : `下载并安装 v${checkResult.latestVersion}`}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* 安装成功 + 一键重启生效 */}
          {installResult && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/[0.06] p-3.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                更新已安装完成：v{installResult.previousVersion} → v{installResult.updatedVersion}
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                新版本程序已就位，所有本地简历与候选人台账原封不动。点击下方按钮自动重启服务并刷新页面即可生效。
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void handleRestart()} disabled={restarting} className="gap-1.5">
                  {restarting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                  {restarting ? '正在重启并自动刷新…' : '立即重启生效'}
                </Button>
              </div>
            </div>
          )}

          {checkError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-[11.5px] leading-relaxed text-destructive">
              {checkError}
            </div>
          )}

          {/* 更新源设置（局域网地址 / GitHub Token） */}
          {showSettings && (
            <div className="space-y-3 rounded-xl border bg-muted/25 p-3">
              <div className="space-y-1">
                <label className="text-[11.5px] font-medium">
                  局域网更新地址（推荐：免登录 GitHub，留空则走 GitHub Release）
                </label>
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="例如：http://192.168.1.10:8788"
                  className="h-8 bg-background text-[12px]"
                />
                <p className="text-[10.5px] text-muted-foreground">
                  开发机运行 <code className="rounded bg-muted px-1">npm run release:serve</code> 后会打印该地址，填入一次即可永久记住。
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11.5px] font-medium">GitHub Token（仅私有仓库直连 GitHub 时需要）</label>
                  {status?.config.hasToken && (
                    <button
                      type="button"
                      onClick={() => void clearToken()}
                      className="text-[10.5px] text-muted-foreground underline hover:text-foreground"
                    >
                      清除已存 Token（{status.config.tokenHint}）
                    </button>
                  )}
                </div>
                <Input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={status?.config.hasToken ? '已保存 Token（如需更换请输入新值）' : 'ghp_...（可留空）'}
                  className="h-8 bg-background text-[12px]"
                />
              </div>

              <div className="flex justify-end">
                <Button size="xs" variant="outline" onClick={() => void saveConfig()} disabled={savingConfig}>
                  {savingConfig ? '保存中…' : '保存设置'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  )
}
