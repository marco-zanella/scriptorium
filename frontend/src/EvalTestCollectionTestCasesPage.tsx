import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  addMemberTestCase,
  getTestCollection,
  listLanguages,
  listMemberTestCases,
  listTestCases,
  removeMemberTestCase,
  type LanguageOut,
  type TestCaseOut,
  type TestCollectionOut,
} from './api'
import { relevanceLabel } from './relevance'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type MembershipFilter = 'all' | 'member' | 'non-member'

const MEMBERSHIP_LABELS: Record<MembershipFilter, string> = {
  all: 'All',
  member: 'In collection',
  'non-member': 'Not in collection',
}

export function EvalTestCollectionTestCasesPage() {
  const { id } = useParams()
  const collectionId = Number(id)

  const [collection, setCollection] = useState<TestCollectionOut | null>(null)
  const [cases, setCases] = useState<TestCaseOut[]>([])
  const [languages, setLanguages] = useState<LanguageOut[]>([])
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [membershipFilter, setMembershipFilter] = useState<MembershipFilter>('all')
  const tagsAnchor = useComboboxAnchor()

  const [viewingTargets, setViewingTargets] = useState<TestCaseOut | null>(null)

  async function load() {
    try {
      const [col, allCases, languageList, members] = await Promise.all([
        getTestCollection(collectionId),
        listTestCases(),
        listLanguages(),
        listMemberTestCases(collectionId),
      ])
      setCollection(col)
      setCases(allCases)
      setLanguages(languageList)
      setMemberIds(new Set(members.map((c) => c.id)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load test cases')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId])

  const allTags = useMemo(() => Array.from(new Set(cases.flatMap((c) => c.tags))).sort(), [cases])
  const allSources = useMemo(
    () => Array.from(new Set(cases.flatMap((c) => (c.source ? [c.source] : [])))).sort(),
    [cases],
  )

  const filteredCases = useMemo(() => {
    const query = search.trim().toLowerCase()
    return cases.filter((c) => {
      if (query && !c.content.toLowerCase().includes(query)) return false
      if (languageFilter && c.language !== languageFilter) return false
      if (sourceFilter && c.source !== sourceFilter) return false
      if (selectedTags.size > 0 && !c.tags.some((tag) => selectedTags.has(tag))) return false
      const isMember = memberIds.has(c.id)
      if (membershipFilter === 'member' && !isMember) return false
      if (membershipFilter === 'non-member' && isMember) return false
      return true
    })
  }, [cases, search, languageFilter, sourceFilter, selectedTags, membershipFilter, memberIds])

  const allFilteredAreMembers =
    filteredCases.length > 0 && filteredCases.every((c) => memberIds.has(c.id))
  const someFilteredAreMembers = filteredCases.some((c) => memberIds.has(c.id))

  async function handleToggleMember(testCase: TestCaseOut) {
    setError(null)
    const isMember = memberIds.has(testCase.id)
    try {
      if (isMember) {
        await removeMemberTestCase(collectionId, testCase.id)
      } else {
        await addMemberTestCase(collectionId, testCase.id)
      }
      setMemberIds((current) => {
        const next = new Set(current)
        if (isMember) next.delete(testCase.id)
        else next.add(testCase.id)
        return next
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update membership')
    }
  }

  async function handleToggleAllFiltered() {
    setError(null)
    try {
      if (allFilteredAreMembers) {
        await Promise.all(filteredCases.map((c) => removeMemberTestCase(collectionId, c.id)))
      } else {
        await Promise.all(
          filteredCases
            .filter((c) => !memberIds.has(c.id))
            .map((c) => addMemberTestCase(collectionId, c.id)),
        )
      }
      const members = await listMemberTestCases(collectionId)
      setMemberIds(new Set(members.map((c) => c.id)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update membership')
    }
  }

  if (!collection) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/eval/collections">Test collections</Link>} />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{collection.name}</BreadcrumbPage>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Test cases</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="font-heading text-xl leading-snug font-medium">{collection.name}</h1>
        <p className="text-sm text-muted-foreground">
          {memberIds.size} of {cases.length} test cases in this collection
        </p>
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
        {allSources.length > 0 && (
          <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value ?? '')}>
            <SelectTrigger aria-label="Filter by source" className="w-48">
              <SelectValue placeholder="All sources">{sourceFilter || undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All sources</SelectItem>
              {allSources.map((source) => (
                <SelectItem key={source} value={source}>
                  {source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
                      <ComboboxChip key={tag} removeLabel={`Remove ${tag}`}>
                        {tag}
                      </ComboboxChip>
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
        <Select
          value={membershipFilter}
          onValueChange={(value) => setMembershipFilter((value ?? 'all') as MembershipFilter)}
        >
          <SelectTrigger aria-label="Filter by membership" className="w-48">
            <SelectValue>{MEMBERSHIP_LABELS[membershipFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="member">In collection</SelectItem>
            <SelectItem value="non-member">Not in collection</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allFilteredAreMembers}
                indeterminate={someFilteredAreMembers && !allFilteredAreMembers}
                onCheckedChange={handleToggleAllFiltered}
                aria-label="Toggle membership for all filtered test cases"
              />
            </TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Language</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Targets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredCases.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No test cases match the current filters.
              </TableCell>
            </TableRow>
          )}
          {filteredCases.map((testCase) => (
            <TableRow key={testCase.id}>
              <TableCell>
                <Checkbox
                  checked={memberIds.has(testCase.id)}
                  onCheckedChange={() => handleToggleMember(testCase)}
                  aria-label={`Toggle membership for ${testCase.content}`}
                />
              </TableCell>
              <TableCell>{testCase.content}</TableCell>
              <TableCell>
                {languages.find((lang) => lang.iso_code === testCase.language)?.display_name ??
                  testCase.language}
              </TableCell>
              <TableCell>{testCase.source ?? '—'}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {testCase.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => setViewingTargets(testCase)}>
                  {testCase.targets.length} Targets
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={viewingTargets !== null}
        onOpenChange={(open) => !open && setViewingTargets(null)}
      >
        <DialogContent className="sm:max-w-lg">
          {viewingTargets && (
            <>
              <DialogHeader>
                <DialogTitle>Targets for “{viewingTargets.content}”</DialogTitle>
              </DialogHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content id</TableHead>
                    <TableHead>Relevance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewingTargets.targets.map((target) => (
                    <TableRow key={target.id}>
                      <TableCell>{target.target}</TableCell>
                      <TableCell>{relevanceLabel(target.relevance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
