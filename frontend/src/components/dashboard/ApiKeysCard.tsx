import { useEffect, useState } from 'react'
import { ApiError, createApiToken, listApiTokens, revokeApiToken, type ApiTokenOut } from '../../api'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ApiKeysCard() {
  const [tokens, setTokens] = useState<ApiTokenOut[]>([])
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
      const token = await createApiToken('ingestion-cli', ['index_content'])
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

        {tokens.length > 0 && (
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
                    {!token.revoked_at && (
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
            </TableBody>
          </Table>
        )}

        {rawKey ? (
          <div className="space-y-1">
            <Input readOnly value={rawKey} onFocus={(e) => e.target.select()} />
            <p className="text-xs text-muted-foreground">Copy this now — it won't be shown again.</p>
          </div>
        ) : (
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? 'Generating…' : 'Generate API key'}
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
