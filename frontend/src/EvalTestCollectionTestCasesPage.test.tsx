import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCollectionTestCasesPage } from './EvalTestCollectionTestCasesPage'
import type { LanguageOut, TestCaseOut, TestCollectionOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getTestCollection: vi.fn(),
    listTestCases: vi.fn(),
    listLanguages: vi.fn(),
    listMemberTestCases: vi.fn(),
    addMemberTestCase: vi.fn(),
    removeMemberTestCase: vi.fn(),
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

const LANGUAGES: LanguageOut[] = [{ iso_code: 'eng', display_name: 'English', directionality: 'ltr' }]

const MEMBER_CASE: TestCaseOut = {
  id: 10,
  content: 'in the beginning',
  language: 'eng',
  source: 'KJV',
  context: null,
  tags: ['creation'],
  targets: [{ id: 1, target: 'kjv:genesis:1:1', relevance: 3 }],
}

const NON_MEMBER_CASE: TestCaseOut = {
  id: 20,
  content: 'who created the world',
  language: 'eng',
  source: null,
  context: null,
  tags: ['creation', 'question'],
  targets: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/eval/collections/1/test-cases']}>
      <Routes>
        <Route path="/eval/collections/:id/test-cases" element={<EvalTestCollectionTestCasesPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EvalTestCollectionTestCasesPage', () => {
  beforeEach(() => {
    vi.mocked(api.getTestCollection).mockReset().mockResolvedValue(COLLECTION)
    vi.mocked(api.listTestCases).mockReset().mockResolvedValue([MEMBER_CASE, NON_MEMBER_CASE])
    vi.mocked(api.listLanguages).mockReset().mockResolvedValue(LANGUAGES)
    vi.mocked(api.listMemberTestCases).mockReset().mockResolvedValue([MEMBER_CASE])
    vi.mocked(api.addMemberTestCase).mockReset().mockResolvedValue([])
    vi.mocked(api.removeMemberTestCase).mockReset().mockResolvedValue([])
  })

  it('lists every test case with its membership, language, source, tags, and target count', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'genesis eval' })).toBeInTheDocument()
    expect(screen.getByText('Test collections')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 test cases in this collection')).toBeInTheDocument()

    expect(screen.getByRole('checkbox', { name: 'Toggle membership for in the beginning' })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Toggle membership for who created the world' }),
    ).not.toBeChecked()

    const memberRow = screen.getByText('in the beginning').closest('tr')
    const otherRow = screen.getByText('who created the world').closest('tr')
    if (!memberRow || !otherRow) throw new Error('row not found')

    expect(within(memberRow).getByText('English')).toBeInTheDocument()
    expect(within(memberRow).getByText('KJV')).toBeInTheDocument()
    expect(within(memberRow).getByText('creation')).toBeInTheDocument()
    expect(within(memberRow).getByRole('button', { name: '1 Targets' })).toBeInTheDocument()

    expect(within(otherRow).getByText('—')).toBeInTheDocument()
    expect(within(otherRow).getByRole('button', { name: '0 Targets' })).toBeInTheDocument()
  })

  it('filters by content search', async () => {
    renderPage()
    await screen.findByText('in the beginning')

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Search content'), 'created')

    expect(screen.getByText('who created the world')).toBeInTheDocument()
    expect(screen.queryByText('in the beginning')).not.toBeInTheDocument()
  })

  it('filters by membership', async () => {
    renderPage()
    await screen.findByText('in the beginning')

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Filter by membership' }))
    await user.click(await screen.findByRole('option', { name: 'Not in collection' }))

    expect(screen.getByText('who created the world')).toBeInTheDocument()
    expect(screen.queryByText('in the beginning')).not.toBeInTheDocument()
  })

  it('adds a test case to the collection when its checkbox is checked', async () => {
    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('checkbox', { name: 'Toggle membership for who created the world' }),
    )

    await waitFor(() => expect(api.addMemberTestCase).toHaveBeenCalledWith(1, 20))
    expect(
      screen.getByRole('checkbox', { name: 'Toggle membership for who created the world' }),
    ).toBeChecked()
  })

  it('removes a test case from the collection when its checkbox is unchecked', async () => {
    renderPage()
    await screen.findByText('in the beginning')

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: 'Toggle membership for in the beginning' }))

    await waitFor(() => expect(api.removeMemberTestCase).toHaveBeenCalledWith(1, 10))
    expect(
      screen.getByRole('checkbox', { name: 'Toggle membership for in the beginning' }),
    ).not.toBeChecked()
  })

  it('shows a mixed header checkbox and bulk-adds only the non-members when checked', async () => {
    vi.mocked(api.listMemberTestCases).mockResolvedValueOnce([MEMBER_CASE])
    renderPage()
    await screen.findByText('in the beginning')

    const header = screen.getByRole('checkbox', { name: 'Toggle membership for all filtered test cases' })
    expect(header).toHaveAttribute('aria-checked', 'mixed')

    vi.mocked(api.listMemberTestCases).mockResolvedValueOnce([MEMBER_CASE, NON_MEMBER_CASE])
    const user = userEvent.setup()
    await user.click(header)

    await waitFor(() => expect(api.addMemberTestCase).toHaveBeenCalledWith(1, 20))
    expect(api.removeMemberTestCase).not.toHaveBeenCalled()
  })

  it('bulk-removes all filtered test cases when the header checkbox is fully checked', async () => {
    renderPage()
    await screen.findByText('in the beginning')

    const user = userEvent.setup()
    // Narrow the filtered set to just the member so the header starts fully checked.
    await user.click(screen.getByRole('combobox', { name: 'Filter by membership' }))
    await user.click(await screen.findByRole('option', { name: 'In collection' }))

    const header = screen.getByRole('checkbox', { name: 'Toggle membership for all filtered test cases' })
    expect(header).toBeChecked()

    vi.mocked(api.listMemberTestCases).mockResolvedValueOnce([])
    await user.click(header)

    await waitFor(() => expect(api.removeMemberTestCase).toHaveBeenCalledWith(1, 10))
    expect(api.addMemberTestCase).not.toHaveBeenCalled()
  })

  it('opens a read-only targets dialog with no edit controls', async () => {
    renderPage()
    await screen.findByText('in the beginning')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '1 Targets' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('kjv:genesis:1:1')).toBeInTheDocument()
    expect(within(dialog).getByText('Highly relevant')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
  })
})
