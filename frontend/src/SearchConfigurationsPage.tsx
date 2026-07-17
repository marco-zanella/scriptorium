import { type ChangeEvent, Fragment, type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  createSearchConfiguration,
  deleteSearchConfiguration,
  listSearchConfigurations,
  updateSearchConfiguration,
  type Combiner,
  type CombinationTechnique,
  type CombinerTechnique,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const CATEGORY_FIELDS = [
  { category: 'Language Agnostic', fields: ['text', 'shingle', 'trigram'] },
  { category: 'Language Aware', fields: ['language'] },
  { category: 'Semantics', fields: ['semantic'] },
] as const

const EMPTY_WEIGHTS = { text: 0, shingle: 0, trigram: 0, language: 0, semantic: 0 }
const DEFAULT_BUCKET_WEIGHTS = { lexical: 0.5, semantic: 0.5 }
const DEFAULT_COMBINER: Combiner = { technique: 'z_score', combination: 'arithmetic_mean' }
const COMBINER_TECHNIQUES: { value: CombinerTechnique; label: string }[] = [
  { value: 'z_score', label: 'Z-Score normalization' },
  { value: 'min_max', label: 'Min-Max normalization' },
  { value: 'l2', label: 'L2 normalization' },
  { value: 'rrf', label: 'Reciprocal Rank Fusion' },
]
// arithmetic_mean is the only combination z_score's negative values can be
// combined via — geometric/harmonic mean can't handle them — so when z_score is
// selected, no combination picker is shown at all (see below), not just a
// filtered one.
const COMBINATION_TECHNIQUES: { value: CombinationTechnique; label: string }[] = [
  { value: 'arithmetic_mean', label: 'Arithmetic mean' },
  { value: 'geometric_mean', label: 'Geometric mean' },
  { value: 'harmonic_mean', label: 'Harmonic mean' },
]

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
            <DialogContent className="sm:max-w-5xl">
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
                        <DialogContent className="sm:max-w-5xl">
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
  const [bucketWeights, setBucketWeights] = useState<Record<string, number>>(
    initial?.weights.bucket_weights ?? DEFAULT_BUCKET_WEIGHTS,
  )
  const [combiner, setCombiner] = useState<Combiner>(initial?.weights.combiner ?? DEFAULT_COMBINER)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit(name, {
        weights,
        variant_weights: variantWeights,
        bucket_weights: bucketWeights,
        combiner,
      })
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

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
        {CATEGORY_FIELDS.map(({ category, fields }) => (
          <div key={category} className="space-y-2">
            <p className="text-sm font-medium text-foreground">{category}</p>
            <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
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

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Search emphasis</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Wording</span>
              <Slider
                aria-label="Search emphasis"
                min={0}
                max={1}
                step={0.01}
                value={[bucketWeights.semantic ?? 0.5]}
                onValueChange={(value) => {
                  const semantic = Array.isArray(value) ? value[0] : value
                  setBucketWeights({ lexical: 1 - semantic, semantic })
                }}
              />
              <span className="text-xs text-muted-foreground">Meaning</span>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {Math.round((1 - (bucketWeights.semantic ?? 0.5)) * 100)}% wording ·{' '}
              {Math.round((bucketWeights.semantic ?? 0.5) * 100)}% meaning
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Combiner</p>
            <div className="flex flex-wrap items-center gap-2">
            <Select
              value={combiner.technique}
              onValueChange={(value) => {
                if (!value) return
                const technique = value as CombinerTechnique
                setCombiner(
                  technique === 'z_score'
                    ? { technique, combination: 'arithmetic_mean' }
                    : { ...combiner, technique },
                )
              }}
            >
              <SelectTrigger aria-label="Combiner technique" className="w-56">
                <SelectValue>
                  {COMBINER_TECHNIQUES.find((t) => t.value === combiner.technique)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMBINER_TECHNIQUES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {combiner.technique === 'rrf' && (
              <div className="flex items-center gap-2">
                <Label htmlFor="form-rank-constant" className="text-sm text-muted-foreground">
                  Rank constant
                </Label>
                <Input
                  id="form-rank-constant"
                  type="number"
                  min={1}
                  className="w-24"
                  value={combiner.rank_constant ?? 60}
                  onChange={(e) => setCombiner({ ...combiner, rank_constant: Number(e.target.value) })}
                />
              </div>
            )}

            {/* z_score only combines via arithmetic_mean — no choice to make, so no picker */}
            {combiner.technique !== 'rrf' && combiner.technique !== 'z_score' && (
              <Select
                value={combiner.combination ?? 'arithmetic_mean'}
                onValueChange={(value) =>
                  value && setCombiner({ ...combiner, combination: value as CombinationTechnique })
                }
              >
                <SelectTrigger aria-label="Combination technique" className="w-48">
                  <SelectValue>
                    {
                      COMBINATION_TECHNIQUES.find(
                        (t) => t.value === (combiner.combination ?? 'arithmetic_mean'),
                      )?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COMBINATION_TECHNIQUES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit">{isEdit ? 'Save' : 'Create'}</Button>
      </DialogFooter>
    </form>
  )
}
