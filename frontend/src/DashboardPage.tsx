import { useAuth } from './auth-provider'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function DashboardPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
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
  )
}
