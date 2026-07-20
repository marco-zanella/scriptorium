import { useRef, useState } from 'react'
import type { ScoreStats, SearchHit } from './api'
import { type Bar, BarsSvg, ExportRow } from '@/components/svg-charts'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export type Mode = 'raw' | 'normalized' | 'standardized'

const MODES: { key: Mode; label: string }[] = [
  { key: 'raw', label: 'Raw' },
  { key: 'normalized', label: 'Normalized' },
  { key: 'standardized', label: 'Standardized' },
]

const STAT_TILES = [
  { key: 'min', label: 'Min' },
  { key: 'avg', label: 'Avg' },
  { key: 'max', label: 'Max' },
  { key: 'std_deviation', label: 'σ' },
  { key: 'count', label: 'n' },
] as const

function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

export function transform(value: number, stats: ScoreStats, mode: Mode): number {
  if (mode === 'raw') return value
  if (mode === 'normalized') {
    const range = stats.max - stats.min
    return range === 0 ? 0 : (value - stats.min) / range
  }
  return stats.std_deviation === 0 ? 0 : (value - stats.avg) / stats.std_deviation
}

export function ScoreDistributionPanel({
  stats,
  results,
  mode: controlledMode,
  onModeChange,
}: {
  stats: ScoreStats
  results: SearchHit[]
  // Uncontrolled by default (own internal state, as used on the search page) —
  // controlled when a caller needs the mode to drive something else too (e.g.
  // the eval case page's ranked-results score column).
  mode?: Mode
  onModeChange?: (mode: Mode) => void
}) {
  const [internalMode, setInternalMode] = useState<Mode>('raw')
  const mode = controlledMode ?? internalMode
  const setMode = onModeChange ?? setInternalMode
  const resultsChartRef = useRef<SVGSVGElement>(null)
  const percentileChartRef = useRef<SVGSVGElement>(null)

  const percentiles = Object.entries(stats.percentiles)
    .map(([key, value]) => ({ percentile: Math.round(Number(key)), value: transform(value, stats, mode) }))
    .sort((a, b) => a.percentile - b.percentile)

  const percentileBars: Bar[] = percentiles.map((p) => ({
    value: p.value,
    tooltip: `${ordinal(p.percentile)} percentile: ${p.value.toFixed(3)}`,
    label: String(p.percentile),
  }))

  const resultBars: Bar[] = results.map((hit) => {
    const value = transform(hit.score, stats, mode)
    return {
      value,
      tooltip: `${hit.book} ${hit.chapter}:${hit.verse} — ${value.toFixed(3)}`,
    }
  })

  const modeLabel = MODES.find((m) => m.key === mode)?.label

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <Button
            key={m.key}
            size="sm"
            variant={mode === m.key ? 'default' : 'outline'}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      <dl className="grid grid-cols-5 gap-1 rounded-md bg-background/60 py-2 text-center">
        {STAT_TILES.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {key === 'count' ? stats.count : stats[key].toFixed(2)}
            </dd>
          </div>
        ))}
      </dl>

      {resultBars.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Results on this page</p>
          <BarsSvg
            svgRef={resultsChartRef}
            bars={resultBars}
            showLabels={false}
            ariaLabel={`Bar chart of ${modeLabel} scores for results on this page`}
          />
          <ExportRow svgRef={resultsChartRef} filenamePrefix={`page-scores-${mode}`} />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Percentile distribution</p>
        <BarsSvg
          svgRef={percentileChartRef}
          bars={percentileBars}
          showLabels
          ariaLabel={`Bar chart of ${modeLabel} score percentiles`}
        />
        <ExportRow svgRef={percentileChartRef} filenamePrefix={`percentile-distribution-${mode}`} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Percentile</TableHead>
            <TableHead className="text-right">{modeLabel} score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {percentiles.map((p) => (
            <TableRow key={p.percentile}>
              <TableCell>{ordinal(p.percentile)}</TableCell>
              <TableCell className="text-right tabular-nums">{p.value.toFixed(4)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
