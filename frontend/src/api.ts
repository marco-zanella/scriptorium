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

export interface ApiTokenOut {
  id: number
  name: string | null
  scopes: string[]
  created_at: string
  expires_at: string | null
  revoked_at: string | null
}

export interface ApiTokenCreated extends ApiTokenOut {
  raw_key: string
}

export function createApiToken(name: string, scopes: string[]): Promise<ApiTokenCreated> {
  return request<ApiTokenCreated>('/api-tokens', {
    method: 'POST',
    body: JSON.stringify({ name, scopes }),
  })
}

export interface LanguageOut {
  iso_code: string
  display_name: string
  directionality: 'ltr' | 'rtl'
}

export function listLanguages(): Promise<LanguageOut[]> {
  return request<LanguageOut[]>('/search/languages')
}

export interface FacetBucket {
  key: string
  count: number
}

export interface SearchFacets {
  book: FacetBucket[]
  source: FacetBucket[]
}

// Facet options independent of any query — lets the filter sidebar populate
// (and a scope like "Rahlfs Genesis" be pre-selected) before a search runs.
export function getFacets(
  language: string,
  options: { books?: string[]; sources?: string[] } = {},
): Promise<SearchFacets> {
  const params = new URLSearchParams()
  for (const book of options.books ?? []) params.append('books', book)
  for (const source of options.sources ?? []) params.append('sources', source)
  const query = params.toString()
  return request<SearchFacets>(`/search/${language}/facets${query ? `?${query}` : ''}`)
}

export interface SearchVariant {
  source: string
  content: string
}

export interface SearchHit {
  id: string
  type: string | null
  book: string | null
  chapter: string | null
  verse: string | null
  source: string | null
  content: string | null
  variant: SearchVariant[]
  score: number
}

