import { useNavigate, useOutletContext } from 'react-router-dom'
import { createConversation } from './api'
import { Button } from '@/components/ui/button'
import type { RagOutletContext } from './RagPage'

export function RagEmptyState() {
  const navigate = useNavigate()
  const { reloadConversations } = useOutletContext<RagOutletContext>()

  async function handleNew() {
    const conversation = await createConversation()
    await reloadConversations()
    navigate(`/rag/${conversation.id}`)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">Select a conversation or start a new one.</p>
      <Button onClick={handleNew}>New chat</Button>
    </div>
  )
}
