import type { ComponentType } from 'react'
import { useAuth } from './auth-provider'
import type { MeResponse } from './api'
import { SERVICE_DIRECTORY, type ServiceMeta } from './service-directory'
import { ApiKeysCard } from './components/dashboard/ApiKeysCard'
import { PasswordChangeCard } from './components/dashboard/PasswordChangeDialog'
import { ServiceCard } from './components/dashboard/ServiceCard'
import { AdminStat, EvalStat, RagStat, SearchStat } from './components/dashboard/ServiceStats'

const STAT_BY_ROLE: Record<string, ComponentType> = {
  use_search_engine: SearchStat,
  use_rag: RagStat,
  run_experiments: EvalStat,
  manage_users: AdminStat,
}

function roleSummary(user: MeResponse, heldServices: ServiceMeta[]): string {
  if (user.is_superuser) {
    return 'You have full administrative access to every service.'
  }
  if (heldServices.length === 0) {
    return "You don't have access to any services yet — contact an administrator."
  }
  return `You have access to: ${heldServices.map((s) => s.label).join(', ')}.`
}

export function DashboardPage() {
  const { user } = useAuth()
  if (!user) return null

  const heldServices = SERVICE_DIRECTORY.filter(
    (service) => user.is_superuser || user.roles.includes(service.role),
  )
  const canIngest = user.is_superuser || user.roles.includes('index_content')

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-heading text-2xl leading-snug font-medium">
          Welcome back, {user.username}
        </h1>
        <p className="text-sm text-muted-foreground">{roleSummary(user, heldServices)}</p>
      </header>

      {heldServices.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-medium">Your services</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {heldServices.map((service) => {
              const Stat = STAT_BY_ROLE[service.role]
              return (
                <ServiceCard
                  key={service.role}
                  icon={service.icon}
                  title={service.label}
                  description={service.description}
                  to={service.route}
                >
                  {Stat && <Stat />}
                </ServiceCard>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium">Account</h2>
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
          <PasswordChangeCard />
          {canIngest && <ApiKeysCard />}
        </div>
      </section>
    </div>
  )
}
