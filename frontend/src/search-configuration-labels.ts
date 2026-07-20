import type { CombinationTechnique, CombinerTechnique } from './api'

export const WEIGHT_CATEGORY_FIELDS = [
  { category: 'Language Agnostic', fields: ['text', 'shingle', 'trigram'] },
  { category: 'Language Aware', fields: ['language'] },
  { category: 'Semantics', fields: ['semantic'] },
] as const

export const COMBINER_TECHNIQUES: { value: CombinerTechnique; label: string }[] = [
  { value: 'z_score', label: 'Z-Score normalization' },
  { value: 'min_max', label: 'Min-Max normalization' },
  { value: 'l2', label: 'L2 normalization' },
  { value: 'rrf', label: 'Reciprocal Rank Fusion' },
]

// arithmetic_mean is the only combination z_score's negative values can be
// combined via — geometric/harmonic mean can't handle them — so when z_score is
// selected, no combination picker is shown at all, not just a filtered one.
export const COMBINATION_TECHNIQUES: { value: CombinationTechnique; label: string }[] = [
  { value: 'arithmetic_mean', label: 'Arithmetic mean' },
  { value: 'geometric_mean', label: 'Geometric mean' },
  { value: 'harmonic_mean', label: 'Harmonic mean' },
]

export function combinerTechniqueLabel(technique: CombinerTechnique): string {
  return COMBINER_TECHNIQUES.find((t) => t.value === technique)?.label ?? technique
}

export function combinationTechniqueLabel(combination: CombinationTechnique): string {
  return COMBINATION_TECHNIQUES.find((t) => t.value === combination)?.label ?? combination
}
