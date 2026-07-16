import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './auth-provider'
import { LoadingScreen } from './LoadingScreen'

export function RequireAuth({ children }: { children: ReactElement }) {
  const { status } = useAuth()

  if (status === 'checking') {
    return <LoadingScreen />
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace />
  }
  return children
}

export function RequireRole({ role, children }: { role: string; children: ReactElement }) {
  const { user } = useAuth()
  const authorized = user?.is_superuser || (user?.roles.includes(role) ?? false)

  if (!authorized) {
    return <Navigate to="/" replace />
  }
  return children
}
