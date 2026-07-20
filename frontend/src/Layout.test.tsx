import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'
import { ThemeProvider } from './theme-provider'

vi.mock('./auth-provider', () => ({
  useAuth: vi.fn(),
}))

const { useAuth } = await import('./auth-provider')

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { user_id: 1, roles: [], is_superuser: false },
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  })
}

function renderLayout() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('Layout', () => {
  it('hides the Users nav link for a user without manage_users', () => {
    mockAuth({ user: { user_id: 1, roles: ['use_rag'], is_superuser: false } })
    renderLayout()

    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('shows the Users nav link for a user with manage_users', () => {
    mockAuth({ user: { user_id: 1, roles: ['manage_users'], is_superuser: false } })
    renderLayout()

    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('shows the Users nav link for a superuser', () => {
    mockAuth({ user: { user_id: 1, roles: [], is_superuser: true } })
    renderLayout()

    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('hides the eval nav links for a user without run_experiments', () => {
    mockAuth({ user: { user_id: 1, roles: ['use_rag'], is_superuser: false } })
    renderLayout()

    expect(screen.queryByRole('link', { name: 'Test cases' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Test collections' })).not.toBeInTheDocument()
  })

  it('shows the eval nav links for a user with run_experiments', () => {
    mockAuth({ user: { user_id: 1, roles: ['run_experiments'], is_superuser: false } })
    renderLayout()

    expect(screen.getByRole('link', { name: 'Test cases' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Test collections' })).toBeInTheDocument()
  })

  it('calls logout when the log out button is clicked', async () => {
    const logout = vi.fn()
    mockAuth({ logout })
    renderLayout()

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(logout).toHaveBeenCalledOnce()
  })
})
