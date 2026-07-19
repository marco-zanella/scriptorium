import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalResultPage } from './EvalResultPage'
import type { MetricSweepOut, ResultCollectionReportOut, TestCaseOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getResultCollectionReport: vi.fn(),
    getMetricSweep: vi.fn(),
    listTestCases: vi.fn(),
  }
})

const api = await import('./api')

const CASE_7: TestCaseOut = {
  id: 7,
  content: 'who created the world',
  language: 'eng',
  source: null,
  context: null,
  tags: [],
  targets: [],
}

const CASE_8: TestCaseOut = {
  id: 8,
  content: 'where is eden',
  language: 'eng',
  source: null,
  context: null,
  tags: [],
  targets: [],
}

const REPORT: ResultCollectionReportOut = {
  id: 99,
  test_collection_id: 1,
  test_collection_name: 'genesis eval',
  status: 'completed',
  configuration_snapshot: {
    name: 'hybrid',
    weights: {
      weights: { text: 0.2, shingle: 0, trigram: 0.1, language: 0.7, semantic: 1 },
      variant_weights: { text: 0.1, shingle: 0, trigram: 0.05, language: 0.35, semantic: 0.5 },
      bucket_weights: { lexical: 0.5, semantic: 0.5 },
      combiner: { technique: 'z_score', combination: 'arithmetic_mean' },
    },
  },
  books_snapshot: [],
  sources_snapshot: [],
  k: 10,
  tau: 1,
  recall_at_k: 0.75,
  precision_at_k: 0.2,
  mrr: 0.667,
  ndcg_at_k: 0.6,
  // deliberately unsorted by id, to exercise the default id-ascending sort
  cases: [
    {
      result_case_id: 2,
      test_case_id: 8,
      recall_at_k: 0.5,
      precision_at_k: 0.1,
      reciprocal_rank: 0.333,
      ndcg_at_k: 0.4,
    },
    {
      result_case_id: 1,
      test_case_id: 7,
      recall_at_k: 1,
      precision_at_k: 0.3,
      reciprocal_rank: 1,
      ndcg_at_k: 0.8,
    },
  ],
}

const SWEEP: MetricSweepOut = {
  tau: 1,
  mrr: 0.667,
  points: Array.from({ length: 50 }, (_, i) => ({
    k: i + 1,
    recall_at_k: Math.min(1, (i + 1) * 0.05),
    precision_at_k: 0.5 / (i + 1),
    ndcg_at_k: Math.min(1, (i + 1) * 0.04),
  })),
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/eval/results/99']}>
      <Routes>
        <Route path="/eval/results/:id" element={<EvalResultPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EvalResultPage', () => {
  beforeEach(() => {
    vi.mocked(api.getResultCollectionReport).mockReset().mockResolvedValue(REPORT)
    vi.mocked(api.getMetricSweep).mockReset().mockResolvedValue(SWEEP)
    vi.mocked(api.listTestCases).mockReset().mockResolvedValue([CASE_7, CASE_8])
  })

  it('shows aggregate metrics and the per-case breakdown, sorted by id by default, with a View action', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Run #99' })).toBeInTheDocument()
    expect(screen.getByText('hybrid')).toBeInTheDocument()

    expect(screen.getByText('0.750')).toBeInTheDocument() // Recall@10 tile
    expect(screen.getByText('0.200')).toBeInTheDocument() // Precision@10 tile
    expect(screen.getByText('0.667')).toBeInTheDocument() // MRR tile
    expect(screen.getByText('0.600')).toBeInTheDocument() // nDCG@10 tile

    const rows = screen.getAllByRole('row').slice(1) // drop header row
    expect(within(rows[0]).getByText('who created the world')).toBeInTheDocument() // id 1 first
    expect(within(rows[1]).getByText('where is eden')).toBeInTheDocument() // id 2 second

    const viewButtons = screen.getAllByRole('button', { name: 'View' })
    expect(viewButtons[0]).toHaveAttribute('href', '/eval/results/99/cases/1?k=10&tau=1')
    expect(viewButtons[1]).toHaveAttribute('href', '/eval/results/99/cases/2?k=10&tau=1')
  })

  it('links the breadcrumb back to the run\'s test collection', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })

    expect(screen.getByRole('link', { name: 'Test collections' })).toHaveAttribute(
      'href',
      '/eval/collections',
    )
    expect(screen.getByRole('link', { name: 'genesis eval' })).toHaveAttribute(
      'href',
      '/eval/collections/1/results',
    )
  })

  it('re-sorts the table when a metric column header is clicked', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Recall@10/ }))

    const rows = screen.getAllByRole('row').slice(1)
    // ascending by recall_at_k: 0.5 (id 2) then 1 (id 1)
    expect(within(rows[0]).getByText('where is eden')).toBeInTheDocument()
    expect(within(rows[1]).getByText('who created the world')).toBeInTheDocument()
  })

  it('refetches the report when tau changes via the select', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })
    vi.mocked(api.getResultCollectionReport).mockClear()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'τ (relevance threshold)' }))
    await user.click(await screen.findByRole('option', { name: 'Relevant' }))

    await waitFor(() =>
      expect(api.getResultCollectionReport).toHaveBeenCalledWith(99, { k: 10, tau: 2 }),
    )
  })

  it('refetches the report when k changes via the slider', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })
    vi.mocked(api.getResultCollectionReport).mockClear()

    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } })

    await waitFor(() =>
      expect(api.getResultCollectionReport).toHaveBeenCalledWith(99, { k: 5, tau: 1 }),
    )
  })

  it('shows the metrics-vs-k curve and lets checkboxes toggle lines off', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })

    const curve = screen.getByRole('img', { name: 'Line chart of the selected metrics across k' })
    expect(curve.querySelectorAll('path')).toHaveLength(4)

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: /Toggle Precision@k line/ }))

    expect(curve.querySelectorAll('path')).toHaveLength(3)
  })

  it('switches the per-case distribution chart metric', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })

    expect(
      screen.getByRole('img', { name: /Bar chart of nDCG@k for each test case/ }),
    ).toBeInTheDocument()

    const user = userEvent.setup()
    // "Reciprocal rank" also labels the sortable table column header — the
    // distribution metric toggle is the one rendered first, above the chart.
    await user.click(screen.getAllByRole('button', { name: 'Reciprocal rank' })[0])

    expect(
      screen.getByRole('img', { name: /Bar chart of Reciprocal rank for each test case/ }),
    ).toBeInTheDocument()
  })

  it('always shows the full configuration weight breakdown, with no expand/collapse step', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })

    expect(screen.queryByRole('button', { name: /show weights/i })).not.toBeInTheDocument()
    expect(screen.getByText('Bucket balance')).toBeInTheDocument()
    expect(screen.getByText('Z-Score normalization')).toBeInTheDocument()
  })
})
