import { useCallback, useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { ApiError, listConversations, type ConversationOut } from './api'
import { RagSidebar } from './RagSidebar'

export interface RagOutletContext {
  reloadConversations: () => Promise<void>
}

export function RagPage() {
  const { id } = useParams<{ id: string }>()
  const [conversations, setConversations] = useState<ConversationOut[]>([])
  const [error, setError] = useState<string | null>(null)

  const reloadConversations = useCallback(async () => {
    try {
      setConversations(await listConversations())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load conversations')
    }
  }, [])

  useEffect(() => {
    reloadConversations()
  }, [reloadConversations])

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <RagSidebar
        conversations={conversations}
        activeId={id ? Number(id) : null}
        error={error}
        onChange={reloadConversations}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <Outlet context={{ reloadConversations } satisfies RagOutletContext} />
      </div>
    </div>
  )
}
