import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'

// Rough width (px) of one character at the charts' 9px label font — used only
// to decide label density/placement, not for pixel-perfect typesetting.
const CHAR_WIDTH_ESTIMATE = 5.5
const LEGEND_ROW_HEIGHT = 16

export interface Bar {
  value: number
  tooltip: string
  label?: string
}

export function BarsSvg({
  svgRef,
  bars,
  showLabels,
  ariaLabel,
  width = 280,
  height = 160,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  bars: Bar[]
  showLabels: boolean
  ariaLabel: string
  width?: number
  height?: number
}) {
  const padding = { top: 12, right: 8, bottom: 20, left: 28 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const barGap = bars.length > 20 ? 1 : 4
  const barWidth = Math.max((plotWidth - barGap * (bars.length - 1)) / bars.length, 1)

  const values = bars.map((b) => b.value)
  const maxValue = Math.max(...values, 0)
  const minValue = Math.min(...values, 0)
  const span = maxValue - minValue || 1
  const zeroY = padding.top + plotHeight * (maxValue / span)

  function valueY(value: number) {
    return zeroY - (value / span) * plotHeight
  }
  function barY(value: number) {
    return value >= 0 ? valueY(value) : zeroY
  }
  function barHeight(value: number) {
    return Math.max(Math.abs(value / span) * plotHeight, 1)
  }

  const yTicks = [minValue, (minValue + maxValue) / 2, maxValue]

  // Every bar always keeps its hover tooltip, but a label must never be the
  // *only* way to tell bars apart, so labels are also shown directly — thinned
  // out (every Nth) only as far as needed so they don't overlap each other.
  const longestLabel = Math.max(0, ...bars.map((b) => b.label?.length ?? 0))
  const slotWidth = barWidth + barGap
  const labelStep =
    showLabels && longestLabel > 0
      ? Math.max(1, Math.ceil((longestLabel * CHAR_WIDTH_ESTIMATE + 4) / slotWidth))
      : Infinity

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
    >
      {minValue < 0 && (
        <line
          x1={padding.left}
          y1={zeroY}
          x2={width - padding.right}
          y2={zeroY}
          className="stroke-border"
          strokeWidth={1}
        />
      )}
      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            y1={valueY(tick)}
            x2={width - padding.right}
            y2={valueY(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={padding.left - 4}
            y={valueY(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {tick.toFixed(2)}
          </text>
        </g>
      ))}
      {bars.map((bar, i) => {
        const x = padding.left + i * (barWidth + barGap)
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
            {bar.label !== undefined && i % labelStep === 0 && (
              <text
                x={x + barWidth / 2}
                y={height - 6}
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

export interface LineSeries {
  key: string
  label: string
  points: { x: number; y: number }[]
  tooltip?: (point: { x: number; y: number }) => string
  dashed?: boolean
  // Cycles through the shared --chart-1..5 theme tokens by default.
  strokeClassName?: string
}

const DEFAULT_LINE_COLORS = [
  'stroke-chart-1',
  'stroke-chart-2',
  'stroke-chart-3',
  'stroke-chart-4',
  'stroke-chart-5',
]

export function LineSvg({
  svgRef,
  series,
  xDomain,
  yDomain = [0, 1],
  markerX,
  markerLabel,
  ariaLabel,
  width = 420,
  height = 220,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  series: LineSeries[]
  xDomain: [number, number]
  yDomain?: [number, number]
  markerX?: number
  markerLabel?: string
  ariaLabel: string
  width?: number
  height?: number
}) {
  const resolvedSeries = series.map((s, i) => ({
    ...s,
    colorClassName: s.strokeClassName ?? DEFAULT_LINE_COLORS[i % DEFAULT_LINE_COLORS.length],
  }))

  // A legend is the dependable identity channel for 2+ series (never for a
  // lone line — its title already says what it is); up to 4 series also get a
  // direct end-of-line label, since color alone must never be the only way to
  // tell lines apart. Both live inside the SVG itself, not just the page
  // around it, so an exported image stays self-describing.
  const showLegend = resolvedSeries.length > 1
  const showEndLabels = resolvedSeries.length > 1 && resolvedSeries.length <= 4
  const legendOffset = showLegend ? LEGEND_ROW_HEIGHT : 0

  const longestEndLabel = showEndLabels
    ? Math.max(0, ...resolvedSeries.map((s) => s.label.length))
    : 0
  const endLabelWidth = showEndLabels ? longestEndLabel * CHAR_WIDTH_ESTIMATE + 20 : 0

  const padding = { top: 12, right: 12 + endLabelWidth, bottom: 24, left: 32 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const [xMin, xMax] = xDomain
  const [yMin, yMax] = yDomain
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1

  function px(x: number) {
    return padding.left + ((x - xMin) / xSpan) * plotWidth
  }
  function py(y: number) {
    return legendOffset + padding.top + plotHeight - ((y - yMin) / ySpan) * plotHeight
  }

  const yTicks = [yMin, (yMin + yMax) / 2, yMax]

  const legendItems = showLegend
    ? (() => {
        const widths = resolvedSeries.map((s) => 16 + s.label.length * CHAR_WIDTH_ESTIMATE)
        const gap = 14
        const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (resolvedSeries.length - 1)
        let cursor = Math.max(padding.left, (width - totalWidth) / 2)
        return resolvedSeries.map((s, i) => {
          const x = cursor
          cursor += widths[i] + gap
          return { key: s.key, label: s.label, colorClassName: s.colorClassName, x }
        })
      })()
    : []

  const endLabelItems = showEndLabels
    ? (() => {
        const items = resolvedSeries
          .filter((s) => s.points.length > 0)
          .map((s) => ({
            key: s.key,
            label: s.label,
            colorClassName: s.colorClassName,
            y: py(s.points[s.points.length - 1].y),
          }))
          .sort((a, b) => a.y - b.y)
        const minGap = 11
        for (let i = 1; i < items.length; i++) {
          if (items[i].y - items[i - 1].y < minGap) {
            items[i] = { ...items[i], y: items[i - 1].y + minGap }
          }
        }
        return items
      })()
    : []

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height + legendOffset}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
    >
      {legendItems.map((item) => (
        <g key={item.key}>
          <line
            x1={item.x}
            y1={LEGEND_ROW_HEIGHT / 2}
            x2={item.x + 12}
            y2={LEGEND_ROW_HEIGHT / 2}
            className={item.colorClassName}
            strokeWidth={2}
          />
          <text
            x={item.x + 16}
            y={LEGEND_ROW_HEIGHT / 2}
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {item.label}
          </text>
        </g>
      ))}

      {yTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            y1={py(tick)}
            x2={width - padding.right}
            y2={py(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={padding.left - 4}
            y={py(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {tick.toFixed(1)}
          </text>
        </g>
      ))}
      <text
        x={padding.left}
        y={legendOffset + height - 4}
        textAnchor="start"
        className="fill-muted-foreground text-[9px]"
      >
        {xMin}
      </text>
      <text
        x={width - padding.right}
        y={legendOffset + height - 4}
        textAnchor="end"
        className="fill-muted-foreground text-[9px]"
      >
        {xMax}
      </text>

      {markerX !== undefined && (
        <g>
          <line
            x1={px(markerX)}
            y1={legendOffset + padding.top}
            x2={px(markerX)}
            y2={legendOffset + padding.top + plotHeight}
            className="stroke-foreground/40"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {markerLabel && (
            <text
              x={px(markerX)}
              y={legendOffset + padding.top - 2}
              textAnchor="middle"
              className="fill-foreground text-[9px]"
            >
              {markerLabel}
            </text>
          )}
        </g>
      )}

      {resolvedSeries.map((line) => {
        const path = line.points
          .map((p, j) => `${j === 0 ? 'M' : 'L'} ${px(p.x)} ${py(p.y)}`)
          .join(' ')
        return (
          <path
            key={line.key}
            d={path}
            fill="none"
            className={line.colorClassName}
            strokeWidth={1.75}
            strokeDasharray={line.dashed ? '5 3' : undefined}
          >
            <title>{line.label}</title>
          </path>
        )
      })}

      {endLabelItems.map((item) => (
        <g key={item.key}>
          <line
            x1={px(xMax) + 3}
            y1={item.y}
            x2={px(xMax) + 13}
            y2={item.y}
            className={item.colorClassName}
            strokeWidth={2}
          />
          <text
            x={px(xMax) + 17}
            y={item.y}
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {item.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

// Every color in these charts comes from a Tailwind utility class, resolved
// against the page's stylesheet — so a plain XMLSerializer dump only carries
// styling for as long as the markup stays attached to that page. Exported
// files (a downloaded .svg opened on its own, or a canvas rasterizing a
// detached Image for PNG) have no stylesheet at all, so every class-only
// color would silently vanish. Baking each element's *computed* fill/stroke
// in as literal attributes first makes the exported file self-contained.
const INLINE_STYLE_PROPS = ['fill', 'stroke', 'font-family', 'font-size'] as const

function inlineComputedStyles(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const originals: Element[] = [svg, ...Array.from(svg.querySelectorAll('*'))]
  const clones: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))]
  originals.forEach((original, i) => {
    const target = clones[i]
    const computed = getComputedStyle(original)
    for (const prop of INLINE_STYLE_PROPS) {
      const value = computed.getPropertyValue(prop)
      if (value) target.setAttribute(prop, value)
    }
  })
  return clone
}

export function serializeSvg(svg: SVGSVGElement): Blob {
  const svgData = new XMLSerializer().serializeToString(inlineComputedStyles(svg))
  return new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export interface CsvData {
  headers: string[]
  rows: (string | number)[][]
}

function toCsv({ headers, rows }: CsvData): string {
  function escape(value: string | number): string {
    const s = String(value)
    return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
}

export function exportCsv(data: CsvData, filename: string) {
  downloadBlob(new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }), filename)
}

export function exportSvg(svgRef: RefObject<SVGSVGElement | null>, filename: string) {
  const svg = svgRef.current
  if (!svg) return
  downloadBlob(serializeSvg(svg), filename)
}

export function exportPng(svgRef: RefObject<SVGSVGElement | null>, filename: string) {
  const svg = svgRef.current
  if (!svg) return
  // Read the real rendered size off the SVG's own viewBox instead of asking
  // the caller to pass matching dimensions — a chart can grow (e.g. a legend
  // row) without every export call site having to track that by hand.
  const { width, height } = svg.viewBox.baseVal
  const svgUrl = URL.createObjectURL(serializeSvg(svg))

  const image = new Image()
  image.onload = () => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    URL.revokeObjectURL(svgUrl)
    if (!ctx) return
    ctx.scale(scale, scale)
    const surface = getComputedStyle(document.body).backgroundColor
    ctx.fillStyle = surface && surface !== 'rgba(0, 0, 0, 0)' ? surface : '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    canvas.toBlob((blob) => blob && downloadBlob(blob, filename))
  }
  image.src = svgUrl
}

export function ExportRow({
  svgRef,
  filenamePrefix,
  csv,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  filenamePrefix: string
  csv?: CsvData
}) {
  return (
    <div className="flex justify-center gap-2">
      <Button variant="outline" size="sm" onClick={() => exportPng(svgRef, `${filenamePrefix}.png`)}>
        PNG
      </Button>
      <Button variant="outline" size="sm" onClick={() => exportSvg(svgRef, `${filenamePrefix}.svg`)}>
        SVG
      </Button>
      {csv && (
        <Button variant="outline" size="sm" onClick={() => exportCsv(csv, `${filenamePrefix}.csv`)}>
          CSV
        </Button>
      )}
    </div>
  )
}
