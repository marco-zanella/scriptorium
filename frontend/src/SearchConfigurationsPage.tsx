import { type ChangeEvent, Fragment, type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  createSearchConfiguration,
  deleteSearchConfiguration,
  listSearchConfigurations,
  updateSearchConfiguration,
  type SearchConfigurationOut,
  type SearchConfigurationWeights,
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const CATEGORY_FIELDS = [
  { category: 'Language Agnostic', fields: ['text', 'shingle', 'trigram'] },
  { category: 'Language Aware', fields: ['language'] },
  { category: 'Semantics', fields: ['semantic'] },
] as const

const EMPTY_WEIGHTS = { text: 0, shingle: 0, trigram: 0, language: 0, semantic: 0 }

export function SearchConfigurationsPage() {
  const [configurations, setConfigurations] = useState<SearchConfigurationOut[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<SearchConfigurationOut | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      setConfigurations(await listSearchConfigurations())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load configurations')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(config: SearchConfigurationOut) {
    if (config.id === null) return
    await deleteSearchConfiguration(config.id)
    await load()
  }

  function handleExport(config: SearchConfigurationOut) {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${config.name}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    try {
      const parsed = JSON.parse(await file.text())
      await createSearchConfiguration(parsed.name, parsed.weights)
      await load()
    } catch {
      setError('Failed to import configuration — check the file is a valid exported configuration')
    }
  }

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/search">Search</Link>} />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Configurations</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl leading-snug font-medium">Search configurations</h1>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
          />
          <Button variant="outline" onClick={() => importInputRef.current?.click()}>
            Import
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button>New configuration</Button>} />
            <DialogContent className="sm:max-w-3xl">
              <ConfigurationForm
                onSubmit={async (name, weights) => {
                  await createSearchConfiguration(name, weights)
                  setCreateOpen(false)
                  await load()
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configurations.map((config) => (
            <TableRow key={config.is_preset ? `preset:${config.name}` : `saved:${config.id}`}>
              <TableCell>{config.name}</TableCell>
              <TableCell>{config.is_preset ? 'Built-in preset' : 'Saved'}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExport(config)}>
                    Export
                  </Button>
                  {!config.is_preset && (
                    <>
                      <Dialog
                        open={editing?.id === config.id}
                        onOpenChange={(open) => setEditing(open ? config : null)}
                      >
                        <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
                        <DialogContent className="sm:max-w-3xl">
                          <ConfigurationForm
                            initial={config}
                            onSubmit={async (name, weights) => {
                              if (config.id === null) return
                              await updateSearchConfiguration(config.id, name, weights)
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
                            <AlertDialogTitle>Delete {config.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes the saved configuration. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                            <AlertDialogAction variant="destructive" onClick={() => handleDelete(config)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ConfigurationForm({
  initial,
  onSubmit,
}: {
  initial?: SearchConfigurationOut
  onSubmit: (name: string, weights: SearchConfigurationWeights) => Promise<void>
}) {
  const isEdit = initial !== undefined
  const [name, setName] = useState(initial?.name ?? '')
  const [weights, setWeights] = useState<Record<string, number>>(initial?.weights.weights ?? EMPTY_WEIGHTS)
  const [variantWeights, setVariantWeights] = useState<Record<string, number>>(
    initial?.weights.variant_weights ?? EMPTY_WEIGHTS,
  )
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit(name, { weights, variant_weights: variantWeights })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit configuration' : 'New configuration'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="config-name">Name</Label>
        <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {CATEGORY_FIELDS.map(({ category, fields }) => (
          <div key={category} className="space-y-2">
            <p className="text-sm font-medium text-foreground">{category}</p>
            <div className="grid grid-cols-3 items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span />
              <span>Main</span>
              <span>Variant</span>
              {fields.map((field) => (
                <Fragment key={field}>
                  <Label htmlFor={`form-w-${field}`} className="text-sm capitalize">
                    {field}
                  </Label>
                  <Input
                    id={`form-w-${field}`}
                    type="number"
                    step={0.01}
                    min={0}
                    value={weights[field] ?? 0}
                    onChange={(e) => setWeights({ ...weights, [field]: Number(e.target.value) })}
                  />
                  <Input
                    type="number"
                    step={0.01}
                    min={0}
                    value={variantWeights[field] ?? 0}
                    onChange={(e) =>
                      setVariantWeights({ ...variantWeights, [field]: Number(e.target.value) })
                    }
                    aria-label={`${field} variant weight`}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit">{isEdit ? 'Save' : 'Create'}</Button>
      </DialogFooter>
    </form>
  )
}
