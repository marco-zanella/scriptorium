import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchConfigurationsPage } from './SearchConfigurationsPage'
import type { SearchConfigurationOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listSearchConfigurations: vi.fn(),
    createSearchConfiguration: vi.fn(),
    updateSearchConfiguration: vi.fn(),
    deleteSearchConfiguration: vi.fn(),
  }
})

const api = await import('./api')

const EMPTY_WEIGHTS = { text: 0, shingle: 0, trigram: 0, language: 0, semantic: 0 }

const HYBRID: SearchConfigurationOut = {
  id: null,
  name: 'hybrid',
  weights: { weights: EMPTY_WEIGHTS, variant_weights: EMPTY_WEIGHTS },
  is_preset: true,
}

const MY_CONFIG: SearchConfigurationOut = {
  id: 7,
  name: 'my config',
  weights: { weights: EMPTY_WEIGHTS, variant_weights: EMPTY_WEIGHTS },
  is_preset: false,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchConfigurationsPage />
    </MemoryRouter>,
  )
}

describe('SearchConfigurationsPage', () => {
  beforeEach(() => {
    vi.mocked(api.listSearchConfigurations).mockReset().mockResolvedValue([HYBRID, MY_CONFIG])
    vi.mocked(api.createSearchConfiguration).mockReset()
    vi.mocked(api.updateSearchConfiguration).mockReset()
    vi.mocked(api.deleteSearchConfiguration).mockReset()
  })

  it('shows a breadcrumb linking back to search', async () => {
    renderPage()
    await screen.findByText('hybrid')

    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
    expect(screen.getByText('Configurations')).toBeInTheDocument()
  })

  it('lists presets and saved configurations', async () => {
    renderPage()

    expect(await screen.findByText('hybrid')).toBeInTheDocument()
    expect(screen.getByText('my config')).toBeInTheDocument()
    expect(screen.getByText('Built-in preset')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('does not show edit/delete buttons for built-in presets', async () => {
    renderPage()
    await screen.findByText('hybrid')

    const presetRow = screen.getByText('hybrid').closest('tr')
    const savedRow = screen.getByText('my config').closest('tr')
    if (!presetRow || !savedRow) throw new Error('row not found')

    expect(within(presetRow).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(presetRow).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(savedRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(within(savedRow).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('creates a configuration through the dialog and reloads the list', async () => {
    vi.mocked(api.createSearchConfiguration).mockResolvedValue({
      id: 8,
      name: 'new config',
      weights: { weights: EMPTY_WEIGHTS, variant_weights: EMPTY_WEIGHTS },
      is_preset: false,
    })
    renderPage()
    await screen.findByText('hybrid')

    await userEvent.click(screen.getByRole('button', { name: 'New configuration' }))
    await userEvent.type(screen.getByLabelText('Name'), 'new config')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(api.createSearchConfiguration).toHaveBeenCalledWith('new config', {
        weights: EMPTY_WEIGHTS,
        variant_weights: EMPTY_WEIGHTS,
      })
    })
  })

  it('edits a saved configuration through the same form, pre-filled', async () => {
    vi.mocked(api.updateSearchConfiguration).mockResolvedValue({
      ...MY_CONFIG,
      name: 'renamed config',
    })
    renderPage()
    await screen.findByText('my config')

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('heading', { name: 'Edit configuration' })).toBeInTheDocument()
    const nameField = screen.getByLabelText('Name')
    expect(nameField).toHaveValue('my config')

    await userEvent.clear(nameField)
    await userEvent.type(nameField, 'renamed config')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.updateSearchConfiguration).toHaveBeenCalledWith(7, 'renamed config', {
        weights: EMPTY_WEIGHTS,
        variant_weights: EMPTY_WEIGHTS,
      })
    })
  })

  it('deletes a saved configuration after confirmation', async () => {
    renderPage()
    await screen.findByText('my config')

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteSearchConfiguration).toHaveBeenCalledWith(7))
  })
})
