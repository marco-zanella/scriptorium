import { useEffect, useState } from 'react'
import {
  listConversations,
  listSearchConfigurations,
  listTestCollections,
  listUsers,
} from '../../api'

export function SearchStat() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    listSearchConfigurations()
      .then((configs) => setCount(configs.filter((c) => !c.is_preset).length))
      .catch(() => setCount(null))
  }, [])

  if (count === null) return null
  return (
    <p className="text-sm text-muted-foreground">
      {count} saved configuration{count === 1 ? '' : 's'}
    </p>
  )
}

export function RagStat() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    listConversations()
      .then((conversations) => setCount(conversations.length))
      .catch(() => setCount(null))
  }, [])

  if (count === null) return null
  return (
    <p className="text-sm text-muted-foreground">
      {count} conversation{count === 1 ? '' : 's'}
    </p>
  )
}

export function EvalStat() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    listTestCollections()
      .then((collections) => setCount(collections.length))
      .catch(() => setCount(null))
  }, [])

  if (count === null) return null
  return (
    <p className="text-sm text-muted-foreground">
      {count} test collection{count === 1 ? '' : 's'}
    </p>
  )
}

export function AdminStat() {
  const [stats, setStats] = useState<{ total: number; active: number } | null>(null)

  useEffect(() => {
    listUsers()
      .then((users) => setStats({ total: users.length, active: users.filter((u) => u.is_active).length }))
      .catch(() => setStats(null))
  }, [])

  if (stats === null) return null
  return (
    <p className="text-sm text-muted-foreground">
      {stats.active}/{stats.total} active users
    </p>
  )
}
