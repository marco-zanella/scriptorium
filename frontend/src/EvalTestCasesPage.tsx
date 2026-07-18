import { type FormEvent, useEffect, useState } from 'react'
import {
  ApiError,
  addTestCaseTarget,
  createTestCase,
  deleteTestCase,
  deleteTestCaseTarget,
  listTestCases,
  updateTestCase,
  type TestCaseInput,
  type TestCaseOut,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function EvalTestCasesPage() {
  const [cases, setCases] = useState<TestCaseOut[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TestCaseOut | null>(null)
  const [managingTargets, setManagingTargets] = useState<TestCaseOut | null>(null)

  async function load() {
    try {
      setCases(await listTestCases())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load test cases')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(testCase: TestCaseOut) {
    await deleteTestCase(testCase.id)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-xl leading-snug font-medium">Test cases</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button>New test case</Button>} />
          <DialogContent className="sm:max-w-lg">
            <TestCaseForm
              onSubmit={async (body) => {
                await createTestCase(body)
                setCreateOpen(false)
                await load()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Content</TableHead>
            <TableHead>Language</TableHead>
            <TableHead>Targets</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((testCase) => (
            <TableRow key={testCase.id}>
              <TableCell>{testCase.content}</TableCell>
              <TableCell>{testCase.language}</TableCell>
              <TableCell>{testCase.targets.length}</TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Dialog
                    open={managingTargets?.id === testCase.id}
                    onOpenChange={(open) => setManagingTargets(open ? testCase : null)}
                  >
                    <DialogTrigger
                      render={
                        <Button variant="outline" size="sm">
                          Targets
                        </Button>
                      }
                    />
                    <DialogContent className="sm:max-w-lg">
                      <TargetEditor testCase={testCase} onChanged={load} />
                    </DialogContent>
                  </Dialog>

                  <Dialog
                    open={editing?.id === testCase.id}
                    onOpenChange={(open) => setEditing(open ? testCase : null)}
                  >
                    <DialogTrigger render={<Button variant="outline" size="sm">Edit</Button>} />
                    <DialogContent className="sm:max-w-lg">
                      <TestCaseForm
                        initial={testCase}
                        onSubmit={async (body) => {
                          await updateTestCase(testCase.id, body)
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
                        <AlertDialogTitle>Delete this test case?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the test case and its targets. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(testCase)}
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

function TestCaseForm({
  initial,
  onSubmit,
}: {
  initial?: TestCaseOut
  onSubmit: (body: TestCaseInput) => Promise<void>
}) {
  const isEdit = initial !== undefined
  const [content, setContent] = useState(initial?.content ?? '')
  const [language, setLanguage] = useState(initial?.language ?? '')
  const [context, setContext] = useState(initial?.context ?? '')
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onSubmit({
        content,
        language,
        context: context || null,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit test case' : 'New test case'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="case-content">Query content</Label>
        <Input
          id="case-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="case-language">Language (ISO code)</Label>
        <Input
          id="case-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="case-context">Context (optional)</Label>
        <Input id="case-context" value={context} onChange={(e) => setContext(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="case-tags">Tags (comma-separated)</Label>
        <Input id="case-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit">{isEdit ? 'Save' : 'Create'}</Button>
      </DialogFooter>
    </form>
  )
}

function TargetEditor({
  testCase,
  onChanged,
}: {
  testCase: TestCaseOut
  onChanged: () => void
}) {
  const [targets, setTargets] = useState(testCase.targets)
  const [newTarget, setNewTarget] = useState('')
  const [newRelevance, setNewRelevance] = useState(1)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const created = await addTestCaseTarget(testCase.id, newTarget, newRelevance)
      setTargets([...targets, created])
      setNewTarget('')
      setNewRelevance(1)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add target')
    }
  }

  async function handleDelete(targetId: number) {
    await deleteTestCaseTarget(testCase.id, targetId)
    setTargets(targets.filter((t) => t.id !== targetId))
    onChanged()
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Targets for “{testCase.content}”</DialogTitle>
      </DialogHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Content id</TableHead>
            <TableHead>Relevance</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {targets.map((target) => (
            <TableRow key={target.id}>
              <TableCell>{target.target}</TableCell>
              <TableCell>{target.relevance}</TableCell>
              <TableCell>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(target.id)}>
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <form onSubmit={handleAdd} className="flex items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor="new-target">Content id</Label>
          <Input
            id="new-target"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-relevance">Relevance (0–3)</Label>
          <Input
            id="new-relevance"
            type="number"
            min={0}
            max={3}
            value={newRelevance}
            onChange={(e) => setNewRelevance(Number(e.target.value))}
            className="w-20"
          />
        </div>
        <Button type="submit">Add</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
