import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { LoginPage } from './LoginPage'
import { renderWithProviders as render } from './test-utils'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    login: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  }
})

const api = await import('./api')

describe('LoginPage', () => {
  beforeEach(() => {
    // Default: no existing session — every test starts anonymous unless it
    // explicitly logs in. Individual `me`/`refresh` calls after that use
    // mockResolvedValueOnce/mockRejectedValueOnce layered on top of these.
    vi.mocked(api.login).mockReset()
    vi.mocked(api.me).mockReset().mockRejectedValue(new ApiError(401, 'no session'))
    vi.mocked(api.refresh).mockReset().mockRejectedValue(new ApiError(401, 'no refresh token'))
    vi.mocked(api.logout).mockReset()
  })

  async function renderAndWaitForForm() {
    render(<LoginPage />)
    return screen.findByLabelText('Username')
  }

  it('shows the login form initially', async () => {
    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: 'Scriptorium' })).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('redirects away from the form when a session already exists on mount', async () => {
    vi.mocked(api.me).mockReset().mockResolvedValue({
      user_id: 1,
      roles: ['use_rag'],
      is_superuser: false,
    })

    render(<LoginPage />)

    await vi.waitFor(() => {
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    })
  })

  it('redirects away from the form after a successful login', async () => {
    await renderAndWaitForForm()
    vi.mocked(api.login).mockResolvedValueOnce({ access_token: 'x', token_type: 'bearer' })
    vi.mocked(api.me).mockResolvedValueOnce({ user_id: 1, roles: ['use_rag'], is_superuser: false })

    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 's3cret-pw')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await vi.waitFor(() => {
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    })
  })

  it('defaults remember me to false', async () => {
    await renderAndWaitForForm()
    vi.mocked(api.login).mockResolvedValueOnce({ access_token: 'x', token_type: 'bearer' })
    vi.mocked(api.me).mockResolvedValueOnce({ user_id: 1, roles: [], is_superuser: false })

    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 's3cret-pw')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(api.login).toHaveBeenCalledWith('alice', 's3cret-pw', false)
  })

  it('passes remember me through when checked', async () => {
    await renderAndWaitForForm()
    vi.mocked(api.login).mockResolvedValueOnce({ access_token: 'x', token_type: 'bearer' })
    vi.mocked(api.me).mockResolvedValueOnce({ user_id: 1, roles: [], is_superuser: false })

    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 's3cret-pw')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remember me' }))
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(api.login).toHaveBeenCalledWith('alice', 's3cret-pw', true)
  })

  it('shows an error message when login fails', async () => {
    await renderAndWaitForForm()
    vi.mocked(api.login).mockRejectedValueOnce(new ApiError(401, 'Invalid credentials'))

    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
  })
})
