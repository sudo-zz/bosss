import { MapPin, SlidersHorizontal, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { EMPTY_ADVANCED, type AdvancedFilters } from '@/store/desk'

const WITHIN_OPTIONS = [
  { value: 'all', label: '不限时间' },
  { value: '1', label: '今天活跃' },
  { value: '3', label: '近 3 天' },
  { value: '7', label: '近 7 天' },
  { value: '30', label: '近 30 天' },
]

const EDU_OPTIONS = ['all', '大专', '本科', '硕士', '博士']

export function advancedFilterCount(advanced: AdvancedFilters): number {
  let count = 0
  if (advanced.scoreMin.trim() || advanced.scoreMax.trim()) count += 1
  if (advanced.city !== 'all') count += 1
  if (advanced.edu !== 'all') count += 1
  if (advanced.within !== 'all') count += 1
  return count
}

export function AdvancedFilterButton({
  advanced,
  cities,
  matched,
  onChange,
  onReset,
}: {
  advanced: AdvancedFilters
  cities: string[]
  matched: number
  onChange: (patch: Partial<AdvancedFilters>) => void
  onReset: () => void
}) {
  const activeCount = advancedFilterCount(advanced)

  const setScorePreset = (min: string, max: string) => {
    const same = advanced.scoreMin === min && advanced.scoreMax === max
    onChange(same ? { scoreMin: '', scoreMax: '' } : { scoreMin: min, scoreMax: max })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          className={cn(
            'h-7.5 gap-1 bg-card px-2 text-[11.5px] shadow-2xs',
            activeCount > 0 && 'border-foreground/30 bg-foreground text-background hover:bg-foreground/90',
          )}
        >
          <SlidersHorizontal className="size-3" />
          高级筛选
          {activeCount > 0 && (
            <span className="rounded bg-background/20 px-1 text-[10px] leading-4 tabular-nums">{activeCount}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[318px] p-3.5">
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-[11.5px] text-muted-foreground">匹配分数</Label>
            <div className="flex items-center gap-1.5">
              <Input
                inputMode="numeric"
                value={advanced.scoreMin}
                onChange={(event) => onChange({ scoreMin: event.target.value.replace(/[^\d]/g, '') })}
                placeholder="最低分"
                className="h-7.5 text-[12px]"
              />
              <span className="text-[11px] text-muted-foreground">—</span>
              <Input
                inputMode="numeric"
                value={advanced.scoreMax}
                onChange={(event) => onChange({ scoreMax: event.target.value.replace(/[^\d]/g, '') })}
                placeholder="最高分"
                className="h-7.5 text-[12px]"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { label: '≥ 80', min: '80', max: '' },
                { label: '70 - 79', min: '70', max: '79' },
                { label: '60 - 69', min: '60', max: '69' },
              ].map((preset) => {
                const active = advanced.scoreMin === preset.min && advanced.scoreMax === preset.max
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setScorePreset(preset.min, preset.max)}
                    className={cn(
                      'h-6 rounded-md border px-2 text-[11px] tabular-nums transition-colors',
                      active
                        ? 'border-foreground/30 bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <MapPin className="size-3" />
              城市
            </Label>
            <Select value={advanced.city} onValueChange={(value) => onChange({ city: value })}>
              <SelectTrigger size="sm" className="h-7.5 w-full text-[12px]">
                <SelectValue placeholder="全部城市" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部城市</SelectItem>
                {cities.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11.5px] text-muted-foreground">学历</Label>
              <Select value={advanced.edu} onValueChange={(value) => onChange({ edu: value })}>
                <SelectTrigger size="sm" className="h-7.5 w-full text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDU_OPTIONS.map((edu) => (
                    <SelectItem key={edu} value={edu}>
                      {edu === 'all' ? '不限学历' : edu}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11.5px] text-muted-foreground">活跃时间</Label>
              <Select value={advanced.within} onValueChange={(value) => onChange({ within: value })}>
                <SelectTrigger size="sm" className="h-7.5 w-full text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WITHIN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-2.5">
            <span className="text-[11px] text-muted-foreground tabular-nums">命中 {matched} 人</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={onReset}
                disabled={activeCount === 0}
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              >
                <X className="size-3" />
                清空
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { EMPTY_ADVANCED }