export interface ScoreStats {
  count: number
  min: number
  max: number
  avg: number
  std_deviation: number
  percentiles: Record<string, number>
  gap: number
  confidence: number
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
  id: number
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

export interface TestCaseTargetOut {
  id: number
  target: string
  relevance: number
}

export interface TestCaseOut {
  id: number
  content: string
  language: string
  source: string | null
  context: string | null
  tags: string[]
  targets: TestCaseTargetOut[]
}

export interface TestCaseInput {
  content: string
  language: string
  source?: string | null
  context?: string | null
  tags?: string[]
}

export function listTestCases(): Promise<TestCaseOut[]> {
  return request<TestCaseOut[]>('/eval/test-cases')
}

export function contentSearch(language: string, query: string): Promise<SearchHit[]> {
  const params = new URLSearchParams({ language, query })
  return request<SearchHit[]>(`/eval/test-cases/content-search?${params.toString()}`)
}

export function createTestCase(body: TestCaseInput): Promise<TestCaseOut> {
  return request<TestCaseOut>('/eval/test-cases', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTestCase(id: number, body: TestCaseInput): Promise<TestCaseOut> {
  return request<TestCaseOut>(`/eval/test-cases/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteTestCase(id: number): Promise<void> {
  return request<void>(`/eval/test-cases/${id}`, { method: 'DELETE' })
}

export function addTestCaseTarget(
  caseId: number,
  target: string,
  relevance: number,
): Promise<TestCaseTargetOut> {
  return request<TestCaseTargetOut>(`/eval/test-cases/${caseId}/targets`, {
    method: 'POST',
    body: JSON.stringify({ target, relevance }),
  })
}

export function updateTestCaseTarget(
  caseId: number,
  targetId: number,
  target: string,
  relevance: number,
): Promise<TestCaseTargetOut> {
  return request<TestCaseTargetOut>(`/eval/test-cases/${caseId}/targets/${targetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ target, relevance }),
  })
}

export function deleteTestCaseTarget(caseId: number, targetId: number): Promise<void> {
  return request<void>(`/eval/test-cases/${caseId}/targets/${targetId}`, { method: 'DELETE' })
}

export interface TestCollectionOut {
  id: number
  name: string
  description: string | null
  search_configuration_id: number
  books: string[]
  sources: string[]
  test_case_count: number
}

export interface TestCollectionInput {
  name: string
  description?: string | null
  search_configuration_id: number
  books?: string[]
  sources?: string[]
}

export function listTestCollections(): Promise<TestCollectionOut[]> {
  return request<TestCollectionOut[]>('/eval/test-collections')
}

export function getCollectionContentFacets(): Promise<{ book: string[]; source: string[] }> {
  return request<{ book: string[]; source: string[] }>('/eval/test-collections/content-facets')
}

export function createTestCollection(body: TestCollectionInput): Promise<TestCollectionOut> {
  return request<TestCollectionOut>('/eval/test-collections', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getTestCollection(id: number): Promise<TestCollectionOut> {
  return request<TestCollectionOut>(`/eval/test-collections/${id}`)
}

export function updateTestCollection(
  id: number,
  body: TestCollectionInput,
): Promise<TestCollectionOut> {
  return request<TestCollectionOut>(`/eval/test-collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteTestCollection(id: number): Promise<void> {
  return request<void>(`/eval/test-collections/${id}`, { method: 'DELETE' })
}

export function listMemberTestCases(collectionId: number): Promise<TestCaseOut[]> {
  return request<TestCaseOut[]>(`/eval/test-collections/${collectionId}/test-cases`)
}

export function addMemberTestCase(collectionId: number, caseId: number): Promise<TestCaseOut[]> {
  return request<TestCaseOut[]>(`/eval/test-collections/${collectionId}/test-cases/${caseId}`, {
    method: 'POST',
  })
}

export function removeMemberTestCase(
  collectionId: number,
  caseId: number,
): Promise<TestCaseOut[]> {
  return request<TestCaseOut[]>(`/eval/test-collections/${collectionId}/test-cases/${caseId}`, {
    method: 'DELETE',
  })
}

export interface ResultCollectionOut {
  id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  configuration_snapshot: { name: string; weights: SearchConfigurationWeights }
  books_snapshot: string[]
  sources_snapshot: string[]
  started_at: string | null
  completed_at: string | null
  error: string | null
  recall_at_k: number | null
  precision_at_k: number | null
  mrr: number | null
  ndcg_at_k: number | null
}

export function runTestCollection(collectionId: number): Promise<ResultCollectionOut> {
  return request<ResultCollectionOut>(`/eval/test-collections/${collectionId}/run`, {
    method: 'POST',
  })
}

export function listResultCollections(collectionId: number): Promise<ResultCollectionOut[]> {
  return request<ResultCollectionOut[]>(
    `/eval/test-collections/${collectionId}/result-collections`,
  )
}

export function deleteResultCollection(resultCollectionId: number): Promise<void> {
  return request<void>(`/eval/result-collections/${resultCollectionId}`, { method: 'DELETE' })
}

export interface CaseMetricsOut {
  result_case_id: number
  test_case_id: number
  recall_at_k: number
  precision_at_k: number
  reciprocal_rank: number
  ndcg_at_k: number
}

export interface ResultCollectionReportOut {
  id: number
  test_collection_id: number
  test_collection_name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  configuration_snapshot: { name: string; weights: SearchConfigurationWeights }
  books_snapshot: string[]
  sources_snapshot: string[]
  k: number
  tau: number
  recall_at_k: number
  precision_at_k: number
  mrr: number
  ndcg_at_k: number
  cases: CaseMetricsOut[]
}

export function getResultCollectionReport(
  resultCollectionId: number,
  options: { k?: number; tau?: number } = {},
): Promise<ResultCollectionReportOut> {
  const params = new URLSearchParams()
  if (options.k !== undefined) params.set('k', String(options.k))
  if (options.tau !== undefined) params.set('tau', String(options.tau))
  const query = params.toString()
  return request<ResultCollectionReportOut>(
    `/eval/result-collections/${resultCollectionId}${query ? `?${query}` : ''}`,
  )
}

export interface ResultCaseDetailOut {
  id: number
  test_case_id: number
  test_collection_id: number
  test_collection_name: string
  results: SearchHit[]
  snapshot: {
    content: string
    language: string
    source: string | null
    context: string | null
    tags: string[]
    targets: { target: string; relevance: number }[]
  }
  score_stats: ScoreStats | null
  recall_at_k: number
  precision_at_k: number
  reciprocal_rank: number
  ndcg_at_k: number
}

export function getDocument(language: string, docId: string): Promise<SearchHit> {
  return request<SearchHit>(`/eval/test-cases/document/${language}/${encodeURIComponent(docId)}`)
}

export function getResultCaseDetail(
  resultCollectionId: number,
  caseId: number,
  options: { k?: number; tau?: number } = {},
): Promise<ResultCaseDetailOut> {
  const params = new URLSearchParams()
  if (options.k !== undefined) params.set('k', String(options.k))
  if (options.tau !== undefined) params.set('tau', String(options.tau))
  const query = params.toString()
  return request<ResultCaseDetailOut>(
    `/eval/result-collections/${resultCollectionId}/cases/${caseId}${query ? `?${query}` : ''}`,
  )
}

export interface MetricSweepPointOut {
  k: number
  recall_at_k: number
  precision_at_k: number
  ndcg_at_k: number
}

export interface MetricSweepOut {
  tau: number
  mrr: number
  points: MetricSweepPointOut[]
}

export function getMetricSweep(
  resultCollectionId: number,
  options: { tau?: number } = {},
): Promise<MetricSweepOut> {
  const params = new URLSearchParams()
  if (options.tau !== undefined) params.set('tau', String(options.tau))
  const query = params.toString()
  return request<MetricSweepOut>(
    `/eval/result-collections/${resultCollectionId}/metric-sweep${query ? `?${query}` : ''}`,
  )
}

export interface MetricComparisonOut {
  baseline: number
  candidate: number
  delta: number
  wilcoxon_statistic: number | null
  wilcoxon_p_value: number | null
  n: number
}

export interface McNemarOut {
  n_baseline_only: number
  n_candidate_only: number
  statistic: number
  p_value: number
}

export interface CaseMetricValuesOut {
  recall_at_k: number
  precision_at_k: number
  reciprocal_rank: number
  ndcg_at_k: number
}

export interface CaseComparisonOut {
  test_case_id: number
  content: string
  baseline: CaseMetricValuesOut
  candidate: CaseMetricValuesOut
}

export interface RunComparisonOut {
  candidate_id: number
  candidate_configuration_name: string
  overlap_case_count: number
  recall_at_k: MetricComparisonOut
  precision_at_k: MetricComparisonOut
  reciprocal_rank: MetricComparisonOut
  ndcg_at_k: MetricComparisonOut
  found_at_k: McNemarOut
  cases: CaseComparisonOut[]
}

export interface ComparisonOut {
  baseline_id: number
  baseline_configuration_name: string
  test_collection_id: number
  test_collection_name: string
  k: number
  tau: number
  comparisons: RunComparisonOut[]
}

export function getComparison(
  baselineId: number,
  candidateIds: number[],
  options: { k?: number; tau?: number } = {},
): Promise<ComparisonOut> {
  const params = new URLSearchParams()
  for (const candidateId of candidateIds) {
    params.append('candidate_id', String(candidateId))
  }
  if (options.k !== undefined) params.set('k', String(options.k))
  if (options.tau !== undefined) params.set('tau', String(options.tau))
  return request<ComparisonOut>(
    `/eval/result-collections/${baselineId}/compare?${params.toString()}`,
  )
}
