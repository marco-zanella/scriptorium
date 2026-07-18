import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  createTestCollection,
  deleteTestCollection,
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Configuration</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {collections.map((collection) => {
            const config = configs.find((c) => c.id === collection.search_configuration_id)
            return (
              <TableRow key={collection.id}>
                <TableCell>
                  <Link
                    to={`/eval/collections/${collection.id}`}
                    className="font-medium hover:underline"
                  >
                    {collection.name}
                  </Link>
                </TableCell>
                <TableCell>{config?.name ?? collection.search_configuration_id}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
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
            )
          })}
        </TableBody>
      </Table>
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
  const [books, setBooks] = useState((initial?.books ?? []).join(', '))
  const [sources, setSources] = useState((initial?.sources ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit({
        name,
        description: description || null,
        search_configuration_id: Number(searchConfigurationId),
        books: books
          .split(',')
          .map((book) => book.trim())
          .filter(Boolean),
        sources: sources
          .split(',')
          .map((source) => source.trim())
          .filter(Boolean),
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
      <div className="space-y-2">
        <Label htmlFor="collection-books">Books (comma-separated, optional)</Label>
        <Input id="collection-books" value={books} onChange={(e) => setBooks(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="collection-sources">Sources (comma-separated, optional)</Label>
        <Input
          id="collection-sources"
          value={sources}
          onChange={(e) => setSources(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={!searchConfigurationId}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}
