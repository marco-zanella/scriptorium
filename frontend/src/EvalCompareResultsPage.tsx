import { useEffect, useMemo, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
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

type PerCaseMetric = 'recall_at_k' | 'precision_at_k' | 'reciprocal_rank' | 'ndcg_at_k'

const METRIC_ROWS: { key: PerCaseMetric; label: string }[] = [
  { key: 'recall_at_k', label: 'Recall@k' },
  { key: 'precision_at_k', label: 'Precision@k' },
  { key: 'reciprocal_rank', label: 'Reciprocal rank (MRR)' },
  { key: 'ndcg_at_k', label: 'nDCG@k' },
]

const SIGNIFICANCE_THRESHOLD = 0.05

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

// Plain discrete Tailwind shades — not the `bg-x/10` opacity-mix (`color-mix()`)
// form used elsewhere, to rule out that mechanism as a variable: it's simpler,
// universally-supported CSS, and keeps the positive/negative treatments
// perfectly symmetric so any rendering gap between them is obvious immediately.
// Text shade is specifically -700, not -800: checked the generated
// oklch chroma for both (this app's own established floor, from the earlier
// chart-color fix, is ~0.10 chroma before a hue stops reading as color at
// all) — text-emerald-800 is oklch(43.2% 0.095 ...), *below* that floor,
// while text-emerald-700 is oklch(50.8% 0.118 ...), safely above it, and
// closely lightness-matched to text-red-700's oklch(50.5% 0.213 ...).
const POSITIVE_CHIP = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
const NEGATIVE_CHIP = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'

/** A filled, tinted pill rather than plain colored text — a subtle text-color
 * change on small tabular numbers is easy to miss at a glance (confirmed:
 * the initial plain-text version wasn't visible enough). */
function DeltaChip({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
        {formatDelta(value)}
      </span>
    )
  }
  const positive = value > 0
  const Icon = positive ? ArrowUpIcon : ArrowDownIcon
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${positive ? POSITIVE_CHIP : NEGATIVE_CHIP}`}
    >
      <Icon className="size-3" />
      {formatDelta(value)}
    </span>
  )
}

function PValueLabel({ value }: { value: number | null }) {
  const significant = value !== null && value < SIGNIFICANCE_THRESHOLD
  return (
    <span
      className={
        significant
          ? `rounded-md px-1.5 py-0.5 font-medium ${POSITIVE_CHIP}`
          : 'text-muted-foreground'
      }
    >
      p={formatPValue(value)}
    </span>
  )
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

function candidateLabel(comparison: RunComparisonOut): string {
  return `Run #${comparison.candidate_id} — ${comparison.candidate_configuration_name}`
}

/** rows = metrics (+ a found-in-top-k row), columns = baseline + one per candidate —
 * mirrors how experimentation dashboards (e.g. GrowthBook) lay out variation-vs-control
 * results, so every metric/candidate combination is scannable at a glance. */
