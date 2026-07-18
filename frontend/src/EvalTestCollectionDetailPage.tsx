import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ApiError,
  addMemberTestCase,
  getTestCollection,
  listMemberTestCases,
  listResultCollections,
  listTestCases,
  removeMemberTestCase,
  runTestCollection,
  type ResultCollectionOut,
  type TestCaseOut,
  type TestCollectionOut,
} from './api'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const POLL_INTERVAL_MS = 2000

export function EvalTestCollectionDetailPage() {
  const { id } = useParams()
  const collectionId = Number(id)

  const [collection, setCollection] = useState<TestCollectionOut | null>(null)
  const [members, setMembers] = useState<TestCaseOut[]>([])
  const [ownTestCases, setOwnTestCases] = useState<TestCaseOut[]>([])
  const [runs, setRuns] = useState<ResultCollectionOut[]>([])
  const [addCaseId, setAddCaseId] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [col, memberCases, allCases, runHistory] = await Promise.all([
        getTestCollection(collectionId),
        listMemberTestCases(collectionId),
        listTestCases(),
        listResultCollections(collectionId),
      ])
      setCollection(col)
      setMembers(memberCases)
      setOwnTestCases(allCases)
      setRuns(runHistory)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load collection')
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
      setRuns([newRun, ...runs])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start run')
    } finally {
      setRunning(false)
    }
  }

  async function handleAddCase() {
    if (!addCaseId) return
    await addMemberTestCase(collectionId, Number(addCaseId))
    setAddCaseId('')
    await load()
  }

  async function handleRemoveCase(caseId: number) {
    await removeMemberTestCase(collectionId, caseId)
    await load()
  }

  if (!collection) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null
  }

  const memberIds = new Set(members.map((c) => c.id))
  const availableCases = ownTestCases.filter((c) => !memberIds.has(c.id))

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/eval/collections">Test collections</Link>} />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{collection.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="font-heading text-xl leading-snug font-medium">{collection.name}</h1>
        {collection.description && (
          <p className="text-sm text-muted-foreground">{collection.description}</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-2">
        <h2 className="font-heading text-lg leading-snug font-medium">Test cases</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Content</TableHead>
              <TableHead>Language</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((testCase) => (
              <TableRow key={testCase.id}>
                <TableCell>{testCase.content}</TableCell>
                <TableCell>{testCase.language}</TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemoveCase(testCase.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-end gap-2">
          <Select value={addCaseId} onValueChange={(value) => setAddCaseId(value ?? '')}>
            <SelectTrigger aria-label="Add a test case" className="w-64">
              <SelectValue placeholder="Select a test case">
                {availableCases.find((c) => String(c.id) === addCaseId)?.content}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableCases.map((testCase) => (
                <SelectItem key={testCase.id} value={String(testCase.id)}>
                  {testCase.content}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAddCase} disabled={!addCaseId}>
            Add
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg leading-snug font-medium">Runs</h2>
          <Button onClick={handleRun} disabled={running || members.length === 0}>
            {running ? 'Starting…' : 'Run'}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{run.status}</TableCell>
                <TableCell>{run.started_at ?? '—'}</TableCell>
                <TableCell>
                  <Link to={`/eval/results/${run.id}`} className="text-sm hover:underline">
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
