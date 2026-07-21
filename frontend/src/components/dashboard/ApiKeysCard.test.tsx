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
  }
})

const api = await import('../../api')

beforeEach(() => {
  vi.mocked(api.listApiTokens).mockReset().mockResolvedValue([])
  vi.mocked(api.createApiToken).mockReset()
  vi.mocked(api.revokeApiToken).mockReset()
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

  it('does not offer a revoke action for already-revoked keys', async () => {
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
  })
})
