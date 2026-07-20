import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ApiError,
  getComparison,
  getTestCollection,
  type ComparisonOut,
  type RunComparisonOut,
  type TestCollectionOut,
} from './api'
import { RELEVANCE_LEVELS, relevanceLabel } from './relevance'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
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
import { type Bar, BarsSvg } from '@/components/svg-charts'

type PerCaseMetric = 'recall_at_k' | 'precision_at_k' | 'reciprocal_rank' | 'ndcg_at_k'

const PER_CASE_METRICS: { key: PerCaseMetric; label: string }[] = [
  { key: 'recall_at_k', label: 'Recall@k' },
  { key: 'precision_at_k', label: 'Precision@k' },
  { key: 'reciprocal_rank', label: 'Reciprocal rank' },
  { key: 'ndcg_at_k', label: 'nDCG@k' },
]

function formatMetric(value: number): string {
  return value.toFixed(3)
}

function formatDelta(value: number): string {
  const formatted = Math.abs(value).toFixed(3)
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

function formatPValue(value: number | null): string {
  if (value === null) return 'n/a'
  return value < 0.001 ? '<0.001' : value.toFixed(3)
}

function deltaClassName(value: number): string {
  if (value > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (value < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function parseRunIds(searchParams: URLSearchParams): { baseline: number | null; runIds: number[] } {
  const baselineParam = searchParams.get('baseline')
  const candidatesParam = searchParams.get('candidates') ?? ''
  const baseline = baselineParam ? Number(baselineParam) : null
  const candidateIds = candidatesParam
    .split(',')
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
  const runIds = baseline ? [baseline, ...candidateIds] : candidateIds
  return { baseline, runIds: [...new Set(runIds)] }
}

function CandidateComparisonCard({
  comparison,
  distributionMetric,
}: {
  comparison: RunComparisonOut
  distributionMetric: PerCaseMetric
}) {
  const chartRef = useRef<SVGSVGElement>(null)
  const deltaBars: Bar[] = PER_CASE_METRICS.map((m) => ({
    value: comparison[m.key].delta,
    label: m.label.replace('@k', ''),
    tooltip: `${m.label}: ${formatDelta(comparison[m.key].delta)} (p=${formatPValue(comparison[m.key].wilcoxon_p_value)})`,
  }))

  const sortedCases = useMemo(
    () =>
      [...comparison.cases].sort(
        (a, b) =>
          Math.abs(b.candidate[distributionMetric] - b.baseline[distributionMetric]) -
          Math.abs(a.candidate[distributionMetric] - a.baseline[distributionMetric]),
      ),
    [comparison.cases, distributionMetric],
  )

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div>
        <h2 className="font-heading text-lg font-medium">
          Run #{comparison.candidate_id} — {comparison.candidate_configuration_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {comparison.overlap_case_count} case{comparison.overlap_case_count === 1 ? '' : 's'}{' '}
          shared with the baseline
        </p>
      </div>

      {comparison.overlap_case_count === 0 ? (
        <p className="text-sm text-muted-foreground">
          No test cases in common with the baseline run — nothing to compare.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <dl className="grid grid-cols-2 gap-3 rounded-md bg-background/60 py-3 text-center">
              {PER_CASE_METRICS.map((m) => (
                <div key={m.key}>
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                    {m.label}
                  </dt>
                  <dd
                    className={`font-medium tabular-nums ${deltaClassName(comparison[m.key].delta)}`}
                  >
                    {formatDelta(comparison[m.key].delta)}
                  </dd>
                  <dd className="text-[10px] text-muted-foreground">
                    p={formatPValue(comparison[m.key].wilcoxon_p_value)}
                  </dd>
                </div>
              ))}
            </dl>
            <BarsSvg
              bars={deltaBars}
              showLabels
              ariaLabel={`Bar chart of metric deltas (candidate minus baseline) for run #${comparison.candidate_id}`}
              width={280}
              height={160}
              svgRef={chartRef}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Found-in-top-k (McNemar's exact test): {comparison.found_at_k.n_candidate_only} case
            {comparison.found_at_k.n_candidate_only === 1 ? '' : 's'} newly found,{' '}
            {comparison.found_at_k.n_baseline_only} case
            {comparison.found_at_k.n_baseline_only === 1 ? '' : 's'} newly missed (p=
            {formatPValue(comparison.found_at_k.p_value)})
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test case</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Δ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCases.map((c) => (
                <TableRow key={c.test_case_id}>
                  <TableCell>{c.content}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatMetric(c.baseline[distributionMetric])}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMetric(c.candidate[distributionMetric])}
                  </TableCell>
                  <TableCell
                    className={`tabular-nums ${deltaClassName(c.candidate[distributionMetric] - c.baseline[distributionMetric])}`}
                  >
                    {formatDelta(c.candidate[distributionMetric] - c.baseline[distributionMetric])}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}

export function EvalCompareResultsPage() {
  const { id } = useParams()
  const collectionId = Number(id)
  const [searchParams, setSearchParams] = useSearchParams()

  const { baseline: initialBaseline, runIds } = parseRunIds(searchParams)
  const [baselineId, setBaselineId] = useState<number | null>(initialBaseline ?? runIds[0] ?? null)
  const [k, setK] = useState(10)
  const [tau, setTau] = useState(1)
  const [distributionMetric, setDistributionMetric] = useState<PerCaseMetric>('ndcg_at_k')
  const [collection, setCollection] = useState<TestCollectionOut | null>(null)
  const [comparison, setComparison] = useState<ComparisonOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const candidateIds = runIds.filter((runId) => runId !== baselineId)

  useEffect(() => {
    getTestCollection(collectionId)
      .then(setCollection)
      .catch(() => setCollection(null))
  }, [collectionId])

  useEffect(() => {
    if (baselineId === null || candidateIds.length === 0) return
    getComparison(baselineId, candidateIds, { k, tau })
      .then(setComparison)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load comparison'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineId, k, tau, runIds.join(',')])

  function handleBaselineChange(value: string | null) {
    if (!value) return
    const newBaseline = Number(value)
    setBaselineId(newBaseline)
    setSearchParams({
      baseline: String(newBaseline),
      candidates: runIds.filter((runId) => runId !== newBaseline).join(','),
    })
  }

  if (runIds.length < 2) {
    return <p className="text-sm text-destructive">Select at least two runs to compare.</p>
  }

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/eval/collections">Test collections</Link>} />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={<Link to={`/eval/collections/${collectionId}/results`}>
                {collection?.name ?? `Collection #${collectionId}`}
              </Link>}
            />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Compare</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="font-heading text-xl leading-snug font-medium">Compare runs</h1>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 rounded-md border border-border p-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="baseline-select">Baseline</Label>
          <Select value={String(baselineId ?? '')} onValueChange={handleBaselineChange}>
            <SelectTrigger id="baseline-select" className="w-full">
              <SelectValue>Run #{baselineId}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {runIds.map((runId) => (
                <SelectItem key={runId} value={String(runId)}>
                  Run #{runId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="compare-k">K: {k}</Label>
          <Slider
            id="compare-k"
            min={1}
            max={50}
            step={1}
            value={[k]}
            onValueChange={(value) => setK(Array.isArray(value) ? value[0] : value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="compare-tau">τ (relevance threshold)</Label>
          <Select value={String(tau)} onValueChange={(value) => value && setTau(Number(value))}>
            <SelectTrigger id="compare-tau" className="w-full">
              <SelectValue>{relevanceLabel(tau)}</SelectValue>
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

      <div className="flex flex-wrap gap-1">
        <span className="self-center pr-2 text-xs text-muted-foreground">Per-case metric:</span>
        {PER_CASE_METRICS.map((m) => (
          <Button
            key={m.key}
            size="sm"
            variant={distributionMetric === m.key ? 'default' : 'outline'}
            onClick={() => setDistributionMetric(m.key)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {comparison && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Baseline: Run #{comparison.baseline_id} — {comparison.baseline_configuration_name}
          </p>
          {comparison.comparisons.map((c) => (
            <CandidateComparisonCard
              key={c.candidate_id}
              comparison={c}
              distributionMetric={distributionMetric}
            />
          ))}
        </div>
      )}
    </div>
  )
}
