import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalResultCasePage } from './EvalResultCasePage'
import type { ResultCaseDetailOut, SearchHit } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getResultCaseDetail: vi.fn(),
    getDocument: vi.fn(),
  }
})

const api = await import('./api')

const MISSED_DOCUMENT: SearchHit = {
  id: 'kjv:genesis:3:1',
  type: 'verse',
  book: 'genesis',
  chapter: '3',
  verse: '1',
  source: 'kjv',
  content: 'Now the serpent was more subtil.',
  variant: [],
  score: 0,
}

const DETAIL: ResultCaseDetailOut = {
  id: 5,
  test_case_id: 1,
  test_collection_id: 1,
  test_collection_name: 'genesis eval',
  results: [
    {
      id: 'kjv:genesis:1:1',
      type: 'verse',
      book: 'genesis',
      chapter: '1',
      verse: '1',
      source: 'kjv',
      content: 'In the beginning God created the heaven and the earth.',
      variant: [],
      score: 2.1,
    },
    {
      id: 'kjv:exodus:3:14',
      type: 'verse',
      book: 'exodus',
      chapter: '3',
      verse: '14',
      source: 'kjv',
      content: 'I am that I am.',
      variant: [{ source: 'gottingen', content: 'variant reading of exodus 3:14' }],
      score: 1.5,
    },
    {
      id: 'kjv:genesis:2:4',
      type: 'verse',
      book: 'genesis',
      chapter: '2',
      verse: '4',
      source: 'kjv',
      content: 'These are the generations.',
      variant: [],
      score: 1.1,
    },
  ],
  snapshot: {
    content: 'in the beginning',
    language: 'eng',
    source: 'kjv',
    context: 'creation narrative',
    tags: ['creation', 'origins'],
    targets: [
      { target: 'kjv:genesis:1:1', relevance: 3 },
      { target: 'kjv:genesis:2:4', relevance: 1 },
      { target: 'kjv:genesis:3:1', relevance: 2 },
    ],
  },
  score_stats: {
    count: 3,
    min: 1.1,
    max: 2.1,
    avg: 1.5,
    std_deviation: 0.5,
    percentiles: { '0': 1.1, '50': 1.5, '100': 2.1 },
    gap: 0.2,
    confidence: 0.4,
  },
  recall_at_k: 1,
  precision_at_k: 0.2,
  reciprocal_rank: 1,
  ndcg_at_k: 0.9,
}

