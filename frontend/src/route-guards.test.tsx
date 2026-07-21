import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RequireAuth, RequireRole } from './route-guards'

vi.mock('./auth-provider', () => ({
  useAuth: vi.fn(),
}))

const { useAuth } = await import('./auth-provider')

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({
    status: 'anonymous',
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  })
}

function renderRequireAuth(protected_: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RequireAuth>{protected_}</RequireAuth>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderRequireRole(role: string, protected_: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/" element={<div>Home page</div>} />
        <Route path="/admin" element={<RequireRole role={role}>{protected_}</RequireRole>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('shows a loading state while checking', () => {
    mockAuth({ status: 'checking' })
    renderRequireAuth(<div>Protected</div>)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('redirects to /login when anonymous', () => {
    mockAuth({ status: 'anonymous' })
    renderRequireAuth(<div>Protected</div>)
    expect(screen.getByText('Login page')).toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    mockAuth({ status: 'authenticated', user: { user_id: 1, username: 'alice', roles: [], is_superuser: false } })
    renderRequireAuth(<div>Protected</div>)
    expect(screen.getByText('Protected')).toBeInTheDocument()
  })
})

describe('RequireRole', () => {
  it('redirects to / when the user lacks the required role', () => {
    mockAuth({
      status: 'authenticated',
      user: { user_id: 1, username: 'alice', roles: ['use_rag'], is_superuser: false },
    })
    renderRequireRole('manage_users', <div>Admin content</div>)
    expect(screen.getByText('Home page')).toBeInTheDocument()
  })

  it('renders children when the user has the required role', () => {
    mockAuth({
      status: 'authenticated',
      user: { user_id: 1, username: 'alice', roles: ['manage_users'], is_superuser: false },
    })
    renderRequireRole('manage_users', <div>Admin content</div>)
    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })

  it('renders children for a superuser regardless of explicit roles', () => {
    mockAuth({ status: 'authenticated', user: { user_id: 1, username: 'alice', roles: [], is_superuser: true } })
    renderRequireRole('manage_users', <div>Admin content</div>)
    expect(screen.getByText('Admin content')).toBeInTheDocument()
  })
})
