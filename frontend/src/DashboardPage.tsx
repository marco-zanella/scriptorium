import { useState } from 'react'
import { useAuth } from './auth-provider'
import { ApiError, createApiToken } from './api'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function IngestionApiKeyCard() {
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const generate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const token = await createApiToken('ingestion-cli', ['index_content'])
      setRawKey(token.raw_key)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate API key')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card className="max-w-sm">
      <CardHeader>
        <h2 className="font-heading text-lg leading-snug font-medium">Ingestion API key</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Used by the client-side CLI scripts (<code>embed_documents.py</code>/
          <code>ingest_documents.py</code>) to push content — pass it as <code>--api-key</code>.
        </p>
        {rawKey ? (
          <div className="space-y-1">
            <Input readOnly value={rawKey} onFocus={(e) => e.target.select()} />
            <p className="text-xs text-muted-foreground">
              Copy this now — it won't be shown again.
            </p>
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

export function DashboardPage() {
  const { user } = useAuth()
  if (!user) return null

  const canIngest = user.is_superuser || user.roles.includes('index_content')

  return (
    <div className="space-y-4">
      <Card className="max-w-sm">
        <CardHeader>
          <h1 className="font-heading text-xl leading-snug font-medium">Signed in</h1>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1 text-sm text-muted-foreground">
            <div>
              <dt className="inline font-medium text-foreground">User ID:</dt>{' '}
              <dd className="inline">{user.user_id}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Roles:</dt>{' '}
              <dd className="inline">{user.roles.join(', ') || '(none)'}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">Superuser:</dt>{' '}
              <dd className="inline">{user.is_superuser ? 'yes' : 'no'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      {canIngest && <IngestionApiKeyCard />}
    </div>
  )
}
