import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  getMetricSweep,
  getResultCollectionReport,
  listTestCases,
  type CaseMetricsOut,
  type MetricSweepOut,
  type ResultCollectionReportOut,
  type TestCaseOut,
} from './api'
import { ConfigurationSnapshotPanel } from './ConfigurationSnapshotPanel'
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
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  type Bar,
  BarsSvg,
  type CsvData,
  ExportRow,
  type LineSeries,
  LineSvg,
} from '@/components/svg-charts'

type PerCaseMetric = 'recall_at_k' | 'precision_at_k' | 'reciprocal_rank' | 'ndcg_at_k'
type SortKey = 'result_case_id' | PerCaseMetric
type CurveMetric = 'recall' | 'precision' | 'ndcg' | 'mrr'

const PER_CASE_METRICS: { key: PerCaseMetric; label: string }[] = [
  { key: 'recall_at_k', label: 'Recall@k' },
  { key: 'precision_at_k', label: 'Precision@k' },
  { key: 'reciprocal_rank', label: 'Reciprocal rank' },
  { key: 'ndcg_at_k', label: 'nDCG@k' },
]

const CURVE_METRICS: { key: CurveMetric; label: string; strokeClassName: string }[] = [
  { key: 'recall', label: 'Recall@k', strokeClassName: 'stroke-chart-1' },
  { key: 'precision', label: 'Precision@k', strokeClassName: 'stroke-chart-2' },
  { key: 'ndcg', label: 'nDCG@k', strokeClassName: 'stroke-chart-3' },
  { key: 'mrr', label: 'MRR', strokeClassName: 'stroke-chart-4' },
]

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  dir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === activeKey
  return (
    <TableHead>
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active &&
          (dir === 'asc' ? (
            <ArrowUpIcon className="size-3" />
          ) : (
            <ArrowDownIcon className="size-3" />
          ))}
      </button>
    </TableHead>
  )
}

