import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalResultCasePage } from './EvalResultCasePage'
import type { ResultCaseDetailOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getResultCaseDetail: vi.fn(),
  }
})

const api = await import('./api')

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
      variant: [],
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
    context: 'creation narrative',
    targets: [
      { target: 'kjv:genesis:1:1', relevance: 3 },
      { target: 'kjv:genesis:2:4', relevance: 1 },
      { target: 'kjv:genesis:3:1', relevance: 2 },
    ],
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
  })

  it('shows the test case content, context, and breadcrumb back to the run and collection', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'in the beginning' })).toBeInTheDocument()
    expect(screen.getByText('creation narrative')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Test collections' })).toHaveAttribute(
      'href',
      '/eval/collections',
    )
    expect(screen.getByRole('link', { name: 'genesis eval' })).toHaveAttribute(
      'href',
      '/eval/collections/1/results',
    )
    expect(screen.getByRole('link', { name: 'Run #3' })).toHaveAttribute(
      'href',
      '/eval/results/3',
    )
    expect(screen.getByText('Case #5')).toBeInTheDocument()
  })

  it('shows the per-case stat tiles', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    expect(screen.getAllByText('1.000')).toHaveLength(2) // Recall@10 and Reciprocal rank
    expect(screen.getByText('0.200')).toBeInTheDocument() // Precision@10
    expect(screen.getByText('0.900')).toBeInTheDocument() // nDCG@10
  })

  it('annotates ranked results with their graded relevance, and lists missed targets', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'in the beginning' })

    const rows = screen.getAllByRole('row').slice(1, 4) // 3 ranked result rows
    expect(within(rows[0]).getByText('genesis 1:1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Highly relevant')).toBeInTheDocument()
    expect(within(rows[1]).getByText('exodus 3:14')).toBeInTheDocument()
    expect(within(rows[1]).getByText('—')).toBeInTheDocument()
    expect(within(rows[2]).getByText('genesis 2:4')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Marginally relevant')).toBeInTheDocument()

    expect(screen.getByText('Missed targets')).toBeInTheDocument()
    expect(screen.getByText('kjv:genesis:3:1')).toBeInTheDocument()
    expect(screen.getByText('Relevant')).toBeInTheDocument()
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

    await waitFor(() =>
      expect(api.getResultCaseDetail).toHaveBeenCalledWith(3, 5, { k: 10, tau: 2 }),
    )
  })

  it('reads the initial k and tau from the URL query params', async () => {
    renderPage('/eval/results/3/cases/5?k=25&tau=0')
    await screen.findByRole('heading', { name: 'in the beginning' })

    await waitFor(() =>
      expect(api.getResultCaseDetail).toHaveBeenCalledWith(3, 5, { k: 25, tau: 0 }),
    )
  })
})
