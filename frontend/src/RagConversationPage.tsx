import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import {
  ApiError,
  getConversation,
  listMessages,
  streamMessage,
  type CitationOut,
  type ConversationOut,
  type MessageOut,
} from './api'
import { type LiveToolCall, MessageBubble } from './components/rag/MessageBubble'
import type { RagOutletContext } from './RagPage'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'

interface LiveAssistant {
  content: string
  toolCalls: LiveToolCall[]
  citations: CitationOut[]
}

export function RagConversationPage() {
  const { id } = useParams<{ id: string }>()
  const conversationId = Number(id)
  const { reloadConversations } = useOutletContext<RagOutletContext>()

  const [conversation, setConversation] = useState<ConversationOut | null>(null)
  const [messages, setMessages] = useState<MessageOut[]>([])
  const [input, setInput] = useState('')
  const [pendingUserContent, setPendingUserContent] = useState<string | null>(null)
  const [liveAssistant, setLiveAssistant] = useState<LiveAssistant | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      const [conv, msgs] = await Promise.all([
        getConversation(conversationId),
        listMessages(conversationId),
      ])
      setConversation(conv)
      setMessages(msgs)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load conversation')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, liveAssistant, pendingUserContent])

  async function send(content: string) {
    if (!content.trim() || sending) return
    setPendingUserContent(content)
    setLiveAssistant({ content: '', toolCalls: [], citations: [] })
    setSending(true)
    setError(null)

    try {
      await streamMessage(conversationId, content, (event) => {
        if (event.type === 'token') {
          setLiveAssistant((prev) => (prev ? { ...prev, content: prev.content + event.text } : prev))
        } else if (event.type === 'tool_call') {
          setLiveAssistant((prev) => {
            if (!prev) return prev
            const toolCalls = [...prev.toolCalls]
            if (event.status === 'running') {
              toolCalls.push({ args: event.args, status: 'running' })
            } else {
              const runningIndex = toolCalls.map((c) => c.status).lastIndexOf('running')
              if (runningIndex !== -1) toolCalls[runningIndex] = { args: event.args, status: 'done' }
            }
            return { ...prev, toolCalls }
          })
        } else if (event.type === 'citations') {
          setLiveAssistant((prev) => {
            if (!prev) return prev
            const seen = new Set(prev.citations.map((c) => c.id))
            return {
              ...prev,
              citations: [...prev.citations, ...event.citations.filter((c) => !seen.has(c.id))],
            }
          })
        }
        // 'done'/'error' don't need handling here - the reload in `finally`
        // below picks up the authoritative persisted row either way.
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send message')
    } finally {
      setPendingUserContent(null)
      setLiveAssistant(null)
      setSending(false)
      await load()
      await reloadConversations()
    }
  }

  async function submitInput() {
    const content = input
    setInput('')
    await send(content)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await submitInput()
  }

  if (!conversation) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <h1 className="font-heading text-xl leading-snug font-medium">
        {conversation.title ?? 'Untitled conversation'}
      </h1>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
        <div className="space-y-4 p-4">
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
              status={message.status}
              error={message.error}
              citations={message.citations}
              onRetry={
                message.status === 'failed' && messages[index - 1]?.role === 'user'
                  ? () => send(messages[index - 1].content ?? '')
                  : undefined
              }
            />
          ))}
          {pendingUserContent && <MessageBubble role="user" content={pendingUserContent} />}
          {liveAssistant && (
            <MessageBubble
              role="assistant"
              content={liveAssistant.content}
              status="streaming"
              citations={liveAssistant.citations}
              toolCalls={liveAssistant.toolCalls}
            />
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitInput()
            }
          }}
          placeholder="Ask about the text…"
          disabled={sending}
          className="flex-1"
          aria-label="Message"
        />
        <Button type="submit" disabled={sending || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  )
}
