import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalCompareResultsPage } from './EvalCompareResultsPage'
import type { ComparisonOut, TestCollectionOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getComparison: vi.fn(),
    getTestCollection: vi.fn(),
  }
})

const api = await import('./api')

const COLLECTION: TestCollectionOut = {
  id: 1,
  name: 'genesis eval',
  description: null,
  search_configuration_id: 5,
  books: [],
  sources: [],
  test_case_count: 2,
}

const COMPARISON: ComparisonOut = {
  baseline_id: 10,
  baseline_configuration_name: 'baseline-cfg',
  test_collection_id: 1,
  test_collection_name: 'genesis eval',
  k: 10,
  tau: 1,
  comparisons: [
    {
      candidate_id: 20,
      candidate_configuration_name: 'candidate-cfg',
      overlap_case_count: 2,
      recall_at_k: {
        baseline: 0.5,
        candidate: 0.75,
        delta: 0.25,
        wilcoxon_statistic: 1.0,
        wilcoxon_p_value: 0.5,
        n: 2,
      },
      precision_at_k: {
        baseline: 0.05,
        candidate: 0.1,
        delta: 0.05,
        wilcoxon_statistic: 1.0,
        wilcoxon_p_value: 0.5,
        n: 2,
      },
      reciprocal_rank: {
        baseline: 0.5,
        candidate: 0.7,
        delta: 0.2,
        wilcoxon_statistic: 1.0,
        wilcoxon_p_value: 0.5,
        n: 2,
      },
      ndcg_at_k: {
        baseline: 0.5,
        candidate: 1,
        delta: 0.5,
        wilcoxon_statistic: null,
        wilcoxon_p_value: null,
        n: 0,
      },
      found_at_k: { n_baseline_only: 0, n_candidate_only: 1, statistic: 0, p_value: 1.0 },
      cases: [
        {
          test_case_id: 7,
          content: 'who created the world',
          baseline: { recall_at_k: 0, precision_at_k: 0, reciprocal_rank: 0, ndcg_at_k: 0 },
          candidate: { recall_at_k: 1, precision_at_k: 0.1, reciprocal_rank: 1, ndcg_at_k: 1 },
        },
        {
          test_case_id: 8,
          content: 'where is eden',
          baseline: { recall_at_k: 1, precision_at_k: 0.1, reciprocal_rank: 1, ndcg_at_k: 1 },
          candidate: { recall_at_k: 0.5, precision_at_k: 0.1, reciprocal_rank: 0.5, ndcg_at_k: 1 },
        },
      ],
    },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/eval/collections/1/compare?baseline=10&candidates=20']}>
      <Routes>
        <Route path="/eval/collections/:id/compare" element={<EvalCompareResultsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EvalCompareResultsPage', () => {
  beforeEach(() => {
    vi.mocked(api.getComparison).mockReset().mockResolvedValue(COMPARISON)
    vi.mocked(api.getTestCollection).mockReset().mockResolvedValue(COLLECTION)
  })

  it('shows the baseline and a per-candidate delta card', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Compare runs' })).toBeInTheDocument()
    expect(screen.getByText('Baseline: Run #10 — baseline-cfg')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Run #20 — candidate-cfg' }),
    ).toBeInTheDocument()

    expect(screen.getByText('+0.250')).toBeInTheDocument() // recall delta
    expect(screen.getByText('+0.500')).toBeInTheDocument() // ndcg delta

    expect(
      screen.getByText(/1 case newly found, 0 cases newly missed \(p=1\.000\)/),
    ).toBeInTheDocument()
  })

  it('shows the per-case table with baseline/candidate/delta for the selected metric', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Compare runs' })

    // default distribution metric is nDCG@k
    const worldRow = screen.getByText('who created the world').closest('tr')
    if (!worldRow) throw new Error('row not found')
    expect(within(worldRow).getByText('0.000')).toBeInTheDocument()
    expect(within(worldRow).getByText('1.000')).toBeInTheDocument()
    expect(within(worldRow).getByText('+1.000')).toBeInTheDocument()
  })

  it('switches the per-case metric shown in the table', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Compare runs' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Recall@k' }))

    const edenRow = screen.getByText('where is eden').closest('tr')
    if (!edenRow) throw new Error('row not found')
    // recall_at_k: baseline 1, candidate 0.5 -> delta -0.5
    expect(within(edenRow).getByText('1.000')).toBeInTheDocument()
    expect(within(edenRow).getByText('0.500')).toBeInTheDocument()
    expect(within(edenRow).getByText('-0.500')).toBeInTheDocument()
  })

  it('re-fetches with the swapped baseline when the baseline selector changes', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Compare runs' })
    vi.mocked(api.getComparison).mockClear()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Baseline' }))
    await user.click(await screen.findByRole('option', { name: 'Run #20' }))

    await waitFor(() =>
      expect(api.getComparison).toHaveBeenCalledWith(20, [10], { k: 10, tau: 1 }),
    )
  })

  it('links the breadcrumb back to the collection results page', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Compare runs' })

    expect(screen.getByRole('link', { name: 'genesis eval' })).toHaveAttribute(
      'href',
      '/eval/collections/1/results',
    )
  })
})
