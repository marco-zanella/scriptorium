import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  getResultCollectionReport,
  listTestCases,
  type ResultCollectionReportOut,
  type TestCaseOut,
} from './api'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function EvalResultPage() {
  const { id } = useParams()
  const resultCollectionId = Number(id)

  const [report, setReport] = useState<ResultCollectionReportOut | null>(null)
  const [testCasesById, setTestCasesById] = useState<Map<number, TestCaseOut>>(new Map())
  const [k, setK] = useState(10)
  const [tau, setTau] = useState(1)
  const [error, setError] = useState<string | null>(null)

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

  if (!report) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const statTiles = [
    { label: `Recall@${k}`, value: report.recall_at_k },
    { label: `Precision@${k}`, value: report.precision_at_k },
    { label: 'MRR', value: report.mrr },
    { label: `nDCG@${k}`, value: report.ndcg_at_k },
  ]

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/eval/collections">Test collections</Link>} />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Run #{report.id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="font-heading text-xl leading-snug font-medium">Run #{report.id}</h1>
        <p className="text-sm text-muted-foreground">
          Status: {report.status} · Configuration: {report.configuration_snapshot.name}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="report-k">K</Label>
          <Input
            id="report-k"
            type="number"
            min={1}
            max={50}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
            className="w-20"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-tau">τ (relevance threshold)</Label>
          <Input
            id="report-tau"
            type="number"
            min={0}
            max={3}
            value={tau}
            onChange={(e) => setTau(Number(e.target.value))}
            className="w-20"
          />
        </div>
      </div>

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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test case</TableHead>
            <TableHead>Recall@{k}</TableHead>
            <TableHead>Precision@{k}</TableHead>
            <TableHead>Reciprocal rank</TableHead>
            <TableHead>nDCG@{k}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.cases.map((caseMetrics) => (
            <TableRow key={caseMetrics.result_case_id}>
              <TableCell>
                {testCasesById.get(caseMetrics.test_case_id)?.content ?? `#${caseMetrics.test_case_id}`}
              </TableCell>
              <TableCell className="tabular-nums">{caseMetrics.recall_at_k.toFixed(3)}</TableCell>
              <TableCell className="tabular-nums">{caseMetrics.precision_at_k.toFixed(3)}</TableCell>
              <TableCell className="tabular-nums">
                {caseMetrics.reciprocal_rank.toFixed(3)}
              </TableCell>
              <TableCell className="tabular-nums">{caseMetrics.ndcg_at_k.toFixed(3)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
