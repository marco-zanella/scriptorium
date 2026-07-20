import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCollectionResultsPage } from './EvalTestCollectionResultsPage'
import type { ResultCollectionOut, TestCollectionOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getTestCollection: vi.fn(),
    listResultCollections: vi.fn(),
    runTestCollection: vi.fn(),
    deleteResultCollection: vi.fn(),
    exportResultCollection: vi.fn(),
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

const COMPLETED_RUN: ResultCollectionOut = {
  id: 3,
  status: 'completed',
  configuration_snapshot: { name: 'hybrid', weights: { weights: {}, variant_weights: {} } },
  books_snapshot: [],
  sources_snapshot: [],
  started_at: '2026-07-18T17:20:33.038916Z',
  completed_at: '2026-07-18T17:20:33.083104Z',
  error: null,
  recall_at_k: 1.0,
  precision_at_k: 0.1,
  mrr: 1.0,
  ndcg_at_k: 1.0,
}

const FAILED_RUN: ResultCollectionOut = {
  id: 2,
  status: 'failed',
  configuration_snapshot: { name: 'hybrid', weights: { weights: {}, variant_weights: {} } },
  books_snapshot: [],
  sources_snapshot: [],
  started_at: '2026-07-18T17:18:11.744378Z',
  completed_at: '2026-07-18T17:18:12.000000Z',
  error: 'OpenSearch timed out',
  recall_at_k: null,
  precision_at_k: null,
  mrr: null,
  ndcg_at_k: null,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/eval/collections/1/results']}>
      <Routes>
        <Route path="/eval/collections/:id/results" element={<EvalTestCollectionResultsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EvalTestCollectionResultsPage', () => {
  beforeEach(() => {
    vi.mocked(api.getTestCollection).mockReset().mockResolvedValue(COLLECTION)
    vi.mocked(api.listResultCollections).mockReset().mockResolvedValue([COMPLETED_RUN, FAILED_RUN])
    vi.mocked(api.runTestCollection).mockReset()
    vi.mocked(api.deleteResultCollection).mockReset()
    vi.mocked(api.exportResultCollection).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists runs with status, configuration, and metrics', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'genesis eval' })).toBeInTheDocument()
    expect(screen.getByText('Test collections')).toBeInTheDocument()
    expect(screen.getByText('Results')).toBeInTheDocument()

    const completedRow = screen.getByText('completed').closest('tr')
    const failedRow = screen.getByText('failed').closest('tr')
    if (!completedRow || !failedRow) throw new Error('row not found')

    expect(within(completedRow).getByText('hybrid')).toBeInTheDocument()
    expect(within(completedRow).getAllByText('1.000')).toHaveLength(3) // MRR, Recall@10, nDCG@10
    expect(within(completedRow).getByText('0.100')).toBeInTheDocument() // Precision@10
    expect(within(completedRow).queryAllByText('—')).toHaveLength(0)

    // failed run has no metrics — its 4 metric cells fall back to the dash
    expect(within(failedRow).queryAllByText('—')).toHaveLength(4)
    expect(within(failedRow).getByText('OpenSearch timed out')).toBeInTheDocument()
  })

  it('shows an empty state when there are no runs', async () => {
    vi.mocked(api.listResultCollections).mockReset().mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
  })

  it('disables the Run button when the collection has no test cases', async () => {
    vi.mocked(api.getTestCollection)
      .mockReset()
      .mockResolvedValue({ ...COLLECTION, test_case_count: 0 })
    renderPage()

    expect(await screen.findByRole('button', { name: 'Run' })).toBeDisabled()
  })

  it('links the View button to the run detail page', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'genesis eval' })

    const completedRow = screen.getByText('completed').closest('tr')
    if (!completedRow) throw new Error('row not found')
    expect(within(completedRow).getByRole('button', { name: 'View' })).toHaveAttribute(
      'href',
      '/eval/results/3',
    )
  })

  it('deletes a run after confirmation', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'genesis eval' })

    const user = userEvent.setup()
    const completedRow = screen.getByText('completed').closest('tr')
    if (!completedRow) throw new Error('row not found')

    await user.click(within(completedRow).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteResultCollection).toHaveBeenCalledWith(3))
    await waitFor(() => expect(screen.queryByText('completed')).not.toBeInTheDocument())
  })

  it('disables Export for a non-completed run and exports a completed one', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'genesis eval' })

    const user = userEvent.setup()
    const completedRow = screen.getByText('completed').closest('tr')
    const failedRow = screen.getByText('failed').closest('tr')
    if (!completedRow || !failedRow) throw new Error('row not found')

    expect(within(failedRow).getByRole('button', { name: 'Export' })).toBeDisabled()

    await user.click(within(completedRow).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(api.exportResultCollection).toHaveBeenCalledWith(3))
  })

  it('starts a run and polls until it completes', async () => {
    const pending: ResultCollectionOut = {
      id: 99,
      status: 'pending',
      configuration_snapshot: { name: 'hybrid', weights: { weights: {}, variant_weights: {} } },
      books_snapshot: [],
      sources_snapshot: [],
      started_at: null,
      completed_at: null,
      error: null,
      recall_at_k: null,
      precision_at_k: null,
      mrr: null,
      ndcg_at_k: null,
    }
    const completed: ResultCollectionOut = { ...pending, status: 'completed' }
    vi.mocked(api.runTestCollection).mockResolvedValue(pending)
    vi.mocked(api.listResultCollections)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([completed])

    renderPage()
    await screen.findByRole('heading', { name: 'genesis eval' })

    // fake timers only take over *after* the initial real-timer-driven load
    // settles — enabling them any earlier hangs findByText's own retry loop
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    })
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByText('pending')).toBeInTheDocument())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument())
  })
})
