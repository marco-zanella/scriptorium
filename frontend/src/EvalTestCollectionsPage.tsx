import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  addMemberTestCase,
  createTestCollection,
  deleteTestCollection,
  getCollectionContentFacets,
  listMemberTestCases,
  listSearchConfigurations,
  listTestCollections,
  updateTestCollection,
  type SearchConfigurationOut,
  type TestCollectionInput,
  type TestCollectionOut,
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
import { Button } from '@/components/ui/button'
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

export function EvalTestCollectionsPage() {
  const [collections, setCollections] = useState<TestCollectionOut[]>([])
  const [configs, setConfigs] = useState<SearchConfigurationOut[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TestCollectionOut | null>(null)
  const [search, setSearch] = useState('')

  const filteredCollections = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return collections
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.description ?? '').toLowerCase().includes(query),
    )
  }, [collections, search])

  async function load() {
    try {
      const [cols, cfgs] = await Promise.all([listTestCollections(), listSearchConfigurations()])
      setCollections(cols)
      setConfigs(cfgs)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load test collections')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(collection: TestCollectionOut) {
    await deleteTestCollection(collection.id)
    await load()
  }

  async function handleConfigChange(collection: TestCollectionOut, searchConfigurationId: number) {
    await updateTestCollection(collection.id, {
      name: collection.name,
      description: collection.description,
      search_configuration_id: searchConfigurationId,
      books: collection.books,
      sources: collection.sources,
    })
    await load()
  }

  async function handleDuplicate(collection: TestCollectionOut) {
    const members = await listMemberTestCases(collection.id)
    const copy = await createTestCollection({
      name: `Copy of ${collection.name}`,
      description: collection.description,
      search_configuration_id: collection.search_configuration_id,
      books: collection.books,
      sources: collection.sources,
    })
    await Promise.all(members.map((member) => addMemberTestCase(copy.id, member.id)))
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl leading-snug font-medium">Test collections</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button>New collection</Button>} />
          <DialogContent className="sm:max-w-lg">
            <TestCollectionForm
              configs={configs}
              onSubmit={async (body) => {
                await createTestCollection(body)
                setCreateOpen(false)
                await load()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Input
        placeholder="Search by name or description"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="w-80"
        aria-label="Search collections"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-full">Description</TableHead>
            <TableHead>Test Cases</TableHead>
            <TableHead>Configuration</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredCollections.map((collection) => (
            <TableRow key={collection.id}>
              <TableCell className="font-medium">{collection.name}</TableCell>
              <TableCell
                className="w-full max-w-0 truncate"
                title={collection.description ?? undefined}
              >
                {collection.description ?? '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link to={`/eval/collections/${collection.id}/test-cases`} />}
                >
                  {collection.test_case_count}
                </Button>
              </TableCell>
              <TableCell>
                <Select
                  value={String(collection.search_configuration_id)}
                  onValueChange={(value) => value && handleConfigChange(collection, Number(value))}
                >
                  <SelectTrigger
                    aria-label={`Configuration for ${collection.name}`}
                    className="min-w-48"
                  >
                    <SelectValue placeholder="Select a configuration">
                      {configs.find((c) => c.id === collection.search_configuration_id)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {configs.map((config) => (
                      <SelectItem key={config.id} value={String(config.id)}>
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link to={`/eval/collections/${collection.id}/results`} />}
                  >
                    Results
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDuplicate(collection)}>
                    Duplicate
                  </Button>
                  <Dialog
                    open={editing?.id === collection.id}
                    onOpenChange={(open) => setEditing(open ? collection : null)}
                  >
                    <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
                    <DialogContent className="sm:max-w-lg">
                      <TestCollectionForm
                        configs={configs}
                        initial={collection}
                        onSubmit={async (body) => {
                          await updateTestCollection(collection.id, body)
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
                        <AlertDialogTitle>Delete {collection.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the collection, its membership, and every
                          past run. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(collection)}
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

function AssistedChipsField({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string
  label: string
  options: string[]
  value: string[]
  onChange: (value: string[]) => void
}) {
  const anchor = useComboboxAnchor()

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Combobox multiple items={options} value={value} onValueChange={onChange}>
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(values: string[]) => (
              <>
                {values.map((item) => (
                  <ComboboxChip key={item} removeLabel={`Remove ${item}`}>
                    {item}
                  </ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={id}
                  placeholder={values.length ? '' : `Add a ${label.toLowerCase()}…`}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No matches.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

function TestCollectionForm({
  configs,
  initial,
  onSubmit,
}: {
  configs: SearchConfigurationOut[]
  initial?: TestCollectionOut
  onSubmit: (body: TestCollectionInput) => Promise<void>
}) {
  const isEdit = initial !== undefined
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [searchConfigurationId, setSearchConfigurationId] = useState(
    initial ? String(initial.search_configuration_id) : '',
  )
  const [books, setBooks] = useState<string[]>(initial?.books ?? [])
  const [sources, setSources] = useState<string[]>(initial?.sources ?? [])
  const [bookOptions, setBookOptions] = useState<string[]>([])
  const [sourceOptions, setSourceOptions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCollectionContentFacets()
      .then((facets) => {
        setBookOptions(facets.book)
        setSourceOptions(facets.source)
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit({
        name,
        description: description || null,
        search_configuration_id: Number(searchConfigurationId),
        books,
        sources,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit collection' : 'New collection'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="collection-name">Name</Label>
        <Input
          id="collection-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="collection-description">Description (optional)</Label>
        <Input
          id="collection-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Search configuration</p>
        <Select
          value={searchConfigurationId}
          onValueChange={(value) => value && setSearchConfigurationId(value)}
        >
          <SelectTrigger aria-label="Search configuration">
            <SelectValue placeholder="Select a configuration">
              {configs.find((c) => String(c.id) === searchConfigurationId)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {configs.map((config) => (
              <SelectItem key={config.id} value={String(config.id)}>
                {config.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <AssistedChipsField
        id="collection-books"
        label="Books"
        options={bookOptions}
        value={books}
        onChange={setBooks}
      />
      <AssistedChipsField
        id="collection-sources"
        label="Sources"
        options={sourceOptions}
        value={sources}
        onChange={setSources}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={!searchConfigurationId}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}
