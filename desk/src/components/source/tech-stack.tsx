import {
  siDocker,
  siFastapi,
  siJavascript,
  siKubernetes,
  siLangchain,
  siLinux,
  siMysql,
  siNodedotjs,
  siPostgresql,
  siPython,
  siReact,
  siRedis,
  siSpring,
  siTypescript,
  siVuedotjs,
} from 'simple-icons'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * 技术栈图标来自 Simple Icons（CC0）。
 * Lucide 负责界面图标，Simple Icons 只补它没有的品牌标识，两者不重叠。
 */
const STACKS = [
  { label: 'Python', icon: siPython, pattern: /python/i },
  { label: 'LangChain', icon: siLangchain, pattern: /langchain/i },
  { label: 'FastAPI', icon: siFastapi, pattern: /fastapi/i },
  { label: 'React', icon: siReact, pattern: /\breact\b/i },
  { label: 'Vue', icon: siVuedotjs, pattern: /\bvue\b/i },
  { label: 'TypeScript', icon: siTypescript, pattern: /typescript|\bts\b/i },
  { label: 'JavaScript', icon: siJavascript, pattern: /javascript|\bjs\b/i },
  { label: 'Node.js', icon: siNodedotjs, pattern: /node\.?js/i },
  { label: 'Java / Spring', icon: siSpring, pattern: /spring|java\b/i },
  { label: 'MySQL', icon: siMysql, pattern: /mysql/i },
  { label: 'PostgreSQL', icon: siPostgresql, pattern: /postgres/i },
  { label: 'Redis', icon: siRedis, pattern: /redis/i },
  { label: 'Docker', icon: siDocker, pattern: /docker/i },
  { label: 'Kubernetes', icon: siKubernetes, pattern: /k8s|kubernetes/i },
  { label: 'Linux', icon: siLinux, pattern: /linux|ubuntu|centos/i },
]

export function TechStack({ text, className }: { text: string; className?: string }) {
  const hits = STACKS.filter((stack) => stack.pattern.test(text)).slice(0, 8)
  if (!hits.length) return null

  return (
    <div className={className}>
      <h3 className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">技术栈</h3>
      <div className="mt-2" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {hits.map((stack) => (
        <Tooltip key={stack.label}>
          <TooltipTrigger asChild>
            <span className="flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:text-foreground">
              <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-label={stack.label} role="img">
                <path d={stack.icon.path} />
              </svg>
            </span>
          </TooltipTrigger>
          <TooltipContent>{stack.label}</TooltipContent>
        </Tooltip>
      ))}
      </div>
    </div>
  )
}
