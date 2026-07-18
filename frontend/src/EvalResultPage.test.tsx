import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalResultPage } from './EvalResultPage'
import type { ResultCollectionReportOut, TestCaseOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getResultCollectionReport: vi.fn(),
    listTestCases: vi.fn(),
  }
})

const api = await import('./api')

const CASE: TestCaseOut = {
  id: 7,
  content: 'who created the world',
  language: 'eng',
  context: null,
  tags: [],
  targets: [],
}

const REPORT: ResultCollectionReportOut = {
  id: 99,
  status: 'completed',
  configuration_snapshot: { name: 'hybrid', weights: { weights: {}, variant_weights: {} } },
  books_snapshot: [],
  sources_snapshot: [],
  k: 10,
  tau: 1,
  recall_at_k: 1,
  precision_at_k: 0.333,
  mrr: 0.333,
  ndcg_at_k: 0.413,
  cases: [
    {
      result_case_id: 1,
      test_case_id: 7,
      recall_at_k: 1,
      precision_at_k: 0.333,
      reciprocal_rank: 0.333,
      ndcg_at_k: 0.413,
    },
  ],
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
    vi.mocked(api.listTestCases).mockReset().mockResolvedValue([CASE])
  })

  it('shows aggregate metrics and the per-case breakdown with real test case content', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Run #99' })).toBeInTheDocument()
    expect(screen.getByText(/hybrid/)).toBeInTheDocument()

    // aggregate stat tiles — hand-verified values from the seeded report
    // (single case, so its own metrics equal the aggregate everywhere)
    expect(screen.getAllByText('1.000')).toHaveLength(2) // Recall@10 tile + row
    // Precision@10 + MRR tiles, and precision + reciprocal-rank row cells
    expect(screen.getAllByText('0.333')).toHaveLength(4)
    expect(screen.getAllByText('0.413')).toHaveLength(2) // nDCG@10 tile + row

    expect(screen.getByText('who created the world')).toBeInTheDocument()
  })

  it('refetches the report when k or tau changes', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Run #99' })
    vi.mocked(api.getResultCollectionReport).mockClear()

    const user = userEvent.setup()
    const kInput = screen.getByLabelText('K')
    await user.clear(kInput)
    await user.type(kInput, '5')

    await waitFor(() =>
      expect(api.getResultCollectionReport).toHaveBeenCalledWith(99, { k: 5, tau: 1 }),
    )
  })
})
