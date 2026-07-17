// BASE_URL always has a trailing slash (Vite guarantees this), so this is
// "/api" in dev (BASE_URL "/") and "/scriptorium/api" in production.
const API_BASE = `${import.meta.env.BASE_URL}api`

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, body.detail ?? 'Request failed')
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export interface MeResponse {
  user_id: number
  roles: string[]
  is_superuser: boolean
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export function login(
  username: string,
  password: string,
  rememberMe: boolean,
): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, remember_me: rememberMe }),
  })
}

export function me(): Promise<MeResponse> {
  return request<MeResponse>('/auth/me')
}

export function refresh(): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/refresh', { method: 'POST' })
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

export const ALL_ROLES = [
  'run_experiments',
  'use_search_engine',
  'use_rag',
  'index_content',
  'manage_users',
] as const

export interface UserOut {
  id: number
  username: string
  email: string
  is_active: boolean
  is_superuser: boolean
  roles: string[]
  created_at: string
}

export function listUsers(): Promise<UserOut[]> {
  return request<UserOut[]>('/users')
}

export function createUser(
  username: string,
  email: string,
  password: string,
  roles: string[],
): Promise<UserOut> {
  return request<UserOut>('/users', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, roles }),
  })
}

export interface UserPatch {
  username?: string
  email?: string
  password?: string
  is_active?: boolean
}

export function updateUser(userId: number, patch: UserPatch): Promise<UserOut> {
  return request<UserOut>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteUser(userId: number): Promise<void> {
  return request<void>(`/users/${userId}`, { method: 'DELETE' })
}

export function assignRole(userId: number, role: string): Promise<UserOut> {
  return request<UserOut>(`/users/${userId}/roles/${role}`, { method: 'POST' })
}

export function revokeRole(userId: number, role: string): Promise<UserOut> {
  return request<UserOut>(`/users/${userId}/roles/${role}`, { method: 'DELETE' })
}

export interface LanguageOut {
  iso_code: string
  display_name: string
  directionality: 'ltr' | 'rtl'
}

export function listLanguages(): Promise<LanguageOut[]> {
  return request<LanguageOut[]>('/search/languages')
}

export interface SearchVariant {
  source: string
  content: string
}

export interface SearchHit {
  book: string | null
  chapter: string | null
  verse: string | null
  source: string | null
  content: string | null
  variant: SearchVariant[]
  score: number
}

export interface FacetBucket {
  key: string
  count: number
}

export interface SearchFacets {
  book: FacetBucket[]
  source: FacetBucket[]
}

export interface ScoreStats {
  count: number
  min: number
  max: number
  avg: number
  std_deviation: number
  percentiles: Record<string, number>
}

export interface SearchResponse {
  took_ms: number
  count: number
  page: number
  page_size: number
  results: SearchHit[]
  facets: SearchFacets
  score_stats: ScoreStats | null
}

export type CombinerTechnique = 'rrf' | 'min_max' | 'l2' | 'z_score'
export type CombinationTechnique = 'arithmetic_mean' | 'geometric_mean' | 'harmonic_mean'

export interface Combiner {
  technique: CombinerTechnique
  // only used when technique is not "rrf"
  combination?: CombinationTechnique
  // only used when technique is "rrf"
  rank_constant?: number
}

export interface SearchOptions {
  weights?: Record<string, number>
  variant_weights?: Record<string, number>
  // Balances the lexical vs. semantic bucket overall — distinct from weights/
  // variant_weights, which only affect ranking *within* a bucket.
  bucket_weights?: Record<string, number>
  combiner?: Combiner
  books?: string[]
  sources?: string[]
  page?: number
  page_size?: number
  include_score_stats?: boolean
}

export function search(
  language: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  return request<SearchResponse>(`/search/${language}`, {
    method: 'POST',
    body: JSON.stringify({ query, ...options }),
  })
}

export interface SearchConfigurationWeights {
  weights: Record<string, number>
  variant_weights: Record<string, number>
  // Optional — absent on configurations saved before bucket balance/combiner
  // selection existed; callers fall back to defaults in that case.
  bucket_weights?: Record<string, number>
  combiner?: Combiner
}

export interface SearchConfigurationOut {
  id: number | null
  name: string
  weights: SearchConfigurationWeights
  is_preset: boolean
}

export function listSearchConfigurations(): Promise<SearchConfigurationOut[]> {
  return request<SearchConfigurationOut[]>('/search/configurations')
}

export function createSearchConfiguration(
  name: string,
  weights: SearchConfigurationWeights,
): Promise<SearchConfigurationOut> {
  return request<SearchConfigurationOut>('/search/configurations', {
    method: 'POST',
    body: JSON.stringify({ name, weights }),
  })
}

export function updateSearchConfiguration(
  id: number,
  name: string,
  weights: SearchConfigurationWeights,
): Promise<SearchConfigurationOut> {
  return request<SearchConfigurationOut>(`/search/configurations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, weights }),
  })
}

export function deleteSearchConfiguration(id: number): Promise<void> {
  return request<void>(`/search/configurations/${id}`, { method: 'DELETE' })
}
