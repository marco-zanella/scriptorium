import { useEffect, useState } from 'react'
import {
  ApiError,
  createApiToken,
  listApiTokens,
  purgeApiToken,
  revokeApiToken,
  type ApiTokenOut,
} from '../../api'
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
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ApiKeysCard() {
  const [tokens, setTokens] = useState<ApiTokenOut[]>([])
  const [name, setName] = useState('ingestion-cli')
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  async function loadTokens() {
    try {
      setTokens(await listApiTokens())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load API keys')
    }
  }

  useEffect(() => {
    loadTokens()
  }, [])

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const token = await createApiToken(name.trim() || 'ingestion-cli', ['index_content'])
      setRawKey(token.raw_key)
      await loadTokens()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate API key')
    } finally {
      setGenerating(false)
    }
  }

  async function revoke(id: number) {
    try {
      await revokeApiToken(id)
      await loadTokens()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke API key')
    }
  }

  async function purge(id: number) {
    try {
      await purgeApiToken(id)
      await loadTokens()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete API key')
    }
  }

  return (
    <Card id="api-keys">
      <CardHeader>
        <h2 className="font-heading text-lg leading-snug font-medium">API keys</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Used by the client-side CLI scripts (<code>embed_documents.py</code>/
          <code>ingest_documents.py</code>) to push content — pass it as <code>--api-key</code>.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.id}>
                <TableCell>{token.name ?? '(unnamed)'}</TableCell>
                <TableCell>{new Date(token.created_at).toLocaleDateString()}</TableCell>
                <TableCell>{token.revoked_at ? 'Revoked' : 'Active'}</TableCell>
                <TableCell>
                  {token.revoked_at ? (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button variant="outline" size="sm">
                            Delete
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this API key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            It's already revoked and unusable — this only removes it from the
                            list. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                          <AlertDialogAction variant="destructive" onClick={() => purge(token.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button variant="destructive" size="sm">
                            Revoke
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Any CLI script using it will stop being able to authenticate. This
                            cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel render={<Button variant="outline">Cancel</Button>} />
                          <AlertDialogAction variant="destructive" onClick={() => revoke(token.id)}>
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              {rawKey ? (
                <TableCell colSpan={4}>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={rawKey}
                      onFocus={(e) => e.target.select()}
                      className="flex-1"
                    />
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      Copy now — won't be shown again.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRawKey(null)
                        setName('ingestion-cli')
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </TableCell>
              ) : (
                <>
                  <TableCell>
                    <Label htmlFor="api-key-name" className="sr-only">
                      Name
                    </Label>
                    <Input
                      id="api-key-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell>
                    <Button onClick={generate} disabled={generating} size="sm">
                      {generating ? 'Generating…' : 'Generate API key'}
                    </Button>
                  </TableCell>
                </>
              )}
            </TableRow>
          </TableBody>
        </Table>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