function SummaryTable({ comparisons }: { comparisons: RunComparisonOut[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Baseline</TableHead>
            {comparisons.map((c) => (
              <TableHead key={c.candidate_id} className="text-right">
                {candidateLabel(c)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {METRIC_ROWS.map((metric) => (
            <TableRow key={metric.key}>
              <TableCell>{metric.label}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMetric(comparisons[0][metric.key].baseline)}
              </TableCell>
              {comparisons.map((c) => {
                const cell = c[metric.key]
                return (
                  <TableCell key={c.candidate_id} className="text-right">
                    <div className="mb-1 text-right tabular-nums font-medium">
                      {formatMetric(cell.candidate)}
                    </div>
                    <div className="flex w-full items-center justify-end gap-1.5 text-xs">
                      <DeltaChip value={cell.delta} />
                      <PValueLabel value={cell.wilcoxon_p_value} />
                    </div>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
          <TableRow>
            <TableCell>Found@k (McNemar)</TableCell>
            <TableCell className="text-right text-muted-foreground">—</TableCell>
            {comparisons.map((c) => (
              <TableCell key={c.candidate_id} className="text-right">
                <div className="flex w-full items-center justify-end gap-1.5 text-xs">
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums ${
                      c.found_at_k.n_candidate_only > 0 ? POSITIVE_CHIP : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <ArrowUpIcon className="size-3" />+{c.found_at_k.n_candidate_only}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums ${
                      c.found_at_k.n_baseline_only > 0 ? NEGATIVE_CHIP : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <ArrowDownIcon className="size-3" />-{c.found_at_k.n_baseline_only}
                  </span>
                </div>
                <div className="mt-1 text-right text-xs">
                  <PValueLabel value={c.found_at_k.p_value} />
                </div>
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

interface CaseRow {
  test_case_id: number
  content: string
  baseline: number
  perCandidate: Map<number, number>
  maxAbsDelta: number
}

function buildCaseRows(comparisons: RunComparisonOut[], metric: PerCaseMetric): CaseRow[] {
  const rows = new Map<number, CaseRow>()
  for (const comparison of comparisons) {
    for (const c of comparison.cases) {
      let row = rows.get(c.test_case_id)
      if (!row) {
        row = {
          test_case_id: c.test_case_id,
          content: c.content,
          baseline: c.baseline[metric],
          perCandidate: new Map(),
          maxAbsDelta: 0,
        }
        rows.set(c.test_case_id, row)
      }
      const delta = c.candidate[metric] - c.baseline[metric]
      row.perCandidate.set(comparison.candidate_id, c.candidate[metric])
      row.maxAbsDelta = Math.max(row.maxAbsDelta, Math.abs(delta))
    }
  }
  return [...rows.values()].sort((a, b) => b.maxAbsDelta - a.maxAbsDelta)
}

function PerCaseTable({
  comparisons,
  metric,
}: {
  comparisons: RunComparisonOut[]
  metric: PerCaseMetric
}) {
  const rows = useMemo(() => buildCaseRows(comparisons, metric), [comparisons, metric])

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No test cases shared between the baseline and any candidate run.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test case</TableHead>
            <TableHead className="text-right">Baseline</TableHead>
            {comparisons.map((c) => (
              <TableHead key={c.candidate_id} className="text-right">
                {candidateLabel(c)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.test_case_id}>
              <TableCell>{row.content}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMetric(row.baseline)}</TableCell>
              {comparisons.map((c) => {
                const value = row.perCandidate.get(c.candidate_id)
                if (value === undefined) {
                  return (
                    <TableCell key={c.candidate_id} className="text-right text-muted-foreground">
                      —
                    </TableCell>
                  )
                }
                const delta = value - row.baseline
                return (
                  <TableCell key={c.candidate_id} className="text-right">
                    <div className="mb-1 text-right tabular-nums">{formatMetric(value)}</div>
                    <div className="flex w-full justify-end">
                      <DeltaChip value={delta} />
                    </div>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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

  const comparisonsWithOverlap = comparison?.comparisons.filter((c) => c.overlap_case_count > 0) ?? []

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
              render={
                <Link to={`/eval/collections/${collectionId}/results`}>
                  {collection?.name ?? `Collection #${collectionId}`}
                </Link>
              }
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

      {comparison && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Baseline: Run #{comparison.baseline_id} — {comparison.baseline_configuration_name}
          </p>

          {comparisonsWithOverlap.length > 0 ? (
            <SummaryTable comparisons={comparisonsWithOverlap} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No candidate run shares any test case with the baseline — nothing to compare.
            </p>
          )}

          {comparisonsWithOverlap.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                <span className="self-center pr-2 text-xs text-muted-foreground">
                  Per-case metric:
                </span>
                {METRIC_ROWS.map((m) => (
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
              <PerCaseTable comparisons={comparisonsWithOverlap} metric={distributionMetric} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
