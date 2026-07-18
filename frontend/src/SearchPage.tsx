import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Fragment, useEffect, useState } from 'react'
import {
  ApiError,
  getFacets,
  listLanguages,
  listSearchConfigurations,
  search,
  type Combiner,
  type CombinationTechnique,
  type CombinerTechnique,
  type LanguageOut,
  type ScoreStats,
  type SearchConfigurationOut,
  type SearchFacets,
  type SearchHit,
} from './api'
import { FacetFilterGroup } from './FacetFilterGroup'
import { ScoreDistributionPanel } from './ScoreDistributionPanel'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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

function configKey(config: SearchConfigurationOut): string {
  return config.is_preset ? `preset:${config.name}` : `saved:${config.id}`
}

export function SearchPage() {
  const [languages, setLanguages] = useState<LanguageOut[]>([])
  const [language, setLanguage] = useState('')
  const [query, setQuery] = useState('')

  const [configurations, setConfigurations] = useState<SearchConfigurationOut[]>([])
  const [configId, setConfigId] = useState('')
  const [weights, setWeights] = useState<Record<string, number>>(EMPTY_WEIGHTS)
  const [variantWeights, setVariantWeights] = useState<Record<string, number>>(EMPTY_WEIGHTS)
  const [bucketWeights, setBucketWeights] = useState<Record<string, number>>(DEFAULT_BUCKET_WEIGHTS)
  const [combiner, setCombiner] = useState<Combiner>(DEFAULT_COMBINER)
  const [showConfiguration, setShowConfiguration] = useState(false)

  const [selectedBooks, setSelectedBooks] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [facets, setFacets] = useState<SearchFacets | null>(null)
  const [scoreStats, setScoreStats] = useState<ScoreStats | null>(null)
  const [count, setCount] = useState(0)
  const [tookMs, setTookMs] = useState(0)
  const [showScoreDistribution, setShowScoreDistribution] = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listLanguages().then((langs) => {
      setLanguages(langs)
      setLanguage((current) => current || langs[0]?.iso_code || '')
    })
    listSearchConfigurations().then((configs) => {
      setConfigurations(configs)
      const preferred =
        configs.find((c) => c.is_preset && c.name === 'hybrid') ?? configs[0]
      if (preferred) {
        setConfigId(configKey(preferred))
        setWeights(preferred.weights.weights)
        setVariantWeights(preferred.weights.variant_weights)
        setBucketWeights(preferred.weights.bucket_weights ?? DEFAULT_BUCKET_WEIGHTS)
        setCombiner(preferred.weights.combiner ?? DEFAULT_COMBINER)
      }
    })
  }, [])

  useEffect(() => {
    if (!language) return
    setSelectedBooks([])
    setSelectedSources([])
    // Facet options load independent of any query, so a scope (e.g. "Rahlfs
    // Genesis") can be picked before the user has typed anything to search for.
    getFacets(language).then(setFacets)
  }, [language])

  function refreshBrowseFacets(books: string[], sources: string[]) {
    if (!language) return
    void getFacets(language, { books, sources }).then(setFacets)
  }

  function selectConfiguration(key: string) {
    setConfigId(key)
    const found = configurations.find((c) => configKey(c) === key)
    if (found) {
      setWeights(found.weights.weights)
      setVariantWeights(found.weights.variant_weights)
      setBucketWeights(found.weights.bucket_weights ?? DEFAULT_BUCKET_WEIGHTS)
      setCombiner(found.weights.combiner ?? DEFAULT_COMBINER)
    }
  }

  async function runSearch(
    overrides: { page?: number; books?: string[]; sources?: string[]; includeScoreStats?: boolean } = {},
  ) {
    if (!query.trim() || !language) return
    setLoading(true)
    setError(null)
    const targetPage = overrides.page ?? 1
    try {
      const response = await search(language, query, {
        weights,
        variant_weights: variantWeights,
        bucket_weights: bucketWeights,
        combiner,
        books: (overrides.books ?? selectedBooks).length ? overrides.books ?? selectedBooks : undefined,
        sources: (overrides.sources ?? selectedSources).length
          ? overrides.sources ?? selectedSources
          : undefined,
        page: targetPage,
        page_size: pageSize,
        include_score_stats: overrides.includeScoreStats ?? showScoreDistribution,
      })
      setResults(response.results)
      setFacets(response.facets)
      setScoreStats(response.score_stats)
      setCount(response.count)
      setTookMs(response.took_ms)
      setPage(targetPage)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed')
      setResults(null)
      setFacets(null)
      setScoreStats(null)
    } finally {
      setLoading(false)
    }
  }

  function toggleBook(key: string) {
    const next = selectedBooks.includes(key)
      ? selectedBooks.filter((v) => v !== key)
      : [...selectedBooks, key]
    setSelectedBooks(next)
    if (results) {
      void runSearch({ books: next })
    } else {
      refreshBrowseFacets(next, selectedSources)
    }
  }

  function toggleSource(key: string) {
    const next = selectedSources.includes(key)
      ? selectedSources.filter((v) => v !== key)
      : [...selectedSources, key]
    setSelectedSources(next)
    if (results) {
      void runSearch({ sources: next })
    } else {
      refreshBrowseFacets(selectedBooks, next)
    }
  }

  function handleScoreDistributionOpenChange(open: boolean) {
    setShowScoreDistribution(open)
    if (open && results && !scoreStats) {
      void runSearch({ includeScoreStats: true })
    }
  }

  const selectedLanguage = languages.find((lang) => lang.iso_code === language)
  const selectedConfiguration = configurations.find((c) => configKey(c) === configId)
  const totalPages = Math.max(1, Math.ceil(count / pageSize))

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl leading-snug font-medium">Search</h1>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <Select value={language} onValueChange={(value) => setLanguage(value ?? '')}>
          <SelectTrigger aria-label="Language" className="w-40">
            <SelectValue>{selectedLanguage?.display_name ?? 'Select language'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {languages.map((lang) => (
              <SelectItem key={lang.iso_code} value={lang.iso_code}>
                {lang.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          placeholder="Enter your query..."
          aria-label="Search query"
          className="min-w-64 flex-1"
        />
        <Button onClick={() => runSearch()} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
        <Button variant="outline" onClick={() => setShowConfiguration((v) => !v)}>
          Configuration
        </Button>
      </div>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          showConfiguration ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 space-y-4 border-b border-border pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="config-picker">Configuration</Label>
              <Select value={configId} onValueChange={(value) => value && selectConfiguration(value)}>
                <SelectTrigger id="config-picker" aria-label="Search configuration" className="w-48">
                  <SelectValue>
                    {selectedConfiguration
                      ? `${selectedConfiguration.name}${selectedConfiguration.is_preset ? '' : ' (saved)'}`
                      : 'Select configuration'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {configurations.map((config) => (
                    <SelectItem key={configKey(config)} value={configKey(config)}>
                      {config.name}
                      {config.is_preset ? '' : ' (saved)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Link to="/search/configurations" className="text-sm text-muted-foreground hover:text-foreground">
              Manage configurations
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
            {CATEGORY_FIELDS.map(({ category, fields }) => (
              <div key={category} className="space-y-2">
                <p className="font-medium text-foreground">{category}</p>
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span />
                  <span>Main</span>
                  <span>Variant</span>
                  {fields.map((field) => (
                    <Fragment key={field}>
                      <Label htmlFor={`w-${field}`} className="text-sm capitalize">
                        {field}
                      </Label>
                      <Input
                        id={`w-${field}`}
                        type="number"
                        step={0.01}
                        min={0}
                        value={weights[field] ?? 0}
                        onChange={(e) =>
                          setWeights({ ...weights, [field]: Number(e.target.value) })
                        }
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
                <p className="font-medium text-foreground">Search emphasis</p>
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
                <p className="font-medium text-foreground">Combiner</p>
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
                    <Label htmlFor="rank-constant" className="text-sm text-muted-foreground">
                      Rank constant
                    </Label>
                    <Input
                      id="rank-constant"
                      type="number"
                      min={1}
                      className="w-24"
                      value={combiner.rank_constant ?? 60}
                      onChange={(e) =>
                        setCombiner({ ...combiner, rank_constant: Number(e.target.value) })
                      }
                    />
                  </div>
                )}

                {/* z_score only combines via arithmetic_mean — no choice to make, so no picker */}
                {combiner.technique !== 'rrf' && combiner.technique !== 'z_score' && (
                  <Select
                    value={combiner.combination ?? 'arithmetic_mean'}
                    onValueChange={(value) =>
                      value &&
                      setCombiner({ ...combiner, combination: value as CombinationTechnique })
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

          <div className="flex items-center gap-2">
            <Label htmlFor="page-size">Results per page</Label>
            <Input
              id="page-size"
              type="number"
              min={1}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-24"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {language && (
        <div className="flex items-start gap-0">
          <div
            className={`shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-in-out ${
              showFilters ? 'w-72 opacity-100' : 'w-0 opacity-0'
            }`}
          >
            <aside className="w-72 space-y-4 border-r border-border pr-6">
              <p className="font-heading font-medium text-foreground">Filters</p>
              {facets && (
                <>
                  <FacetFilterGroup
                    title="Book"
                    buckets={facets.book}
                    selected={selectedBooks}
                    onToggle={toggleBook}
                  />
                  <FacetFilterGroup
                    title="Source"
                    buckets={facets.source}
                    selected={selectedSources}
                    onToggle={toggleSource}
                  />
                </>
              )}

              <Collapsible
                open={showScoreDistribution}
                onOpenChange={handleScoreDistributionOpenChange}
                className="border-t border-border pt-3"
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between text-left font-medium text-foreground">
                  Score distribution
                  <ChevronDown
                    className={`size-4 transition-transform ${showScoreDistribution ? '' : '-rotate-90'}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  {scoreStats && (
                    <ScoreDistributionPanel stats={scoreStats} results={results ?? []} />
                  )}
                </CollapsibleContent>
              </Collapsible>
            </aside>
          </div>

          <div className="min-w-0 flex-1 space-y-4 pl-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowFilters((v) => !v)}
                      aria-label={showFilters ? 'Hide filters' : 'Show filters'}
                    >
                      {showFilters ? (
                        <PanelLeftClose className="size-4" />
                      ) : (
                        <PanelLeftOpen className="size-4" />
                      )}
                    </Button>
                  }
                />
                <TooltipContent>{showFilters ? 'Hide filters' : 'Show filters'}</TooltipContent>
              </Tooltip>
              {results && (
                <span>
                  {count} results in {tookMs}ms
                </span>
              )}
            </div>

            {!results && (
              <p className="text-sm text-muted-foreground">
                Enter a query to search{selectedBooks.length || selectedSources.length ? ' within the selected filters' : ''}.
              </p>
            )}

            {results?.length === 0 && <p className="text-sm text-muted-foreground">No results.</p>}

            {results && (
              <div className="space-y-3" dir={selectedLanguage?.directionality}>
                {results.map((hit) => (
                  <div key={hit.id} className="border-b border-border pb-3">
                    <p className="text-sm font-medium">
                      {hit.book} {hit.chapter}:{hit.verse}{' '}
                      <span className="font-normal text-muted-foreground">[{hit.source}]</span>
                    </p>
                    <p className="mt-1">{hit.content}</p>
                    {hit.variant.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {hit.variant.map((v, j) => (
                          <li key={j}>
                            <span className="font-medium">{v.source}:</span> {v.content}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {results && results.length > 0 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => runSearch({ page: page - 1 })}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => runSearch({ page: page + 1 })}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
