import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

/**
 * 动效实现参考 transitions.dev 的公开效果：
 * - number-pop-in：数字换值时沿 3D 鼓面滚入
 * - text-states-swap：状态文案带模糊切换
 * - shimmer-text：遮罩渐变扫过文字
 * - reasoning-stream：推理步骤两行滚动
 * - streaming-text：逐词从模糊中浮现
 * 统一由 Motion 驱动，不引入第二套动画库。
 */

export function NumberPopIn({
  value,
  className,
  suffix,
}: {
  value: number | string
  className?: string
  suffix?: React.ReactNode
}) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'baseline', perspective: 400 }}>
      <span className="relative inline-block overflow-hidden" style={{ lineHeight: 1.05 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={String(value)}
            initial={{ y: '0.7em', opacity: 0, rotateX: -55 }}
            animate={{ y: 0, opacity: 1, rotateX: 0 }}
            exit={{ y: '-0.7em', opacity: 0, rotateX: 55 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="inline-block tabular-nums"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      {suffix}
    </span>
  )
}

export function ShimmerText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.span
      className={className}
      style={{
        display: 'inline-block',
        backgroundImage:
          'linear-gradient(100deg, currentColor 20%, color-mix(in oklab, currentColor 35%, transparent) 42%, currentColor 64%)',
        backgroundSize: '220% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
      animate={{ backgroundPosition: ['120% 0%', '-120% 0%'] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
    >
      {children}
    </motion.span>
  )
}

export function ThinkingStates({ steps, className }: { steps: string[]; className?: string }) {
  const last = steps[steps.length - 1] || '正在思考'
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 20 }}>
      <span className="size-1.5 shrink-0 rounded-full bg-foreground/50" />
      <span className="relative inline-flex h-4 items-center overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={last}
            initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="text-[11.5px] text-muted-foreground"
          >
            <ShimmerText>{last}</ShimmerText>
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  )
}

export function ReasoningStream({ steps, className }: { steps: string[]; className?: string }) {
  const visible = steps.slice(-3)
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        maxHeight: 44,
        overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, transparent, black 35%, black 78%, transparent)',
      }}
    >
      <AnimatePresence initial={false}>
        {visible.map((step, index) => (
          <motion.div
            key={`${step}-${index}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: index === visible.length - 1 ? 0.9 : 0.45, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="text-[11px] leading-[1.5] text-muted-foreground"
          >
            {step}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function StreamingText({ text, animate = true }: { text: string; animate?: boolean }) {
  const tokens = useMemo(() => text.match(/[\u4e00-\u9fa5]{1,2}|[A-Za-z0-9]+|\s+|[^\s]/g) || [], [text])
  if (!animate) return <>{text}</>

  return (
    <span>
      {tokens.map((token, index) => (
        <motion.span
          key={`${index}-${token}`}
          initial={{ opacity: 0, filter: 'blur(5px)', y: 2 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          style={{ display: 'inline-block', whiteSpace: 'pre-wrap' }}
        >
          {token}
        </motion.span>
      ))}
    </span>
  )
}

/** 卡片内容切换时的轻微上浮，用于详情面板换人 */
export function PanelSwap({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex h-full min-h-0 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** 简单可靠的媒体查询，用于桌面分栏与窄屏抽屉的切换 */
export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatch(list.matches)
    list.addEventListener('change', onChange)
    onChange()
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return match
}
