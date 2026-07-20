import { useEffect, useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ApiError,
  getDocument,
  getResultCaseDetail,
  type ResultCaseDetailOut,
  type SearchHit,
} from './api'
import { RELEVANCE_LEVELS, relevanceLabel } from './relevance'
import { type Mode, ScoreDistributionPanel, transform } from './ScoreDistributionPanel'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'
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
  const [missedContent, setMissedContent] = useState<Map<string, SearchHit | null>>(new Map())
  const [scoreMode, setScoreMode] = useState<Mode>('raw')
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set())

  useEffect(() => {
    getResultCaseDetail(resultCollectionId, caseId, { k, tau })
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load case'))
  }, [resultCollectionId, caseId, k, tau])

  useEffect(() => {
    setSearchParams({ k: String(k), tau: String(tau) }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, tau])

  const missingTargetIds = useMemo(() => {
    if (!detail) return []
    const retrievedIds = new Set(detail.results.map((hit) => hit.id))
    return detail.snapshot.targets.map((t) => t.target).filter((id) => !retrievedIds.has(id))
  }, [detail])
  const missingKey = missingTargetIds.join('|')

  useEffect(() => {
    if (!detail || missingTargetIds.length === 0) return
    let cancelled = false
    Promise.all(
      missingTargetIds.map((id) =>
        getDocument(detail.snapshot.language, id)
          .then((hit): [string, SearchHit | null] => [id, hit])
          .catch((): [string, SearchHit | null] => [id, null]),
      ),
    ).then((entries) => {
      if (!cancelled) setMissedContent(new Map(entries))
    })
    return () => {
      cancelled = true
    }
    // missingKey captures the same information as missingTargetIds by value, so the
    // fetch only reruns when the actual missing set changes, not on every k/tau tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, detail?.snapshot.language])

  function toggleVariants(hitId: string) {
    setExpandedVariants((current) => {
      const next = new Set(current)
      if (next.has(hitId)) next.delete(hitId)
      else next.add(hitId)
      return next
    })
  }

  if (!detail) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const targetRelevanceByTarget = new Map(detail.snapshot.targets.map((t) => [t.target, t.relevance]))
  const resultIndexByTarget = new Map(detail.results.map((hit, index) => [hit.id, index]))

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

      <div className="space-y-2">
        <h1 className="font-heading text-xl leading-snug font-medium">{detail.snapshot.content}</h1>
        {detail.snapshot.context && (
          <p className="text-sm text-muted-foreground">{detail.snapshot.context}</p>
        )}
        {detail.snapshot.source && (
          <p className="text-xs text-muted-foreground">Source: {detail.snapshot.source}</p>
        )}
        {detail.snapshot.tags && detail.snapshot.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {detail.snapshot.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 rounded-md bg-background/60 py-3 text-center">
                {statTiles.map((tile) => (
                  <div key={tile.label}>
                    <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                      {tile.label}
                    </dt>
                    <dd className="font-medium tabular-nums text-foreground">
                      {tile.value.toFixed(3)}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="space-y-4 rounded-md border border-border p-3">
                <div className="space-y-1">
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
                <div className="space-y-1">
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
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Targets</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Target</TableHead>
                    <TableHead className="w-full">Content</TableHead>
                    <TableHead>Relevance</TableHead>
                    <TableHead>Position</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.snapshot.targets.map((target) => {
                    const resultIndex = resultIndexByTarget.get(target.target)
                    const found = resultIndex !== undefined
                    const content = found
                      ? detail.results[resultIndex].content
                      : (missedContent.get(target.target)?.content ?? null)
                    return (
                      <TableRow key={target.target}>
                        <TableCell className="font-mono text-xs">{target.target}</TableCell>
                        <TableCell className="max-w-0 truncate" title={content ?? undefined}>
                          {content ?? '—'}
                        </TableCell>
                        <TableCell>{relevanceLabel(target.relevance)}</TableCell>
                        <TableCell className="tabular-nums">
                          {found ? resultIndex + 1 : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Ranked results</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead className="w-full">Content</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Relevance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.results.map((hit, index) => {
                  const rank = index + 1
                  const relevance = targetRelevanceByTarget.get(hit.id)
                  const isTarget = relevance !== undefined
                  const withinCutoff = rank <= k
                  const score = detail.score_stats
                    ? transform(hit.score, detail.score_stats, scoreMode)
                    : hit.score
                  const hasVariants = hit.variant.length > 0
                  const expanded = expandedVariants.has(hit.id)
                  return (
                    <TableRow
                      key={hit.id}
                      className={cn(
                        isTarget && 'bg-accent/50',
                        !withinCutoff && 'opacity-50',
                        rank === k + 1 && 'border-t-2 border-t-foreground/30',
                      )}
                    >
                      <TableCell className="tabular-nums">{rank}</TableCell>
                      <TableCell className="font-mono text-xs">{hit.id}</TableCell>
                      <TableCell className="max-w-0">
                        <div className="truncate" title={hit.content ?? undefined}>
                          {hit.content ?? '—'}
                        </div>
                        {hasVariants && (
                          <button
                            type="button"
                            onClick={() => toggleVariants(hit.id)}
                            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {expanded ? (
                              <ChevronDownIcon className="size-3" />
                            ) : (
                              <ChevronRightIcon className="size-3" />
                            )}
                            {hit.variant.length} variant{hit.variant.length !== 1 ? 's' : ''}
                          </button>
                        )}
                        {hasVariants && expanded && (
                          <div className="mt-1 space-y-1 border-l-2 border-border pl-2">
                            {hit.variant.map((v, variantIndex) => (
                              <p key={variantIndex} className="text-xs text-muted-foreground">
                                <span className="font-medium">{v.source}:</span> {v.content}
                              </p>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{score.toFixed(3)}</TableCell>
                      <TableCell>{isTarget ? relevanceLabel(relevance) : '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          {detail.score_stats ? (
            <ScoreDistributionPanel
              stats={detail.score_stats}
              results={detail.results}
              mode={scoreMode}
              onModeChange={setScoreMode}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Score distribution isn't available for this run.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
