import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvalTestCasesPage } from './EvalTestCasesPage'
import type { LanguageOut, TestCaseOut } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    listTestCases: vi.fn(),
    listLanguages: vi.fn(),
    createTestCase: vi.fn(),
    updateTestCase: vi.fn(),
    deleteTestCase: vi.fn(),
    addTestCaseTarget: vi.fn(),
    deleteTestCaseTarget: vi.fn(),
    contentSearch: vi.fn(),
    bulkImportTestCases: vi.fn(),
  }
})

const api = await import('./api')

const LANGUAGES: LanguageOut[] = [
  { iso_code: 'eng', display_name: 'English', directionality: 'ltr' },
  { iso_code: 'grc', display_name: 'Ancient Greek', directionality: 'ltr' },
]

const CASE_WITH_TARGET: TestCaseOut = {
  id: 1,
  content: 'who created the world',
  language: 'eng',
  source: null,
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
    vi.mocked(api.listLanguages).mockReset().mockResolvedValue(LANGUAGES)
    vi.mocked(api.createTestCase).mockReset()
    vi.mocked(api.updateTestCase).mockReset()
    vi.mocked(api.deleteTestCase).mockReset()
    vi.mocked(api.addTestCaseTarget).mockReset()
    vi.mocked(api.deleteTestCaseTarget).mockReset()
    vi.mocked(api.bulkImportTestCases).mockReset()
  })

  it('lists test cases with their language display name and target count', async () => {
    renderPage()

    expect(await screen.findByText('who created the world')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 Targets' })).toBeInTheDocument()
  })

  it('creates a new test case with a picked language, source, and typed tags', async () => {
    vi.mocked(api.createTestCase).mockResolvedValue({
      id: 2,
      content: 'new query',
      language: 'grc',
      source: 'Protrepticus, Clemens of Alexandria',
      context: null,
      tags: ['philosophy'],
      targets: [],
    })

    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New test case' }))
    await user.type(screen.getByLabelText('Query content'), 'new query')

    await user.click(screen.getByRole('combobox', { name: 'Language' }))
    await user.click(await screen.findByRole('option', { name: 'Ancient Greek' }))

    await user.type(
      screen.getByLabelText('Source (optional)'),
      'Protrepticus, Clemens of Alexandria',
    )
    await user.type(screen.getByLabelText('Tags'), 'philosophy{enter}')
    expect(screen.getByText('philosophy')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(api.createTestCase).toHaveBeenCalledWith({
        content: 'new query',
        language: 'grc',
        source: 'Protrepticus, Clemens of Alexandria',
        context: null,
        tags: ['philosophy'],
      }),
    )
  })

  it('removes a tag via its badge before submitting', async () => {
    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('genesis')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove genesis' }))
    expect(screen.queryByText('genesis')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateTestCase).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ tags: [] }),
      ),
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
    vi.mocked(api.contentSearch).mockResolvedValue([
      {
        id: 'eng:genesis:1:2',
        type: 'verse',
        book: 'Genesis',
        chapter: '1',
        verse: '2',
        source: null,
        content: 'the earth was without form',
        variant: [],
        score: 1,
      },
    ])
    vi.mocked(api.addTestCaseTarget).mockResolvedValue({
      id: 20,
      target: 'eng:genesis:1:2',
      relevance: 2,
    })

    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '1 Targets' }))
    expect(await screen.findByText('eng:genesis:1:1')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Find content to target'), 'genesis 1:2')
    await waitFor(() => expect(api.contentSearch).toHaveBeenCalledWith('eng', 'genesis 1:2'))

    await user.click(await screen.findByRole('option', { name: /Genesis 1:2/ }))

    await waitFor(() =>
      expect(api.addTestCaseTarget).toHaveBeenCalledWith(1, 'eng:genesis:1:2', 1),
    )
    expect(await screen.findByText('eng:genesis:1:2')).toBeInTheDocument()

    const originalRow = screen.getByText('eng:genesis:1:1').closest('tr')
    if (!originalRow) throw new Error('row not found')
    await user.click(within(originalRow).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.deleteTestCaseTarget).toHaveBeenCalledWith(1, 10))
  })

  it('imports a JSON file and reports created rows plus per-row errors', async () => {
    vi.mocked(api.bulkImportTestCases).mockResolvedValue({
      created: [
        { id: 3, content: 'good row', language: 'eng', source: null, context: null, tags: [], targets: [] },
      ],
      errors: [{ index: 1, error: 'Unknown language: not-a-real-language' }],
    })

    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    const file = new File(
      [JSON.stringify([{ content: 'good row', language: 'eng' }, { content: 'bad row', language: 'x' }])],
      'test-cases.json',
      { type: 'application/json' },
    )
    await user.upload(screen.getByLabelText('Import test cases'), file)

    await waitFor(() => expect(api.bulkImportTestCases).toHaveBeenCalled())
    expect(await screen.findByText('Imported 1 test case.')).toBeInTheDocument()
    expect(
      screen.getByText('Row 2: Unknown language: not-a-real-language'),
    ).toBeInTheDocument()
  })

  it('shows an inline error when the imported file is not valid JSON', async () => {
    renderPage()
    await screen.findByText('who created the world')

    const user = userEvent.setup()
    const file = new File(['not json'], 'test-cases.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Import test cases'), file)

    expect(
      await screen.findByText(
        'Failed to import test cases — check the file is a JSON array of test cases',
      ),
    ).toBeInTheDocument()
    expect(api.bulkImportTestCases).not.toHaveBeenCalled()
  })
})
