import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ScoreStats, SearchHit } from './api'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const CHART_WIDTH = 280
const CHART_HEIGHT = 160
const PADDING = { top: 12, right: 8, bottom: 20, left: 8 }

type Mode = 'raw' | 'normalized' | 'standardized'

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

function transform(value: number, stats: ScoreStats, mode: Mode): number {
  if (mode === 'raw') return value
  if (mode === 'normalized') {
    const range = stats.max - stats.min
    return range === 0 ? 0 : (value - stats.min) / range
  }
  return stats.std_deviation === 0 ? 0 : (value - stats.avg) / stats.std_deviation
}

interface Bar {
  value: number
  tooltip: string
  label?: string
}

function BarsSvg({
  svgRef,
  bars,
  showLabels,
  ariaLabel,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  bars: Bar[]
  showLabels: boolean
  ariaLabel: string
}) {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom
  const barGap = bars.length > 20 ? 1 : 4
  const barWidth = Math.max((plotWidth - barGap * (bars.length - 1)) / bars.length, 1)

  const values = bars.map((b) => b.value)
  const maxValue = Math.max(...values, 0)
  const minValue = Math.min(...values, 0)
  const span = maxValue - minValue || 1
  const zeroY = PADDING.top + plotHeight * (maxValue / span)

  function barY(value: number) {
    return value >= 0 ? zeroY - (value / span) * plotHeight : zeroY
  }
  function barHeight(value: number) {
    return Math.max(Math.abs(value / span) * plotHeight, 1)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1={PADDING.left}
        y1={zeroY}
        x2={CHART_WIDTH - PADDING.right}
        y2={zeroY}
        className="stroke-border"
        strokeWidth={1}
      />
      {bars.map((bar, i) => {
        const x = PADDING.left + i * (barWidth + barGap)
        return (
          <g key={i}>
            <rect
              x={x}
              y={barY(bar.value)}
              width={barWidth}
              height={barHeight(bar.value)}
              rx={Math.min(2, barWidth / 2)}
              className="fill-primary"
            >
              <title>{bar.tooltip}</title>
            </rect>
            {showLabels && bar.label && (
              <text
                x={x + barWidth / 2}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {bar.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function serializeSvg(svg: SVGSVGElement): Blob {
  const svgData = new XMLSerializer().serializeToString(svg)
  return new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function exportSvg(svgRef: RefObject<SVGSVGElement | null>, filename: string) {
  const svg = svgRef.current
  if (!svg) return
  downloadBlob(serializeSvg(svg), filename)
}

function exportPng(svgRef: RefObject<SVGSVGElement | null>, filename: string) {
  const svg = svgRef.current
  if (!svg) return
  const svgUrl = URL.createObjectURL(serializeSvg(svg))

  const image = new Image()
  image.onload = () => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = CHART_WIDTH * scale
    canvas.height = CHART_HEIGHT * scale
    const ctx = canvas.getContext('2d')
    URL.revokeObjectURL(svgUrl)
    if (!ctx) return
    ctx.scale(scale, scale)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, CHART_WIDTH, CHART_HEIGHT)
    ctx.drawImage(image, 0, 0, CHART_WIDTH, CHART_HEIGHT)
    canvas.toBlob((blob) => blob && downloadBlob(blob, filename))
  }
  image.src = svgUrl
}

function ExportRow({ svgRef, filenamePrefix }: { svgRef: RefObject<SVGSVGElement | null>; filenamePrefix: string }) {
  return (
    <div className="flex justify-center gap-2">
      <Button variant="outline" size="sm" onClick={() => exportPng(svgRef, `${filenamePrefix}.png`)}>
        PNG
      </Button>
      <Button variant="outline" size="sm" onClick={() => exportSvg(svgRef, `${filenamePrefix}.svg`)}>
        SVG
      </Button>
    </div>
  )
}

export function ScoreDistributionPanel({ stats, results }: { stats: ScoreStats; results: SearchHit[] }) {
  const [mode, setMode] = useState<Mode>('raw')
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
