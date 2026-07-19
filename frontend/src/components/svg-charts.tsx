import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'

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
  const padding = { top: 12, right: 8, bottom: 20, left: 8 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const barGap = bars.length > 20 ? 1 : 4
  const barWidth = Math.max((plotWidth - barGap * (bars.length - 1)) / bars.length, 1)

  const values = bars.map((b) => b.value)
  const maxValue = Math.max(...values, 0)
  const minValue = Math.min(...values, 0)
  const span = maxValue - minValue || 1
  const zeroY = padding.top + plotHeight * (maxValue / span)

  function barY(value: number) {
    return value >= 0 ? zeroY - (value / span) * plotHeight : zeroY
  }
  function barHeight(value: number) {
    return Math.max(Math.abs(value / span) * plotHeight, 1)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1={padding.left}
        y1={zeroY}
        x2={width - padding.right}
        y2={zeroY}
        className="stroke-border"
        strokeWidth={1}
      />
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
            {showLabels && bar.label && (
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
  const padding = { top: 12, right: 12, bottom: 24, left: 32 }
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
    return padding.top + plotHeight - ((y - yMin) / ySpan) * plotHeight
  }

  const yTicks = [yMin, (yMin + yMax) / 2, yMax]

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
    >
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
        y={height - 4}
        textAnchor="start"
        className="fill-muted-foreground text-[9px]"
      >
        {xMin}
      </text>
      <text
        x={width - padding.right}
        y={height - 4}
        textAnchor="end"
        className="fill-muted-foreground text-[9px]"
      >
        {xMax}
      </text>

      {markerX !== undefined && (
        <g>
          <line
            x1={px(markerX)}
            y1={padding.top}
            x2={px(markerX)}
            y2={padding.top + plotHeight}
            className="stroke-foreground/40"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {markerLabel && (
            <text
              x={px(markerX)}
              y={padding.top - 2}
              textAnchor="middle"
              className="fill-foreground text-[9px]"
            >
              {markerLabel}
            </text>
          )}
        </g>
      )}

      {series.map((line, i) => {
        const colorClassName = line.strokeClassName ?? DEFAULT_LINE_COLORS[i % DEFAULT_LINE_COLORS.length]
        const path = line.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${px(p.x)} ${py(p.y)}`).join(' ')
        return (
          <path
            key={line.key}
            d={path}
            fill="none"
            className={colorClassName}
            strokeWidth={1.75}
            strokeDasharray={line.dashed ? '5 3' : undefined}
          >
            <title>{line.label}</title>
          </path>
        )
      })}
    </svg>
  )
}

export function serializeSvg(svg: SVGSVGElement): Blob {
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

export function exportSvg(svgRef: RefObject<SVGSVGElement | null>, filename: string) {
  const svg = svgRef.current
  if (!svg) return
  downloadBlob(serializeSvg(svg), filename)
}

export function exportPng(
  svgRef: RefObject<SVGSVGElement | null>,
  filename: string,
  dimensions: { width: number; height: number } = { width: 280, height: 160 },
) {
  const svg = svgRef.current
  if (!svg) return
  const svgUrl = URL.createObjectURL(serializeSvg(svg))

  const image = new Image()
  image.onload = () => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width * scale
    canvas.height = dimensions.height * scale
    const ctx = canvas.getContext('2d')
    URL.revokeObjectURL(svgUrl)
    if (!ctx) return
    ctx.scale(scale, scale)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, dimensions.width, dimensions.height)
    ctx.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    canvas.toBlob((blob) => blob && downloadBlob(blob, filename))
  }
  image.src = svgUrl
}

export function ExportRow({
  svgRef,
  filenamePrefix,
  dimensions,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  filenamePrefix: string
  dimensions?: { width: number; height: number }
}) {
  return (
    <div className="flex justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => exportPng(svgRef, `${filenamePrefix}.png`, dimensions)}
      >
        PNG
      </Button>
      <Button variant="outline" size="sm" onClick={() => exportSvg(svgRef, `${filenamePrefix}.svg`)}>
        SVG
      </Button>
    </div>
  )
}
