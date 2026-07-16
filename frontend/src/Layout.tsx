import { Link, Outlet } from 'react-router-dom'
import { useAuth } from './auth-provider'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'

export function Layout() {
  const { user, logout } = useAuth()
  const canManageUsers = user?.is_superuser || (user?.roles.includes('manage_users') ?? false)
  const canSearch = user?.is_superuser || (user?.roles.includes('use_search_engine') ?? false)

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link to="/" className="font-heading text-lg font-medium">
            Scriptorium
          </Link>
          {canSearch && (
            <Link to="/search" className="text-sm text-muted-foreground hover:text-foreground">
              Search
            </Link>
          )}
          {canManageUsers && (
            <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
              Users
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  )
}