export function EvalResultPage() {
  const { id } = useParams()
  const resultCollectionId = Number(id)

  const [report, setReport] = useState<ResultCollectionReportOut | null>(null)
  const [sweep, setSweep] = useState<MetricSweepOut | null>(null)
  const [testCasesById, setTestCasesById] = useState<Map<number, TestCaseOut>>(new Map())
  const [k, setK] = useState(10)
  const [tau, setTau] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('result_case_id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [distributionMetric, setDistributionMetric] = useState<PerCaseMetric>('ndcg_at_k')
  const [visibleCurveMetrics, setVisibleCurveMetrics] = useState<Set<CurveMetric>>(
    new Set(CURVE_METRICS.map((m) => m.key)),
  )
  const [error, setError] = useState<string | null>(null)

  const curveRef = useRef<SVGSVGElement>(null)
  const distributionRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const [reportData, cases] = await Promise.all([
          getResultCollectionReport(resultCollectionId, { k, tau }),
          listTestCases(),
        ])
        setReport(reportData)
        setTestCasesById(new Map(cases.map((c) => [c.id, c])))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load report')
      }
    }
    load()
  }, [resultCollectionId, k, tau])

  useEffect(() => {
    getMetricSweep(resultCollectionId, { tau })
      .then(setSweep)
      .catch(() => setSweep(null))
  }, [resultCollectionId, tau])

  const sortedCases = useMemo(() => {
    if (!report) return []
    const cases = [...report.cases]
    cases.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey]
      return sortDir === 'asc' ? diff : -diff
    })
    return cases
  }, [report, sortKey, sortDir])

  const casesInIdOrder = useMemo(
    () => (report ? [...report.cases].sort((a, b) => a.result_case_id - b.result_case_id) : []),
    [report],
  )

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function caseLabel(caseMetrics: CaseMetricsOut): string {
    return testCasesById.get(caseMetrics.test_case_id)?.content ?? `#${caseMetrics.test_case_id}`
  }

  function handleToggleCurveMetric(key: CurveMetric) {
    setVisibleCurveMetrics((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!report) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const statTiles = [
    { label: `Recall@${k}`, value: report.recall_at_k },
    { label: `Precision@${k}`, value: report.precision_at_k },
    { label: 'MRR', value: report.mrr },
    { label: `nDCG@${k}`, value: report.ndcg_at_k },
  ]

  const allCurveSeries: (LineSeries & { key: CurveMetric })[] = sweep
    ? [
        {
          key: 'recall',
          label: 'Recall@k',
          strokeClassName: 'stroke-chart-1',
          points: sweep.points.map((p) => ({ x: p.k, y: p.recall_at_k })),
        },
        {
          key: 'precision',
          label: 'Precision@k',
          strokeClassName: 'stroke-chart-2',
          points: sweep.points.map((p) => ({ x: p.k, y: p.precision_at_k })),
        },
        {
          key: 'ndcg',
          label: 'nDCG@k',
          strokeClassName: 'stroke-chart-3',
          points: sweep.points.map((p) => ({ x: p.k, y: p.ndcg_at_k })),
        },
        {
          key: 'mrr',
          label: 'MRR',
          strokeClassName: 'stroke-chart-4',
          dashed: true,
          points: [
            { x: 1, y: sweep.mrr },
            { x: 50, y: sweep.mrr },
          ],
        },
      ]
    : []
  const curveSeries = allCurveSeries.filter((s) => visibleCurveMetrics.has(s.key))

  const curveCsv: CsvData | undefined = sweep
    ? {
        headers: ['k', ...curveSeries.map((s) => s.label)],
        rows: sweep.points.map((p) => [
          p.k,
          ...curveSeries.map((s) => {
            switch (s.key) {
              case 'recall':
                return p.recall_at_k
              case 'precision':
                return p.precision_at_k
              case 'ndcg':
                return p.ndcg_at_k
              case 'mrr':
                return sweep.mrr
            }
          }),
        ]),
      }
    : undefined

  const distributionLabel = PER_CASE_METRICS.find((m) => m.key === distributionMetric)?.label
  const distributionBars: Bar[] = casesInIdOrder.map((c) => ({
    value: c[distributionMetric],
    label: `#${c.result_case_id}`,
    tooltip: `#${c.result_case_id} ${caseLabel(c)}: ${c[distributionMetric].toFixed(3)}`,
  }))
  const distributionCsv: CsvData = {
    headers: ['result_case_id', 'test_case', distributionLabel ?? distributionMetric],
    rows: casesInIdOrder.map((c) => [c.result_case_id, caseLabel(c), c[distributionMetric]]),
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
              render={
                <Link to={`/eval/collections/${report.test_collection_id}/results`}>
                  {report.test_collection_name}
                </Link>
              }
            />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Run #{report.id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="font-heading text-xl leading-snug font-medium">Run #{report.id}</h1>
        <p className="text-sm text-muted-foreground">Status: {report.status}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <ConfigurationSnapshotPanel
            name={report.configuration_snapshot.name}
            weights={report.configuration_snapshot.weights}
          />

          <div className="space-y-4 rounded-md border border-border p-3">
            <div className="space-y-1">
              <Label htmlFor="report-k">K: {k}</Label>
              <Slider
                id="report-k"
                min={1}
                max={50}
                step={1}
                value={[k]}
                onValueChange={(value) => setK(Array.isArray(value) ? value[0] : value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-tau">τ (relevance threshold)</Label>
              <Select value={String(tau)} onValueChange={(value) => value && setTau(Number(value))}>
                <SelectTrigger id="report-tau" className="w-full">
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
        </div>

        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 rounded-md bg-background/60 py-3 text-center sm:grid-cols-4">
            {statTiles.map((tile) => (
              <div key={tile.label}>
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  {tile.label}
                </dt>
                <dd className="font-medium tabular-nums text-foreground">{tile.value.toFixed(3)}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {sweep && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Metrics vs k</p>
                <LineSvg
                  svgRef={curveRef}
                  series={curveSeries}
                  xDomain={[1, 50]}
                  markerX={k}
                  markerLabel={`k=${k}`}
                  ariaLabel="Line chart of the selected metrics across k"
                  width={380}
                  height={200}
                />
                <div className="flex flex-wrap justify-center gap-3">
                  {CURVE_METRICS.map((m) => (
                    <label
                      key={m.key}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <Checkbox
                        checked={visibleCurveMetrics.has(m.key)}
                        onCheckedChange={() => handleToggleCurveMetric(m.key)}
                        aria-label={`Toggle ${m.label} line`}
                      />
                      <span
                        className={`inline-block h-0.5 w-3 ${m.strokeClassName.replace('stroke-', 'bg-')}`}
                        aria-hidden
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
                <ExportRow
                  svgRef={curveRef}
                  filenamePrefix={`metrics-vs-k-run-${report.id}`}
                  csv={curveCsv}
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Per-case distribution</p>
              </div>
              <BarsSvg
                svgRef={distributionRef}
                bars={distributionBars}
                showLabels
                ariaLabel={`Bar chart of ${distributionLabel} for each test case, ordered by case id`}
                width={380}
                height={200}
              />
              <div className="flex flex-wrap justify-center gap-1">
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
              <ExportRow
                svgRef={distributionRef}
                filenamePrefix={`per-case-${distributionMetric}-run-${report.id}`}
                csv={distributionCsv}
              />
            </div>
          </div>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              label="ID"
              sortKey="result_case_id"
              activeKey={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <TableHead>Test case</TableHead>
            <SortableHead
              label={`Recall@${k}`}
              sortKey="recall_at_k"
              activeKey={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHead
              label={`Precision@${k}`}
              sortKey="precision_at_k"
              activeKey={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHead
              label="Reciprocal rank"
              sortKey="reciprocal_rank"
              activeKey={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <SortableHead
              label={`nDCG@${k}`}
              sortKey="ndcg_at_k"
              activeKey={sortKey}
              dir={sortDir}
              onSort={handleSort}
            />
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedCases.map((caseMetrics) => (
            <TableRow key={caseMetrics.result_case_id}>
              <TableCell className="tabular-nums">{caseMetrics.result_case_id}</TableCell>
              <TableCell>{caseLabel(caseMetrics)}</TableCell>
              <TableCell className="tabular-nums">{caseMetrics.recall_at_k.toFixed(3)}</TableCell>
              <TableCell className="tabular-nums">{caseMetrics.precision_at_k.toFixed(3)}</TableCell>
              <TableCell className="tabular-nums">
                {caseMetrics.reciprocal_rank.toFixed(3)}
              </TableCell>
              <TableCell className="tabular-nums">{caseMetrics.ndcg_at_k.toFixed(3)}</TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      to={`/eval/results/${report.id}/cases/${caseMetrics.result_case_id}?k=${k}&tau=${tau}`}
                    />
                  }
                >
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
