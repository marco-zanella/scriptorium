import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCasesPage } from './EvalTestCasesPage'
import type { TestCaseOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listTestCases: vi.fn(),
    createTestCase: vi.fn(),
    updateTestCase: vi.fn(),
    deleteTestCase: vi.fn(),
    addTestCaseTarget: vi.fn(),
    deleteTestCaseTarget: vi.fn(),
  }
})

const api = await import('./api')

const CASE_WITH_TARGET: TestCaseOut = {
  id: 1,
  content: 'who created the world',
  language: 'eng',
  context: null,
  tags: ['genesis'],
  targets: [{ id: 10, target: 'eng:genesis:1:1', relevance: 3 }],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EvalTestCasesPage />
    </MemoryRouter>,
  )
}

describe('EvalTestCasesPage', () => {
  beforeEach(() => {
    vi.mocked(api.listTestCases).mockReset().mockResolvedValue([CASE_WITH_TARGET])
    vi.mocked(api.createTestCase).mockReset()
    vi.mocked(api.updateTestCase).mockReset()
    vi.mocked(api.deleteTestCase).mockReset()
    vi.mocked(api.addTestCaseTarget).mockReset()
    vi.mocked(api.deleteTestCaseTarget).mockReset()
  })

  it('lists test cases with their target count', async () => {
    renderPage()

    expect(await screen.findByText('who created the world')).toBeInTheDocument()
    expect(screen.getByText('eng')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('creates a new test case', async () => {
    vi.mocked(api.createTestCase).mockResolvedValue({
      id: 2,
      content: 'new query',
      language: 'grc',
      context: null,
      tags: [],
      targets: [],
    })

    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New test case' }))
    await user.type(screen.getByLabelText('Query content'), 'new query')
    await user.type(screen.getByLabelText('Language (ISO code)'), 'grc')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(api.createTestCase).toHaveBeenCalledWith({
        content: 'new query',
        language: 'grc',
        context: null,
        tags: [],
      }),
    )
  })

  it('deletes a test case after confirmation', async () => {
    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteTestCase).toHaveBeenCalledWith(1))
  })

  it('adds and removes a target via the target editor', async () => {
    vi.mocked(api.addTestCaseTarget).mockResolvedValue({
      id: 20,
      target: 'eng:genesis:1:2',
      relevance: 2,
    })

    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Targets' }))
    expect(await screen.findByText('eng:genesis:1:1')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Content id'), 'eng:genesis:1:2')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(api.addTestCaseTarget).toHaveBeenCalledWith(1, 'eng:genesis:1:2', 1),
    )
    expect(await screen.findByText('eng:genesis:1:2')).toBeInTheDocument()

    const originalRow = screen.getByText('eng:genesis:1:1').closest('tr')
    if (!originalRow) throw new Error('row not found')
    await user.click(within(originalRow).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.deleteTestCaseTarget).toHaveBeenCalledWith(1, 10))
  })
})
