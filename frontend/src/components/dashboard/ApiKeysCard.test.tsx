import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiKeysCard } from './ApiKeysCard'

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api')
  return {
    ...actual,
    listApiTokens: vi.fn(),
    createApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
    purgeApiToken: vi.fn(),
  }
})

const api = await import('../../api')

beforeEach(() => {
  vi.mocked(api.listApiTokens).mockReset().mockResolvedValue([])
  vi.mocked(api.createApiToken).mockReset()
  vi.mocked(api.revokeApiToken).mockReset()
  vi.mocked(api.purgeApiToken).mockReset()
})

describe('ApiKeysCard', () => {
  it('lets a user generate and reveal an API key once', async () => {
    vi.mocked(api.createApiToken).mockResolvedValue({
      id: 1,
      name: 'ingestion-cli',
      scopes: ['index_content'],
      created_at: '2026-01-01T00:00:00Z',
      expires_at: null,
      revoked_at: null,
      raw_key: 'scriptorium_sk_test123',
    })

    render(<ApiKeysCard />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Generate API key' }))

    await waitFor(() =>
      expect(api.createApiToken).toHaveBeenCalledWith('ingestion-cli', ['index_content']),
    )
    expect(await screen.findByDisplayValue('scriptorium_sk_test123')).toBeInTheDocument()
  })

  it('lets a user override the default key name before generating', async () => {
    vi.mocked(api.createApiToken).mockResolvedValue({
      id: 2,
      name: 'my-laptop',
      scopes: ['index_content'],
      created_at: '2026-01-01T00:00:00Z',
      expires_at: null,
      revoked_at: null,
      raw_key: 'scriptorium_sk_test456',
    })

    render(<ApiKeysCard />)
    const user = userEvent.setup()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'my-laptop')
    await user.click(screen.getByRole('button', { name: 'Generate API key' }))

    await waitFor(() =>
      expect(api.createApiToken).toHaveBeenCalledWith('my-laptop', ['index_content']),
    )
  })

  it('renders existing keys from the list endpoint', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([
      {
        id: 1,
        name: 'ingestion-cli',
        scopes: ['index_content'],
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        revoked_at: null,
      },
    ])

    render(<ApiKeysCard />)

    expect(await screen.findByText('ingestion-cli')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('revokes a key after confirming, then re-lists', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([
      {
        id: 1,
        name: 'ingestion-cli',
        scopes: ['index_content'],
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        revoked_at: null,
      },
    ])
    vi.mocked(api.revokeApiToken).mockResolvedValue(undefined)

    render(<ApiKeysCard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(api.revokeApiToken).toHaveBeenCalledWith(1))
  })

  it('offers delete instead of revoke for already-revoked keys', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([
      {
        id: 1,
        name: 'ingestion-cli',
        scopes: ['index_content'],
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        revoked_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ApiKeysCard />)

    expect(await screen.findByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('does not offer a delete action for active keys', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([
      {
        id: 1,
        name: 'ingestion-cli',
        scopes: ['index_content'],
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        revoked_at: null,
      },
    ])

    render(<ApiKeysCard />)

    await screen.findByText('Active')
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('deletes a revoked key after confirming, then re-lists', async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue([
      {
        id: 1,
        name: 'ingestion-cli',
        scopes: ['index_content'],
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        revoked_at: '2026-01-02T00:00:00Z',
      },
    ])
    vi.mocked(api.purgeApiToken).mockResolvedValue(undefined)

    render(<ApiKeysCard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.purgeApiToken).toHaveBeenCalledWith(1))
  })
})
