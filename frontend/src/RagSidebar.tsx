import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import { createConversation, deleteConversation, renameConversation, type ConversationOut } from './api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export function RagSidebar({
  conversations,
  activeId,
  error,
  onChange,
}: {
  conversations: ConversationOut[]
  activeId: number | null
  error?: string | null
  onChange: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState<ConversationOut | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<ConversationOut | null>(null)

  async function handleNew() {
    const conversation = await createConversation()
    await onChange()
    navigate(`/rag/${conversation.id}`)
  }

  function openRename(conversation: ConversationOut) {
    setRenameValue(conversation.title ?? '')
    setRenaming(conversation)
  }

  async function submitRename() {
    if (!renaming) return
    await renameConversation(renaming.id, renameValue.trim() || null)
    setRenaming(null)
    await onChange()
  }

  async function confirmDelete() {
    if (!deleting) return
    await deleteConversation(deleting.id)
    if (activeId === deleting.id) navigate('/rag')
    setDeleting(null)
    await onChange()
  }

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      <Button onClick={handleNew} className="w-full justify-start gap-1.5">
        <PlusIcon />
        New chat
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
        <div className="flex flex-col gap-0.5 p-1">
          {conversations.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">No conversations yet.</p>
          )}
          {conversations.map((conversation) => {
            const title = conversation.title ?? 'Untitled conversation'
            return (
              <div
                key={conversation.id}
                className={cn(
                  'group flex items-center gap-1 rounded-md px-2 py-1.5',
                  conversation.id === activeId ? 'bg-muted' : 'hover:bg-muted/50',
                )}
              >
                <Link to={`/rag/${conversation.id}`} className="min-w-0 flex-1 truncate text-sm">
                  {title}
                </Link>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${title}`}
                        className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => openRename(conversation)}>Rename</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(conversation)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitRename()
              }
            }}
            aria-label="Conversation title"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={submitRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.title ?? 'this conversation'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the conversation and its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
