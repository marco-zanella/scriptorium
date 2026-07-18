import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

vi.mock('./auth-provider', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    createApiToken: vi.fn(),
  }
})

const { useAuth } = await import('./auth-provider')
const api = await import('./api')

describe('DashboardPage', () => {
  it("shows the current user's id, roles, and superuser status", () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 42, roles: ['use_rag', 'use_search_engine'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })

    render(<DashboardPage />)

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('use_rag, use_search_engine')).toBeInTheDocument()
    expect(screen.getByText('no')).toBeInTheDocument()
  })

  it('renders nothing when there is no user', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'anonymous',
      user: null,
      login: vi.fn(),
      logout: vi.fn(),
    })

    const { container } = render(<DashboardPage />)

    expect(container).toBeEmptyDOMElement()
  })

  it('hides the ingestion API key card for a user without index_content', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, roles: ['use_rag'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })

    render(<DashboardPage />)

    expect(screen.queryByText('Ingestion API key')).not.toBeInTheDocument()
  })

  it('lets a user with index_content generate and reveal an API key once', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, roles: ['index_content'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })
    vi.mocked(api.createApiToken).mockResolvedValue({
      id: 1,
      name: 'ingestion-cli',
      scopes: ['index_content'],
      created_at: '2026-01-01T00:00:00Z',
      expires_at: null,
      revoked_at: null,
      raw_key: 'scriptorium_sk_test123',
    })

    render(<DashboardPage />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Generate API key' }))

    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledWith('ingestion-cli', ['index_content']))
    expect(await screen.findByDisplayValue('scriptorium_sk_test123')).toBeInTheDocument()
  })
})
