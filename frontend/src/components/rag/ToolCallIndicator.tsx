import { Search } from 'lucide-react'

export function ToolCallIndicator({
  args,
  status,
}: {
  args: Record<string, unknown>
  status: 'running' | 'done'
}) {
  const query = typeof args.query === 'string' ? args.query : ''

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Search className={status === 'running' ? 'size-4 animate-pulse' : 'size-4'} />
      <span>
        {status === 'running' ? 'Searching' : 'Searched'} scripture for &ldquo;{query}&rdquo;
      </span>
    </div>
  )
}
