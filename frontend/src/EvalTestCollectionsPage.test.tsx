import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCollectionsPage } from './EvalTestCollectionsPage'
import type { SearchConfigurationOut, TestCaseOut, TestCollectionOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listTestCollections: vi.fn(),
    listSearchConfigurations: vi.fn(),
    createTestCollection: vi.fn(),
    updateTestCollection: vi.fn(),
    deleteTestCollection: vi.fn(),
    getCollectionContentFacets: vi.fn(),
    listMemberTestCases: vi.fn(),
    addMemberTestCase: vi.fn(),
  }
})

const api = await import('./api')

const CONFIG_HYBRID: SearchConfigurationOut = {
  id: 5,
  name: 'hybrid',
  weights: { weights: {}, variant_weights: {} },
  is_preset: true,
}

const CONFIG_SEMANTIC: SearchConfigurationOut = {
  id: 6,
  name: 'semantic',
  weights: { weights: {}, variant_weights: {} },
  is_preset: true,
}

const GENESIS_COLLECTION: TestCollectionOut = {
  id: 1,
  name: 'genesis eval',
  description: 'covers the creation narrative',
  search_configuration_id: 5,
  books: ['genesis'],
  sources: ['kjv'],
  test_case_count: 2,
}

const EXODUS_COLLECTION: TestCollectionOut = {
  id: 2,
  name: 'exodus eval',
  description: 'covers the exodus narrative',
  search_configuration_id: 5,
  books: [],
  sources: [],
  test_case_count: 0,
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
    vi.mocked(api.listTestCollections)
      .mockReset()
      .mockResolvedValue([GENESIS_COLLECTION, EXODUS_COLLECTION])
    vi.mocked(api.listSearchConfigurations)
      .mockReset()
      .mockResolvedValue([CONFIG_HYBRID, CONFIG_SEMANTIC])
    vi.mocked(api.createTestCollection).mockReset()
    vi.mocked(api.updateTestCollection).mockReset()
    vi.mocked(api.deleteTestCollection).mockReset()
    vi.mocked(api.getCollectionContentFacets)
      .mockReset()
      .mockResolvedValue({ book: ['genesis', 'galatians'], source: ['kjv', 'rahlfs'] })
    vi.mocked(api.listMemberTestCases).mockReset().mockResolvedValue([])
    vi.mocked(api.addMemberTestCase).mockReset()
  })

  it('lists collections with a plain name, description, a linked test case count, configuration, and a Results link', async () => {
    renderPage()

    expect(await screen.findByText('genesis eval')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'genesis eval' })).not.toBeInTheDocument()
    expect(screen.getByText('covers the creation narrative')).toBeInTheDocument()

    const countButton = screen.getByRole('button', { name: '2' })
    expect(countButton).toHaveAttribute('href', '/eval/collections/1/test-cases')

    const resultsButtons = screen.getAllByRole('button', { name: 'Results' })
    expect(resultsButtons[0]).toHaveAttribute('href', '/eval/collections/1/results')

    expect(
      screen.getByRole('combobox', { name: 'Configuration for genesis eval' }),
    ).toHaveTextContent('hybrid')
  })

  it('filters collections by name or description, case-insensitively', async () => {
    renderPage()
    await screen.findByText('genesis eval')
    await screen.findByText('exodus eval')

    const user = userEvent.setup()
    const search = screen.getByLabelText('Search collections')

    await user.type(search, 'EXODUS')
    expect(screen.getByText('exodus eval')).toBeInTheDocument()
    expect(screen.queryByText('genesis eval')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'creation')
    expect(screen.getByText('genesis eval')).toBeInTheDocument()
    expect(screen.queryByText('exodus eval')).not.toBeInTheDocument()
  })

  it('creates a new collection with picked books and sources', async () => {
    vi.mocked(api.createTestCollection).mockResolvedValue({
      id: 3,
      name: 'new collection',
      description: null,
      search_configuration_id: 5,
      books: ['genesis'],
      sources: ['kjv'],
      test_case_count: 0,
    })

    renderPage()
    await screen.findByText('genesis eval')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New collection' }))
    await user.type(screen.getByLabelText('Name'), 'new collection')
    await user.click(screen.getByRole('combobox', { name: 'Search configuration' }))
    await user.click(await screen.findByRole('option', { name: 'hybrid' }))

    await user.type(screen.getByLabelText('Books'), 'gen')
    await user.click(await screen.findByRole('option', { name: 'genesis' }))
    expect(screen.getByText('genesis')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Sources'), 'kjv')
    await user.click(await screen.findByRole('option', { name: 'kjv' }))

    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(api.createTestCollection).toHaveBeenCalledWith({
        name: 'new collection',
        description: null,
        search_configuration_id: 5,
        books: ['genesis'],
        sources: ['kjv'],
      }),
    )
  })

  it('changes the configuration inline from the table', async () => {
    renderPage()
    await screen.findByText('genesis eval')

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Configuration for genesis eval' }))
    await user.click(await screen.findByRole('option', { name: 'semantic' }))

    await waitFor(() =>
      expect(api.updateTestCollection).toHaveBeenCalledWith(1, {
        name: 'genesis eval',
        description: 'covers the creation narrative',
        search_configuration_id: 6,
        books: ['genesis'],
        sources: ['kjv'],
      }),
    )
  })

  it('duplicates a collection with its configuration and members, but touches no results', async () => {
    const members: TestCaseOut[] = [
      { id: 10, content: 'q1', language: 'eng', source: null, context: null, tags: [], targets: [] },
      { id: 11, content: 'q2', language: 'eng', source: null, context: null, tags: [], targets: [] },
    ]
    vi.mocked(api.listMemberTestCases).mockResolvedValue(members)
    vi.mocked(api.createTestCollection).mockResolvedValue({
      id: 99,
      name: 'Copy of genesis eval',
      description: 'covers the creation narrative',
      search_configuration_id: 5,
      books: ['genesis'],
      sources: ['kjv'],
      test_case_count: 0,
    })

    renderPage()
    await screen.findByText('genesis eval')

    const user = userEvent.setup()
    const duplicateButtons = screen.getAllByRole('button', { name: 'Duplicate' })
    await user.click(duplicateButtons[0])

    await waitFor(() =>
      expect(api.createTestCollection).toHaveBeenCalledWith({
        name: 'Copy of genesis eval',
        description: 'covers the creation narrative',
        search_configuration_id: 5,
        books: ['genesis'],
        sources: ['kjv'],
      }),
    )
    await waitFor(() => {
      expect(api.addMemberTestCase).toHaveBeenCalledWith(99, 10)
      expect(api.addMemberTestCase).toHaveBeenCalledWith(99, 11)
    })
  })

  it('deletes a collection after confirmation', async () => {
    renderPage()
    await screen.findByText('genesis eval')

    const user = userEvent.setup()
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    await user.click(deleteButtons[0])
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteTestCollection).toHaveBeenCalledWith(1))
  })
})
