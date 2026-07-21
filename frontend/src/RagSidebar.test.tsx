import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RagSidebar } from './RagSidebar'
import type { ConversationOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
  }
})

const api = await import('./api')

const CONVERSATION_A: ConversationOut = {
  id: 1,
  title: 'Genesis questions',
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T01:00:00Z',
}

function renderSidebar({
  conversations = [CONVERSATION_A],
  activeId = null,
  onChange = vi.fn(),
}: {
  conversations?: ConversationOut[]
  activeId?: number | null
  onChange?: () => void | Promise<void>
} = {}) {
  return render(
    <MemoryRouter>
      <RagSidebar conversations={conversations} activeId={activeId} onChange={onChange} />
    </MemoryRouter>,
  )
}

describe('RagSidebar', () => {
  beforeEach(() => {
    vi.mocked(api.createConversation).mockReset()
    vi.mocked(api.deleteConversation).mockReset()
    vi.mocked(api.renameConversation).mockReset()
  })

  it('lists conversations with a link to their thread', () => {
    renderSidebar()

    const link = screen.getByRole('link', { name: 'Genesis questions' })
    expect(link).toHaveAttribute('href', '/rag/1')
  })

  it('shows an empty state when there are no conversations', () => {
    renderSidebar({ conversations: [] })

    expect(screen.getByText('No conversations yet.')).toBeInTheDocument()
  })

  it('creates a new conversation', async () => {
    vi.mocked(api.createConversation).mockResolvedValue({
      id: 2,
      title: null,
      created_at: '2026-07-20T02:00:00Z',
      updated_at: '2026-07-20T02:00:00Z',
    })
    const onChange = vi.fn()
    renderSidebar({ onChange })

    await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(api.createConversation).toHaveBeenCalledOnce()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('renames a conversation via the actions menu', async () => {
    vi.mocked(api.renameConversation).mockResolvedValue({ ...CONVERSATION_A, title: 'Updated title' })
    const onChange = vi.fn()
    renderSidebar({ onChange })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Actions for Genesis questions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    const input = await screen.findByLabelText('Conversation title')
    await user.clear(input)
    await user.type(input, 'Updated title')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.renameConversation).toHaveBeenCalledWith(1, 'Updated title'),
    )
    expect(onChange).toHaveBeenCalled()
  })

  it('deletes a conversation via the confirm dialog', async () => {
    const onChange = vi.fn()
    renderSidebar({ onChange })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Actions for Genesis questions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(1))
    expect(onChange).toHaveBeenCalled()
  })
})
