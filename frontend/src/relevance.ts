export const RELEVANCE_LEVELS = [
  { value: 0, label: 'Not relevant' },
  { value: 1, label: 'Marginally relevant' },
  { value: 2, label: 'Relevant' },
  { value: 3, label: 'Highly relevant' },
]

export function relevanceLabel(value: number): string {
  return RELEVANCE_LEVELS.find((level) => level.value === value)?.label ?? String(value)
}
