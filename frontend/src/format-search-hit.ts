import type { SearchHit } from './api'

export function describeHit(hit: SearchHit): string {
  if (hit.book && hit.chapter && hit.verse) {
    return `${hit.book} ${hit.chapter}:${hit.verse}`
  }
  return hit.source ?? hit.id
}
