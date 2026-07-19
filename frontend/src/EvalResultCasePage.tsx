import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, getResultCaseDetail, type ResultCaseDetailOut } from './api'
import { describeHit } from './format-search-hit'
import { RELEVANCE_LEVELS, relevanceLabel } from './relevance'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
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
import { cn } from '@/lib/utils'

export function EvalResultCasePage() {
  const { resultCollectionId: resultCollectionIdParam, caseId: caseIdParam } = useParams()
  const resultCollectionId = Number(resultCollectionIdParam)
  const caseId = Number(caseIdParam)
  const [searchParams, setSearchParams] = useSearchParams()

  const [detail, setDetail] = useState<ResultCaseDetailOut | null>(null)
  const [k, setK] = useState(() => Number(searchParams.get('k') ?? 10))
  const [tau, setTau] = useState(() => Number(searchParams.get('tau') ?? 1))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getResultCaseDetail(resultCollectionId, caseId, { k, tau })
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load case'))
  }, [resultCollectionId, caseId, k, tau])

  useEffect(() => {
    setSearchParams({ k: String(k), tau: String(tau) }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, tau])

  if (!detail) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const targetRelevanceByTarget = new Map(detail.snapshot.targets.map((t) => [t.target, t.relevance]))
  const retrievedIds = new Set(detail.results.map((hit) => hit.id))
  const missedTargets = detail.snapshot.targets.filter((t) => !retrievedIds.has(t.target))

  const statTiles = [
    { label: `Recall@${k}`, value: detail.recall_at_k },
    { label: `Precision@${k}`, value: detail.precision_at_k },
    { label: 'Reciprocal rank', value: detail.reciprocal_rank },
    { label: `nDCG@${k}`, value: detail.ndcg_at_k },
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
            <BreadcrumbLink
              render={
                <Link to={`/eval/collections/${detail.test_collection_id}/results`}>
                  {detail.test_collection_name}
                </Link>
              }
            />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={<Link to={`/eval/results/${resultCollectionId}`}>Run #{resultCollectionId}</Link>}
            />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Case #{detail.id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="font-heading text-xl leading-snug font-medium">{detail.snapshot.content}</h1>
        {detail.snapshot.context && (
          <p className="text-sm text-muted-foreground">{detail.snapshot.context}</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-48 space-y-1">
          <Label htmlFor="case-k">K: {k}</Label>
          <Slider
            id="case-k"
            min={1}
            max={50}
            step={1}
            value={[k]}
            onValueChange={(value) => setK(Array.isArray(value) ? value[0] : value)}
          />
        </div>
        <div className="w-56 space-y-1">
          <Label htmlFor="case-tau">τ (relevance threshold)</Label>
          <Select value={String(tau)} onValueChange={(value) => value && setTau(Number(value))}>
            <SelectTrigger id="case-tau" className="w-full">
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

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Ranked results</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Relevance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.results.map((hit, index) => {
              const rank = index + 1
              const relevance = targetRelevanceByTarget.get(hit.id)
              const withinCutoff = rank <= k
              return (
                <TableRow
                  key={hit.id}
                  className={cn(
                    !withinCutoff && 'opacity-50',
                    rank === k + 1 && 'border-t-2 border-t-foreground/30',
                  )}
                >
                  <TableCell className="tabular-nums">{rank}</TableCell>
                  <TableCell>{describeHit(hit)}</TableCell>
                  <TableCell>{relevance !== undefined ? relevanceLabel(relevance) : '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {missedTargets.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Missed targets</p>
          <p className="text-xs text-muted-foreground">
            Relevant documents for this test case that never appeared in the retrieved results.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>Relevance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missedTargets.map((target) => (
                <TableRow key={target.target}>
                  <TableCell>{target.target}</TableCell>
                  <TableCell>{relevanceLabel(target.relevance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
