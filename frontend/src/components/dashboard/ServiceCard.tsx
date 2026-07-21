import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

interface ServiceCardProps {
  icon: LucideIcon
  title: string
  description: string
  to: string
  children?: ReactNode
}

export function ServiceCard({ icon: Icon, title, description, to, children }: ServiceCardProps) {
  const content = (
    <Card className="h-full transition-colors hover:bg-muted/40">
      <CardHeader>
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <h3 className="font-heading text-base leading-snug font-medium">{title}</h3>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{description}</p>
        {children}
      </CardContent>
    </Card>
  )

  if (to.startsWith('#')) {
    return <a href={to}>{content}</a>
  }
  return <Link to={to}>{content}</Link>
}
