import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCollectionsPage } from './EvalTestCollectionsPage'
import type { SearchConfigurationOut, TestCollectionOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listTestCollections: vi.fn(),
    listSearchConfigurations: vi.fn(),
    createTestCollection: vi.fn(),
    updateTestCollection: vi.fn(),
    deleteTestCollection: vi.fn(),
  }
})

const api = await import('./api')

const CONFIG: SearchConfigurationOut = {
  id: 5,
  name: 'hybrid',
  weights: { weights: {}, variant_weights: {} },
  is_preset: true,
}

const COLLECTION: TestCollectionOut = {
  id: 1,
  name: 'genesis eval',
  description: null,
  search_configuration_id: 5,
  books: [],
  sources: [],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EvalTestCollectionsPage />
    </MemoryRouter>,
  )
}

describe('EvalTestCollectionsPage', () => {
  beforeEach(() => {
    vi.mocked(api.listTestCollections).mockReset().mockResolvedValue([COLLECTION])
    vi.mocked(api.listSearchConfigurations).mockReset().mockResolvedValue([CONFIG])
    vi.mocked(api.createTestCollection).mockReset()
    vi.mocked(api.updateTestCollection).mockReset()
    vi.mocked(api.deleteTestCollection).mockReset()
  })

  it('lists collections with a link to the detail page and the configuration name', async () => {
    renderPage()

    const link = await screen.findByRole('link', { name: 'genesis eval' })
    expect(link).toHaveAttribute('href', '/eval/collections/1')
    expect(screen.getByText('hybrid')).toBeInTheDocument()
  })

  it('creates a new collection', async () => {
    vi.mocked(api.createTestCollection).mockResolvedValue({
      id: 2,
      name: 'new collection',
      description: null,
      search_configuration_id: 5,
      books: [],
      sources: [],
    })

    renderPage()
    await screen.findByRole('link', { name: 'genesis eval' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New collection' }))
    await user.type(screen.getByLabelText('Name'), 'new collection')
    await user.click(screen.getByRole('combobox', { name: 'Search configuration' }))
    await user.click(await screen.findByRole('option', { name: 'hybrid' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(api.createTestCollection).toHaveBeenCalledWith({
        name: 'new collection',
        description: null,
        search_configuration_id: 5,
        books: [],
        sources: [],
      }),
    )
  })

  it('deletes a collection after confirmation', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'genesis eval' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteTestCollection).toHaveBeenCalledWith(1))
  })
})
