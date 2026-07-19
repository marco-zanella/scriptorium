import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import {
  ApiError,
  addTestCaseTarget,
  contentSearch,
  createTestCase,
  deleteTestCase,
  deleteTestCaseTarget,
  listLanguages,
  listTestCases,
  updateTestCase,
  type LanguageOut,
  type SearchHit,
  type TestCaseInput,
  type TestCaseOut,
} from './api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

export function EvalTestCasesPage() {
  const [cases, setCases] = useState<TestCaseOut[]>([])
  const [languages, setLanguages] = useState<LanguageOut[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TestCaseOut | null>(null)
  const [managingTargets, setManagingTargets] = useState<TestCaseOut | null>(null)
  const [search, setSearch] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const tagsAnchor = useComboboxAnchor()

  const allTags = useMemo(
    () => Array.from(new Set(cases.flatMap((c) => c.tags))).sort(),
    [cases],
  )

  const filteredCases = useMemo(() => {
    const query = search.trim().toLowerCase()
    return cases.filter((c) => {
      if (query && !c.content.toLowerCase().includes(query)) return false
      if (languageFilter && c.language !== languageFilter) return false
      if (selectedTags.size > 0 && !c.tags.some((tag) => selectedTags.has(tag))) return false
      return true
    })
  }, [cases, search, languageFilter, selectedTags])

  async function load() {
    try {
      const [caseList, languageList] = await Promise.all([listTestCases(), listLanguages()])
      setCases(caseList)
      setLanguages(languageList)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load test cases')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(testCase: TestCaseOut) {
    await deleteTestCase(testCase.id)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl leading-snug font-medium">Test cases</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button>New test case</Button>} />
          <DialogContent className="sm:max-w-lg">
            <TestCaseForm
              languages={languages}
              onSubmit={async (body) => {
                await createTestCase(body)
                setCreateOpen(false)
                await load()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search content"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-64"
        />
        <Select value={languageFilter} onValueChange={(value) => setLanguageFilter(value ?? '')}>
          <SelectTrigger aria-label="Filter by language" className="w-48">
            <SelectValue placeholder="All languages">
              {languages.find((lang) => lang.iso_code === languageFilter)?.display_name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All languages</SelectItem>
            {languages.map((lang) => (
              <SelectItem key={lang.iso_code} value={lang.iso_code}>
                {lang.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Combobox
            multiple
            items={allTags}
            value={Array.from(selectedTags)}
            onValueChange={(values: string[]) => setSelectedTags(new Set(values))}
          >
            <ComboboxChips ref={tagsAnchor} className="w-64">
              <ComboboxValue>
                {(values: string[]) => (
                  <>
                    {values.map((tag) => (
                      <ComboboxChip key={tag}>{tag}</ComboboxChip>
                    ))}
                    <ComboboxChipsInput
                      placeholder={values.length ? '' : 'Filter by tags'}
                      aria-label="Filter by tags"
                    />
                  </>
                )}
              </ComboboxValue>
            </ComboboxChips>
            <ComboboxContent anchor={tagsAnchor}>
              <ComboboxEmpty>No tags found.</ComboboxEmpty>
              <ComboboxList>
                {(tag: string) => (
                  <ComboboxItem key={tag} value={tag}>
                    {tag}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Content</TableHead>
            <TableHead>Language</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Targets</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredCases.map((testCase) => (
            <TableRow key={testCase.id}>
              <TableCell>{testCase.content}</TableCell>
              <TableCell>
                {languages.find((lang) => lang.iso_code === testCase.language)?.display_name ??
                  testCase.language}
              </TableCell>
              <TableCell>{testCase.source ?? '—'}</TableCell>
              <TableCell>
                <Dialog
                  open={managingTargets?.id === testCase.id}
                  onOpenChange={(open) => setManagingTargets(open ? testCase : null)}
                >
                  <DialogTrigger
                    render={
                      <Button variant="outline" size="sm">
                        {testCase.targets.length} Targets
                      </Button>
                    }
                  />
                  <DialogContent className="sm:max-w-lg">
                    <TargetEditor testCase={testCase} onChanged={load} />
                  </DialogContent>
                </Dialog>
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Dialog
                    open={editing?.id === testCase.id}
                    onOpenChange={(open) => setEditing(open ? testCase : null)}
                  >
                    <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
                    <DialogContent className="sm:max-w-lg">
                      <TestCaseForm
                        languages={languages}
                        initial={testCase}
                        onSubmit={async (body) => {
                          await updateTestCase(testCase.id, body)
                          setEditing(null)
                          await load()
                        }}
                      />
                    </DialogContent>
                  </Dialog>

                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button variant="destructive" size="sm">
                          Delete
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this test case?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the test case and its targets. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(testCase)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function TestCaseForm({
  languages,
  initial,
  onSubmit,
}: {
  languages: LanguageOut[]
  initial?: TestCaseOut
  onSubmit: (body: TestCaseInput) => Promise<void>
}) {
  const isEdit = initial !== undefined
  const [content, setContent] = useState(initial?.content ?? '')
  const [language, setLanguage] = useState(initial?.language ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [context, setContext] = useState(initial?.context ?? '')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit({
        content,
        language,
        source: source || null,
        context: context || null,
        tags,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit test case' : 'New test case'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="case-content">Query content</Label>
        <Input
          id="case-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Language</p>
        <Select value={language} onValueChange={(value) => value && setLanguage(value)}>
          <SelectTrigger aria-label="Language">
            <SelectValue placeholder="Select a language">
              {languages.find((lang) => lang.iso_code === language)?.display_name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {languages.map((lang) => (
              <SelectItem key={lang.iso_code} value={lang.iso_code}>
                {lang.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="case-source">Source (optional)</Label>
        <Input
          id="case-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="e.g. Protrepticus, Clemens of Alexandria"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="case-context">Context (optional)</Label>
        <Textarea
          id="case-context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
      </div>
      <TagsEditor tags={tags} onChange={setTags} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={!language}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')

  function commitDraft() {
    const trimmed = draft.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commitDraft()
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="case-tags">Tags</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input p-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id="case-tags"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          placeholder="Add a tag…"
          className="min-w-24 flex-1 bg-transparent p-1 text-sm outline-none"
        />
      </div>
    </div>
  )
}

const RELEVANCE_LEVELS = [
  { value: 0, label: 'Not relevant' },
  { value: 1, label: 'Marginally relevant' },
  { value: 2, label: 'Relevant' },
  { value: 3, label: 'Highly relevant' },
]

function relevanceLabel(value: number): string {
  return RELEVANCE_LEVELS.find((level) => level.value === value)?.label ?? String(value)
}

function describeHit(hit: SearchHit): string {
  if (hit.book && hit.chapter && hit.verse) {
    return `${hit.book} ${hit.chapter}:${hit.verse}`
  }
  return hit.source ?? hit.id
}

function TargetEditor({
  testCase,
  onChanged,
}: {
  testCase: TestCaseOut
  onChanged: () => void
}) {
  const [targets, setTargets] = useState(testCase.targets)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [newRelevance, setNewRelevance] = useState(1)
  const [comboboxKey, setComboboxKey] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      contentSearch(testCase.language, trimmed)
        .then((results) => setHits(results))
        .catch(() => setHits([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, testCase.language])

  async function handlePick(hit: SearchHit | null) {
    if (!hit) return
    // Force a full remount so the combobox's own selected-label sync (single
    // selection mode always mirrors the input to the picked item's label)
    // doesn't fight this reset — see the Base UI async-combobox pattern.
    setQuery('')
    setHits([])
    setComboboxKey((key) => key + 1)
    setError(null)
    try {
      const created = await addTestCaseTarget(testCase.id, hit.id, newRelevance)
      setTargets((current) => [...current, created])
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add target')
    }
  }

  async function handleDelete(targetId: number) {
    await deleteTestCaseTarget(testCase.id, targetId)
    setTargets(targets.filter((t) => t.id !== targetId))
    onChanged()
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Targets for “{testCase.content}”</DialogTitle>
      </DialogHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Content id</TableHead>
            <TableHead>Relevance</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {targets.map((target) => (
            <TableRow key={target.id}>
              <TableCell>{target.target}</TableCell>
              <TableCell>{relevanceLabel(target.relevance)}</TableCell>
              <TableCell>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(target.id)}>
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Label htmlFor="target-search" className="flex-1">
            Find content to target
          </Label>
          <Label htmlFor="new-relevance" className="w-44 shrink-0">
            Relevance
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Combobox
              key={comboboxKey}
              items={hits}
              filter={null}
              inputValue={query}
              onInputValueChange={setQuery}
              onValueChange={handlePick}
              itemToStringValue={(hit: SearchHit) => hit.id}
              itemToStringLabel={(hit: SearchHit) => describeHit(hit)}
            >
              <ComboboxInput
                id="target-search"
                placeholder="Search by text or content id…"
                showTrigger={false}
                className="h-8 w-full"
              />
              {query.trim() && (
                <ComboboxContent>
                  <ComboboxEmpty>{searching ? 'Searching…' : 'No matches'}</ComboboxEmpty>
                  <ComboboxList>
                    {(hit: SearchHit) => (
                      <ComboboxItem key={hit.id} value={hit}>
                        <div className="flex min-w-0 flex-col py-0.5">
                          <span className="truncate text-sm font-medium">
                            {describeHit(hit)}{' '}
                            <span className="text-muted-foreground">({hit.id})</span>
                          </span>
                          {hit.content && (
                            <span className="truncate text-xs text-muted-foreground">
                              {hit.content}
                            </span>
                          )}
                        </div>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              )}
            </Combobox>
          </div>
          <Select
            value={String(newRelevance)}
            onValueChange={(value) => setNewRelevance(Number(value))}
          >
            <SelectTrigger id="new-relevance" className="h-8 w-44 shrink-0">
              <SelectValue>{relevanceLabel(newRelevance)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RELEVANCE_LEVELS.map(({ value, label }) => (
                <SelectItem key={value} value={String(value)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
