import {
  FlaskConical,
  type LucideIcon,
  MessageSquareText,
  Search,
  UploadCloud,
  Users,
} from 'lucide-react'

export interface ServiceMeta {
  role: string
  label: string
  description: string
  icon: LucideIcon
  route: string
}

export const SERVICE_DIRECTORY: ServiceMeta[] = [
  {
    role: 'use_search_engine',
    label: 'Search',
    description: 'Query the indexed corpus and tune ranking configurations.',
    icon: Search,
    route: '/search',
  },
  {
    role: 'use_rag',
    label: 'RAG Chat',
    description: 'Ask questions answered with retrieved citations.',
    icon: MessageSquareText,
    route: '/rag',
  },
  {
    role: 'run_experiments',
    label: 'Eval Harness',
    description: 'Build test collections and benchmark search configurations.',
    icon: FlaskConical,
    route: '/eval/collections',
  },
  {
    role: 'manage_users',
    label: 'User Admin',
    description: 'Manage accounts, roles, and access.',
    icon: Users,
    route: '/admin',
  },
  {
    role: 'index_content',
    label: 'Ingestion',
    description: 'Push new content into the search index from the CLI.',
    icon: UploadCloud,
    // Ingestion has no browser page — its only frontend surface is the API-key
    // card in the dashboard's account section, so this points there instead.
    route: '#api-keys',
  },
]
