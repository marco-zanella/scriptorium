import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  deleteResultCollection,
  getTestCollection,
  listResultCollections,
  runTestCollection,
  type ResultCollectionOut,
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const POLL_INTERVAL_MS = 2000

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}

function formatDate(value: string | null): string {
  return value === null ? '—' : new Date(value).toLocaleString()
}

export function EvalTestCollectionResultsPage() {
  const { id } = useParams()
  const collectionId = Number(id)

  const [collection, setCollection] = useState<TestCollectionOut | null>(null)
  const [runs, setRuns] = useState<ResultCollectionOut[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [col, runHistory] = await Promise.all([
        getTestCollection(collectionId),
        listResultCollections(collectionId),
      ])
      setCollection(col)
      setRuns(runHistory)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load results')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId])

  useEffect(() => {
    const hasInProgress = runs.some((run) => run.status === 'pending' || run.status === 'running')
    if (!hasInProgress) return
    const interval = setInterval(async () => {
      setRuns(await listResultCollections(collectionId))
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [runs, collectionId])

  async function handleRun() {
    setRunning(true)
    setError(null)
    try {
      const newRun = await runTestCollection(collectionId)
      setRuns((current) => [newRun, ...current])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start run')
    } finally {
      setRunning(false)
    }
  }

  async function handleDelete(resultCollectionId: number) {
    await deleteResultCollection(resultCollectionId)
    setRuns((current) => current.filter((run) => run.id !== resultCollectionId))
  }

  if (!collection) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/eval/collections">Test collections</Link>} />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{collection.name}</BreadcrumbPage>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Results</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl leading-snug font-medium">{collection.name}</h1>
        <Button onClick={handleRun} disabled={running || collection.test_case_count === 0}>
          {running ? 'Starting…' : 'Run'}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Configuration</TableHead>
            <TableHead>MRR</TableHead>
            <TableHead>Recall@10</TableHead>
            <TableHead>Precision@10</TableHead>
            <TableHead>nDCG@10</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                No runs yet.
              </TableCell>
            </TableRow>
          )}
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>{run.configuration_snapshot.name}</TableCell>
              <TableCell className="tabular-nums">{formatMetric(run.mrr)}</TableCell>
              <TableCell className="tabular-nums">{formatMetric(run.recall_at_k)}</TableCell>
              <TableCell className="tabular-nums">{formatMetric(run.precision_at_k)}</TableCell>
              <TableCell className="tabular-nums">{formatMetric(run.ndcg_at_k)}</TableCell>
              <TableCell>
                <span className="capitalize">{run.status}</span>
                {run.status === 'failed' && run.error && (
                  <p className="text-xs text-destructive">{run.error}</p>
                )}
              </TableCell>
              <TableCell>{formatDate(run.started_at)}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link to={`/eval/results/${run.id}`} />}
                  >
                    View
                  </Button>
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
                        <AlertDialogTitle>Delete this run?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the run and its results. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(run.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
