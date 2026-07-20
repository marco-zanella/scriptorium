import ReactMarkdown from 'react-markdown'
import type { CitationOut } from '../../api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToolCallIndicator } from './ToolCallIndicator'

export interface LiveToolCall {
  args: Record<string, unknown>
  status: 'running' | 'done'
}

export function MessageBubble({
  role,
  content,
  status,
  error,
  citations = [],
  toolCalls = [],
  onRetry,
}: {
  role: 'user' | 'assistant'
  content: string | null
  status?: 'pending' | 'streaming' | 'completed' | 'failed' | null
  error?: string | null
  citations?: CitationOut[]
  toolCalls?: LiveToolCall[]
  onRetry?: () => void
}) {
  const isUser = role === 'user'
  const isThinking =
    !isUser &&
    !content &&
    toolCalls.length === 0 &&
    (status === 'pending' || status === 'streaming')

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-2xl space-y-2 rounded-lg px-4 py-3 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {toolCalls.map((call, index) => (
          <ToolCallIndicator key={index} args={call.args} status={call.status} />
        ))}

        {isThinking && <p className="text-sm text-muted-foreground italic">Thinking…</p>}

        {content && (
          <div
            className={`prose prose-sm max-w-none ${
              // bg-primary (the user bubble) is inverted relative to the page
              // background - dark bubble in light mode, light bubble in dark
              // mode - so its prose variant must invert the opposite way of
              // the assistant bubble, which sits on bg-muted and follows the
              // page background normally.
              isUser ? 'prose-invert dark:prose' : 'dark:prose-invert'
            }`}
          >
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}

        {status === 'failed' && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error ?? 'Something went wrong.'}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        )}

        {citations.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {citations.map((citation) => (
              <Badge key={citation.id} variant="secondary">
                {citation.book} {citation.chapter}:{citation.verse}
                {citation.source ? ` (${citation.source})` : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
