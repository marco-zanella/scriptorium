import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

vi.mock('./auth-provider', () => ({
  useAuth: vi.fn(),
}))

const { useAuth } = await import('./auth-provider')

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
})
