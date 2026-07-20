import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from './SearchPage'
import type { LanguageOut, SearchConfigurationOut, SearchResponse } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listLanguages: vi.fn(),
    listSearchConfigurations: vi.fn(),
    search: vi.fn(),
    getFacets: vi.fn(),
  }
})

const api = await import('./api')

const LANGUAGES: LanguageOut[] = [
  { iso_code: 'grc', display_name: 'Ancient Greek', directionality: 'ltr' },
  { iso_code: 'arb', display_name: 'Arabic', directionality: 'rtl' },
]

const HYBRID_WEIGHTS = { text: 0.1, shingle: 0.1, trigram: 0.1, language: 0.5, semantic: 0.5 }
const CONFIGURATIONS: SearchConfigurationOut[] = [
  {
    id: 1,
    name: 'hybrid',
    weights: { weights: HYBRID_WEIGHTS, variant_weights: HYBRID_WEIGHTS },
    is_preset: true,
  },
  {
    id: 7,
    name: 'my config',
    weights: {
      weights: { text: 1, shingle: 0, trigram: 0, language: 0, semantic: 0 },
      variant_weights: { text: 0, shingle: 0, trigram: 0, language: 0, semantic: 0 },
    },
    is_preset: false,
  },
]

const EMPTY_FACETS = { book: [], source: [] }

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  )
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.mocked(api.listLanguages).mockReset().mockResolvedValue(LANGUAGES)
    vi.mocked(api.listSearchConfigurations).mockReset().mockResolvedValue(CONFIGURATIONS)
    vi.mocked(api.search).mockReset()
    vi.mocked(api.getFacets).mockReset().mockResolvedValue(EMPTY_FACETS)
  })

  it('loads languages and configurations on mount', async () => {
    renderPage()
    await waitFor(() => expect(api.listLanguages).toHaveBeenCalled())
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())
  })

  it('loads facet options before any search has run, so a scope can be pre-selected', async () => {
    vi.mocked(api.getFacets).mockResolvedValue({
      book: [{ key: 'genesis', count: 10 }],
      source: [{ key: 'rahlfs', count: 10 }],
    })

    renderPage()
    await waitFor(() => expect(api.getFacets).toHaveBeenCalledWith('grc'))

    expect(await screen.findByText('genesis')).toBeInTheDocument()
    expect(screen.getByText('rahlfs')).toBeInTheDocument()
    expect(api.search).not.toHaveBeenCalled()
  })

  it('toggling a facet before a search refreshes facet options, not a search', async () => {
    vi.mocked(api.getFacets).mockResolvedValue({
      book: [{ key: 'genesis', count: 10 }],
      source: [],
    })

    renderPage()
    await screen.findByText('genesis')

    await userEvent.click(screen.getByText('genesis'))

    await waitFor(() => expect(api.getFacets).toHaveBeenCalledWith('grc', { books: ['genesis'], sources: [] }))
    expect(api.search).not.toHaveBeenCalled()
  })

  it('runs a search and displays results with variants and facets', async () => {
    const response: SearchResponse = {
      took_ms: 5,
      count: 1,
      page: 1,
      page_size: 50,
      results: [
        {
          id: 'gottingen:genesis:1:1',
          type: 'verse',
          book: 'genesis',
          chapter: '1',
          verse: '1',
          source: 'gottingen',
          content: 'Εν αρχη εποιησεν ο θεος',
          variant: [{ source: '664', content: 'εν αρχη επλασεν ο θεος' }],
          score: 1.2,
        },
      ],
      facets: { book: [{ key: 'genesis', count: 1 }], source: [{ key: 'gottingen', count: 1 }] },
      score_stats: null,
    }
    vi.mocked(api.search).mockResolvedValue(response)

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'θεος')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))
    expect(api.search).toHaveBeenCalledWith(
      'grc',
      'θεος',
      expect.objectContaining({ page: 1, page_size: 50, weights: HYBRID_WEIGHTS }),
    )
    expect(await screen.findByText(/Εν αρχη εποιησεν ο θεος/)).toBeInTheDocument()
    expect(screen.getByText(/εν αρχη επλασεν ο θεος/)).toBeInTheDocument()
    expect(screen.getByText('1 results in 5ms')).toBeInTheDocument()
    expect(screen.getByText('genesis')).toBeInTheDocument()
    expect(screen.getByText('gottingen')).toBeInTheDocument()
  })

  it('re-runs the search with a book filter when a facet is toggled', async () => {
    vi.mocked(api.search).mockResolvedValue({
      took_ms: 5,
      count: 1,
      page: 1,
      page_size: 50,
      results: [],
      facets: { book: [{ key: 'genesis', count: 1 }], source: [] },
      score_stats: null,
    })

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'test')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))

    await user.click(screen.getByText('genesis'))

    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(2))
    expect(api.search).toHaveBeenLastCalledWith(
      'grc',
      'test',
      expect.objectContaining({ books: ['genesis'] }),
    )
  })

  it('paginates using next/previous', async () => {
    vi.mocked(api.search).mockResolvedValue({
      took_ms: 1,
      count: 120,
      page: 1,
      page_size: 50,
      results: [
        {
          id: 'gottingen:genesis:1:1',
          type: 'verse',
          book: 'genesis',
          chapter: '1',
          verse: '1',
          source: 'gottingen',
          content: 'x',
          variant: [],
          score: 1,
        },
      ],
      facets: EMPTY_FACETS,
      score_stats: null,
    })

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'test')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(2))
    expect(api.search).toHaveBeenLastCalledWith('grc', 'test', expect.objectContaining({ page: 2 }))
  })

  it('fetches and shows score distribution stats when toggled open', async () => {
    const baseResponse: SearchResponse = {
      took_ms: 1,
      count: 1,
      page: 1,
      page_size: 50,
      results: [
        {
          id: 'gottingen:genesis:1:1',
          type: 'verse',
          book: 'genesis',
          chapter: '1',
          verse: '1',
          source: 'gottingen',
          content: 'x',
          variant: [],
          score: 1,
        },
      ],
      facets: EMPTY_FACETS,
      score_stats: null,
    }
    vi.mocked(api.search).mockResolvedValueOnce(baseResponse).mockResolvedValueOnce({
      ...baseResponse,
      score_stats: {
        count: 1,
        min: 0.1,
        max: 0.9,
        avg: 0.5,
        std_deviation: 0.2,
        percentiles: { '50.0': 0.5 },
        gap: 0.3,
        confidence: 0.4,
      },
    })

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'test')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Score distribution' }))

    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(2))
    expect(api.search).toHaveBeenLastCalledWith(
      'grc',
      'test',
      expect.objectContaining({ include_score_stats: true }),
    )
    expect(await screen.findByText('Score distribution')).toBeInTheDocument()
    expect(screen.getByText('Results on this page')).toBeInTheDocument()
    expect(screen.getByText('Percentile distribution')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'PNG' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'SVG' })).toHaveLength(2)
    expect(screen.getByText('50th')).toBeInTheDocument()
    expect(screen.getByText('0.5000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Normalized' }))
    expect(screen.getByText('0.5000')).toBeInTheDocument() // (0.5-0.1)/(0.9-0.1) = 0.5
  })

  it('shows readable language and configuration names, not raw codes/keys', async () => {
    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    expect(screen.getByLabelText('Language')).toHaveTextContent('Ancient Greek')
    expect(screen.getByLabelText('Language')).not.toHaveTextContent('grc')

    await userEvent.click(screen.getByRole('button', { name: /configuration/i }))
    expect(screen.getByLabelText('Search configuration')).toHaveTextContent('hybrid')
    expect(screen.getByLabelText('Search configuration')).not.toHaveTextContent('preset:hybrid')
  })

  it('hides and re-shows the filters sidebar', async () => {
    vi.mocked(api.search).mockResolvedValue({
      took_ms: 1,
      count: 1,
      page: 1,
      page_size: 50,
      results: [
        {
          id: 'gottingen:genesis:1:1',
          type: 'verse',
          book: 'genesis',
          chapter: '1',
          verse: '1',
          source: 'gottingen',
          content: 'x',
          variant: [],
          score: 1,
        },
      ],
      facets: { book: [{ key: 'genesis', count: 1 }], source: [] },
      score_stats: null,
    })

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'test')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await screen.findByText('Filters')

    await user.click(screen.getByRole('button', { name: 'Hide filters' }))
    expect(screen.getByRole('button', { name: 'Show filters' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show filters' }))
    expect(screen.getByRole('button', { name: 'Hide filters' })).toBeInTheDocument()
  })

  it('shows no-results message for an empty response', async () => {
    vi.mocked(api.search).mockResolvedValue({
      took_ms: 1,
      count: 0,
      page: 1,
      page_size: 50,
      results: [],
      facets: EMPTY_FACETS,
      score_stats: null,
    })

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'nothing')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByText('No results.')).toBeInTheDocument()
  })

  it('shows an error message when the search fails', async () => {
    vi.mocked(api.search).mockRejectedValue(new api.ApiError(500, 'Boom'))

    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search query'), 'test')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByText('Boom')).toBeInTheDocument()
  })

  it('toggles the configuration panel and switches configurations', async () => {
    renderPage()
    await waitFor(() => expect(api.listSearchConfigurations).toHaveBeenCalled())

    const panel = screen.getByLabelText('Search configuration').closest('[class*="grid-rows"]')
    if (!panel) throw new Error('configuration panel wrapper not found')
    expect(panel).toHaveClass('opacity-0')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /configuration/i }))

    expect(panel).toHaveClass('opacity-100')
    expect(screen.getByText('Language Agnostic')).toBeInTheDocument()
    expect(screen.getByText('Language Aware')).toBeInTheDocument()
    expect(screen.getByText('Semantics')).toBeInTheDocument()
  })
})
