import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

vi.mock('./auth-provider', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listSearchConfigurations: vi.fn().mockResolvedValue([]),
    listConversations: vi.fn().mockResolvedValue([]),
    listTestCollections: vi.fn().mockResolvedValue([]),
    listUsers: vi.fn().mockResolvedValue([]),
    listApiTokens: vi.fn().mockResolvedValue([]),
    createApiToken: vi.fn(),
  }
})

const { useAuth } = await import('./auth-provider')
const api = await import('./api')

beforeEach(() => {
  vi.mocked(api.listSearchConfigurations).mockReset().mockResolvedValue([])
  vi.mocked(api.listConversations).mockReset().mockResolvedValue([])
  vi.mocked(api.listTestCollections).mockReset().mockResolvedValue([])
  vi.mocked(api.listUsers).mockReset().mockResolvedValue([])
  vi.mocked(api.listApiTokens).mockReset().mockResolvedValue([])
  vi.mocked(api.createApiToken).mockReset()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

describe('DashboardPage', () => {
  it('renders nothing when there is no user', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'anonymous',
      user: null,
      login: vi.fn(),
      logout: vi.fn(),
    })

    const { container } = renderPage()

    expect(container).toBeEmptyDOMElement()
  })

  it('renders a service card only for roles the user holds', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, username: 'alice', roles: ['use_rag'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })

    renderPage()

    expect(screen.getByText('RAG Chat')).toBeInTheDocument()
    expect(screen.queryByText('Search')).not.toBeInTheDocument()
    expect(screen.queryByText('Eval Harness')).not.toBeInTheDocument()
    expect(screen.queryByText('User Admin')).not.toBeInTheDocument()
    expect(screen.queryByText('Ingestion')).not.toBeInTheDocument()
  })

  it('shows every service card to a superuser regardless of roles', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, username: 'root', roles: [], is_superuser: true },
      login: vi.fn(),
      logout: vi.fn(),
    })

    renderPage()

    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('RAG Chat')).toBeInTheDocument()
    expect(screen.getByText('Eval Harness')).toBeInTheDocument()
    expect(screen.getByText('User Admin')).toBeInTheDocument()
    expect(screen.getByText('Ingestion')).toBeInTheDocument()
    expect(
      screen.getByText('You have full administrative access to every service.'),
    ).toBeInTheDocument()
  })

  it('renders the ingestion card as a plain anchor to the API keys section', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, username: 'alice', roles: ['index_content'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })

    renderPage()

    const link = screen.getByText('Ingestion').closest('a')
    expect(link).toHaveAttribute('href', '#api-keys')
  })

  it('shows a contact-administrator message when the user holds no service roles', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, username: 'nobody', roles: [], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })

    renderPage()

    expect(
      screen.getByText("You don't have access to any services yet — contact an administrator."),
    ).toBeInTheDocument()
  })

  it("renders a search stat excluding shared presets from the user's count", async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, username: 'alice', roles: ['use_search_engine'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })
    vi.mocked(api.listSearchConfigurations).mockResolvedValue([
      { id: 1, name: 'mine', weights: { weights: {}, variant_weights: {} }, is_preset: false },
      { id: 2, name: 'preset', weights: { weights: {}, variant_weights: {} }, is_preset: true },
    ])

    renderPage()

    expect(await screen.findByText('1 saved configuration')).toBeInTheDocument()
  })

  it('does not render the API keys card for a user without index_content', () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { user_id: 1, username: 'alice', roles: ['use_rag'], is_superuser: false },
      login: vi.fn(),
      logout: vi.fn(),
    })

    renderPage()

    expect(screen.queryByText('API keys')).not.toBeInTheDocument()
  })
})
