import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from './AdminPage'
import type { UserOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    assignRole: vi.fn(),
    revokeRole: vi.fn(),
  }
})

vi.mock('./auth-provider', () => ({
  useAuth: vi.fn(),
}))

const api = await import('./api')
const { useAuth } = await import('./auth-provider')

const ALICE: UserOut = {
  id: 1,
  username: 'alice',
  email: 'alice@example.com',
  is_active: true,
  is_superuser: false,
  roles: ['use_rag'],
  created_at: '2026-01-01T00:00:00Z',
}

const BOB: UserOut = {
  id: 2,
  username: 'bob',
  email: 'bob@example.com',
  is_active: true,
  is_superuser: false,
  roles: [],
  created_at: '2026-01-01T00:00:00Z',
}

function mockAuth(isSuperuser: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { user_id: 99, username: 'admin', roles: ['manage_users'], is_superuser: isSuperuser },
    login: vi.fn(),
    logout: vi.fn(),
  })
}

describe('AdminPage', () => {
  beforeEach(() => {
    vi.mocked(api.listUsers).mockReset().mockResolvedValue([ALICE, BOB])
    vi.mocked(api.createUser).mockReset()
    vi.mocked(api.updateUser).mockReset()
    vi.mocked(api.deleteUser).mockReset()
    vi.mocked(api.assignRole).mockReset()
    vi.mocked(api.revokeRole).mockReset()
    mockAuth(false)
  })

  it('lists users fetched on mount', async () => {
    render(<AdminPage />)

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('filters the list by the search box', async () => {
    render(<AdminPage />)
    await screen.findByText('alice')

    await userEvent.type(screen.getByPlaceholderText('Search by username or email'), 'bob')

    expect(screen.queryByText('alice')).not.toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('hides the manage_users role option for a non-superuser', async () => {
    render(<AdminPage />)
    await screen.findByText('alice')

    expect(screen.queryByText('manage_users')).not.toBeInTheDocument()
  })

  it('shows the manage_users role option for a superuser', async () => {
    mockAuth(true)
    render(<AdminPage />)
    await screen.findByText('alice')

    expect(screen.getAllByText('manage_users').length).toBeGreaterThan(0)
  })

  it('toggles a role badge: assigns when not held, revokes when held', async () => {
    vi.mocked(api.assignRole).mockResolvedValue({ ...ALICE, roles: ['use_rag', 'index_content'] })
    render(<AdminPage />)
    const aliceRow = (await screen.findByText('alice')).closest('tr')
    if (!aliceRow) throw new Error('alice row not found')

    await userEvent.click(within(aliceRow).getByText('index_content'))

    expect(api.assignRole).toHaveBeenCalledWith(1, 'index_content')

    vi.mocked(api.revokeRole).mockResolvedValue({ ...ALICE, roles: [] })
    await userEvent.click(within(aliceRow).getByText('use_rag'))

    expect(api.revokeRole).toHaveBeenCalledWith(1, 'use_rag')
  })

  it('toggles active status via the switch', async () => {
    vi.mocked(api.updateUser).mockResolvedValue({ ...ALICE, is_active: false })
    render(<AdminPage />)
    await screen.findByText('alice')

    await userEvent.click(screen.getAllByRole('switch')[0])

    expect(api.updateUser).toHaveBeenCalledWith(1, { is_active: false })
  })

  it('creates a user through the dialog and reloads the list', async () => {
    vi.mocked(api.createUser).mockResolvedValue({
      ...ALICE,
      id: 3,
      username: 'newbie',
      roles: ['use_rag'],
    })
    render(<AdminPage />)
    await screen.findByText('alice')

    await userEvent.click(screen.getByRole('button', { name: 'New user' }))
    await userEvent.type(screen.getByLabelText('Username'), 'newbie')
    await userEvent.type(screen.getByLabelText('Email'), 'newbie@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'a-good-password')
    await userEvent.click(screen.getByRole('checkbox', { name: 'use_rag' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith(
        'newbie',
        'newbie@example.com',
        'a-good-password',
        ['use_rag'],
      )
    })
  })

  it('edits a user through the dialog without requiring a new password', async () => {
    vi.mocked(api.updateUser).mockResolvedValue({ ...ALICE, username: 'alice2' })
    render(<AdminPage />)
    await screen.findByText('alice')

    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const usernameField = screen.getByLabelText('Username')
    await userEvent.clear(usernameField)
    await userEvent.type(usernameField, 'alice2')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.updateUser).toHaveBeenCalledWith(1, {
        username: 'alice2',
        email: 'alice@example.com',
      })
    })
  })

  it('deletes a user after confirming', async () => {
    vi.mocked(api.deleteUser).mockResolvedValue(undefined)
    render(<AdminPage />)
    await screen.findByText('alice')

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(api.deleteUser).toHaveBeenCalledWith(1)
    })
  })
})