function renderPage(initialEntry = '/eval/results/3/cases/5?k=10&tau=1') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/eval/results/:resultCollectionId/cases/:caseId"
          element={<EvalResultCasePage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EvalResultCasePage', () => {
  beforeEach(() => {
    vi.mocked(api.getResultCaseDetail).mockReset().mockResolvedValue(DETAIL)
    vi.mocked(api.getDocument).mockReset().mockResolvedValue(MISSED_DOCUMENT)
  })

  it('shows the test case content, context, source, tags, and breadcrumb back to the run and collection', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'in the beginning' })).toBeInTheDocument()
    expect(screen.getByText('creation narrative')).toBeInTheDocument()
    expect(screen.getByText('Source: kjv')).toBeInTheDocument()
    expect(screen.getByText('creation')).toBeInTheDocument()
    expect(screen.getByText('origins')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Test collections' })).toHaveAttribute(
      'href',
      '/eval/collections',
    )
    expect(screen.getByRole('link', { name: 'genesis eval' })).toHaveAttribute(
      'href',
      '/eval/collections/1/results',
    )
    expect(screen.getByRole('link', { name: 'Run #3' })).toHaveAttribute('href', '/eval/results/3')
    expect(screen.getByText('Case #5')).toBeInTheDocument()
  })

  it('shows the per-case stat tiles', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    expect(screen.getAllByText('1.000')).toHaveLength(2) // Recall@10 and Reciprocal rank
    expect(screen.getByText('0.200')).toBeInTheDocument() // Precision@10
    expect(screen.getByText('0.900')).toBeInTheDocument() // nDCG@10
  })

  it('summarizes targets with resolved content, relevance, and position — blank for a missed target', async () => {
    // Controlled manually so the still-loading DOM state below can be asserted
    // deterministically instead of racing the mock's own microtask resolution.
    let resolveDocument: (hit: SearchHit) => void
    vi.mocked(api.getDocument).mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolveDocument = resolve
      }),
    )

    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    const targetsTable = screen.getAllByRole('table')[0]
    const rows = within(targetsTable).getAllByRole('row').slice(1)

    expect(within(rows[0]).getByText('kjv:genesis:1:1')).toBeInTheDocument()
    expect(
      within(rows[0]).getByText('In the beginning God created the heaven and the earth.'),
    ).toBeInTheDocument()
    expect(within(rows[0]).getByText('Highly relevant')).toBeInTheDocument()
    expect(within(rows[0]).getByText('1')).toBeInTheDocument()

    expect(within(rows[1]).getByText('kjv:genesis:2:4')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Marginally relevant')).toBeInTheDocument()
    expect(within(rows[1]).getByText('3')).toBeInTheDocument()

    // Missed target: no position, content resolved asynchronously via getDocument.
    // Both the content and position cells show the placeholder dash until resolution.
    expect(within(rows[2]).getByText('kjv:genesis:3:1')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Relevant')).toBeInTheDocument()
    expect(within(rows[2]).getAllByText('—')).toHaveLength(2)

    resolveDocument(MISSED_DOCUMENT)
    expect(await within(rows[2]).findByText('Now the serpent was more subtil.')).toBeInTheDocument()
    expect(within(rows[2]).getAllByText('—')).toHaveLength(1)
    expect(api.getDocument).toHaveBeenCalledWith('eng', 'kjv:genesis:3:1')
  })

  it('shows ranked results with rank, id, content, raw score, and relevance', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    const resultsTable = screen.getAllByRole('table')[1]
    const rows = within(resultsTable).getAllByRole('row').slice(1)

    expect(within(rows[0]).getByText('kjv:genesis:1:1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('2.100')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Highly relevant')).toBeInTheDocument()

    expect(within(rows[1]).getByText('kjv:exodus:3:14')).toBeInTheDocument()
    expect(within(rows[1]).getByText('1.500')).toBeInTheDocument()
    expect(within(rows[1]).getByText('—')).toBeInTheDocument()

    expect(within(rows[2]).getByText('kjv:genesis:2:4')).toBeInTheDocument()
    expect(within(rows[2]).getByText('1.100')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Marginally relevant')).toBeInTheDocument()
  })

  it('switches the ranked-results score column between raw, normalized, and standardized via the shared toggle', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })
    const user = userEvent.setup()

    const resultsTable = screen.getAllByRole('table')[1]

    await user.click(screen.getByRole('button', { name: 'Normalized' }))
    let rows = within(resultsTable).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('1.000')).toBeInTheDocument()
    expect(within(rows[1]).getByText('0.400')).toBeInTheDocument()
    expect(within(rows[2]).getByText('0.000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Standardized' }))
    rows = within(resultsTable).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('1.200')).toBeInTheDocument()
    expect(within(rows[1]).getByText('0.000')).toBeInTheDocument()
    expect(within(rows[2]).getByText('-0.800')).toBeInTheDocument()
  })

  it('keeps variants collapsed by default and reveals them on toggle', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    expect(screen.queryByText('variant reading of exodus 3:14')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: '1 variant' })

    await userEvent.setup().click(toggle)

    expect(screen.getByText('variant reading of exodus 3:14')).toBeInTheDocument()
    expect(screen.getByText('gottingen:')).toBeInTheDocument()
  })

  it('shows the score distribution panel when score stats are available', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    expect(screen.getByText('Percentile distribution')).toBeInTheDocument()
  })

  it("falls back to a message when a run has no score stats", async () => {
    vi.mocked(api.getResultCaseDetail).mockReset().mockResolvedValue({ ...DETAIL, score_stats: null })
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    expect(screen.getByText("Score distribution isn't available for this run.")).toBeInTheDocument()
    expect(screen.queryByText('Percentile distribution')).not.toBeInTheDocument()
    // Raw score still shown even with no stats to switch modes against.
    const resultsTable = screen.getAllByRole('table')[1]
    expect(within(resultsTable).getByText('2.100')).toBeInTheDocument()
  })

  it('refetches the case detail when k changes via the slider', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })
    vi.mocked(api.getResultCaseDetail).mockClear()

    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } })

    await waitFor(() => expect(api.getResultCaseDetail).toHaveBeenCalledWith(3, 5, { k: 5, tau: 1 }))
  })

  it('refetches the case detail when tau changes via the select', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })
    vi.mocked(api.getResultCaseDetail).mockClear()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'τ (relevance threshold)' }))
    await user.click(await screen.findByRole('option', { name: 'Relevant' }))

    await waitFor(() => expect(api.getResultCaseDetail).toHaveBeenCalledWith(3, 5, { k: 10, tau: 2 }))
  })

  it('reads the initial k and tau from the URL query params', async () => {
    renderPage('/eval/results/3/cases/5?k=25&tau=0')
    await screen.findByRole('heading', { name: 'in the beginning' })

    await waitFor(() => expect(api.getResultCaseDetail).toHaveBeenCalledWith(3, 5, { k: 25, tau: 0 }))
  })
})
