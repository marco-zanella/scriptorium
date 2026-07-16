import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { FacetBucket } from './api'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'

const VISIBLE_ROWS = 8
const ROW_HEIGHT_PX = 28

export function FacetFilterGroup({
  title,
  buckets,
  selected,
  onToggle,
}: {
  title: string
  buckets: FacetBucket[]
  selected: string[]
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [filter, setFilter] = useState('')

  if (buckets.length === 0) return null

  const filtered = buckets.filter((bucket) =>
    bucket.key.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-left font-medium text-foreground">
        {title}
        <ChevronDown className={`size-4 transition-transform ${open ? '' : '-rotate-90'}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {buckets.length > VISIBLE_ROWS && (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${title.toLowerCase()}...`}
            aria-label={`Filter ${title.toLowerCase()}`}
            className="h-7 text-xs"
          />
        )}
        <div
          className="space-y-1.5 overflow-y-auto pr-1"
          style={{ maxHeight: VISIBLE_ROWS * ROW_HEIGHT_PX }}
        >
          {filtered.length === 0 && <p className="text-xs text-muted-foreground">No matches.</p>}
          {filtered.map((bucket) => (
            <label key={bucket.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(bucket.key)}
                onCheckedChange={() => onToggle(bucket.key)}
              />
              <span className="flex-1 truncate">{bucket.key}</span>
              <span className="text-muted-foreground">{bucket.count}</span>
            </label>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
