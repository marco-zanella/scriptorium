import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCollectionDetailPage } from './EvalTestCollectionDetailPage'
import type { ResultCollectionOut, TestCaseOut, TestCollectionOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getTestCollection: vi.fn(),
    listMemberTestCases: vi.fn(),
    listTestCases: vi.fn(),
    listResultCollections: vi.fn(),
    addMemberTestCase: vi.fn(),
    removeMemberTestCase: vi.fn(),
    runTestCollection: vi.fn(),
  }
})

const api = await import('./api')

const COLLECTION: TestCollectionOut = {
  id: 1,
  name: 'genesis eval',
  description: 'a description',
  search_configuration_id: 5,
  books: [],
  sources: [],
  test_case_count: 1,
}

const MEMBER: TestCaseOut = {
  id: 10,
  content: 'in the beginning',
  language: 'eng',
  source: null,
  context: null,
  tags: [],
  targets: [],
}

const OTHER_CASE: TestCaseOut = {
  id: 20,
  content: 'who created the world',
  language: 'eng',
  source: null,
  context: null,
  tags: [],
  targets: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/eval/collections/1']}>
      <Routes>
        <Route path="/eval/collections/:id" element={<EvalTestCollectionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EvalTestCollectionDetailPage', () => {
  beforeEach(() => {
    vi.mocked(api.getTestCollection).mockReset().mockResolvedValue(COLLECTION)
    vi.mocked(api.listMemberTestCases).mockReset().mockResolvedValue([MEMBER])
    vi.mocked(api.listTestCases).mockReset().mockResolvedValue([MEMBER, OTHER_CASE])
    vi.mocked(api.listResultCollections).mockReset().mockResolvedValue([])
    vi.mocked(api.addMemberTestCase).mockReset()
    vi.mocked(api.removeMemberTestCase).mockReset()
    vi.mocked(api.runTestCollection).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the collection, its members, and lets you add an unused test case', async () => {
    vi.mocked(api.addMemberTestCase).mockResolvedValue([MEMBER, OTHER_CASE])

    renderPage()

    expect(await screen.findByRole('heading', { name: 'genesis eval' })).toBeInTheDocument()
    expect(screen.getByText('in the beginning')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Add a test case' }))
    await user.click(await screen.findByRole('option', { name: 'who created the world' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addMemberTestCase).toHaveBeenCalledWith(1, 20))
  })

  it('removes a member test case', async () => {
    renderPage()
    await screen.findByText('in the beginning')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(api.removeMemberTestCase).toHaveBeenCalledWith(1, 10))
  })

  it('starts a run and polls until it completes', async () => {
    const pending: ResultCollectionOut = {
      id: 99,
      status: 'pending',
      configuration_snapshot: { name: 'x', weights: { weights: {}, variant_weights: {} } },
      books_snapshot: [],
      sources_snapshot: [],
      started_at: null,
      completed_at: null,
      error: null,
    }
    const completed: ResultCollectionOut = { ...pending, status: 'completed' }
    vi.mocked(api.runTestCollection).mockResolvedValue(pending)
    vi.mocked(api.listResultCollections).mockResolvedValueOnce([]).mockResolvedValue([completed])

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
