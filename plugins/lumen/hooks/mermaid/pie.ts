// Pie charts: a circle drawn in half-block cells (two square pixels a cell),
// each slice its own color, largest first clockwise from the top, with a
// legend beside or below; or one bar per slice when there is no room or color.

import type { DiagramContext, DiagramResult, Line, Renderer } from './types'
import { seriesColors } from './types'
import { Canvas, type Style, ellipsis, fmtNum, hbar, num, sourceLines, unquote, widest, wrapText } from './chart-util'
import { width } from '../width'

type Slice = { label: string; value: number }
type Pie = { title: string | undefined; showData: boolean; slices: Slice[] }

const parse = (source: string): Pie => {
  const lines = sourceLines(source)
  const head = lines.shift() ?? ''
  const hm = /^pie\b\s*(.*)$/.exec(head)
  if (hm === null) throw new Error('not a pie')
  const pie: Pie = { title: undefined, showData: false, slices: [] }
  const header = (rest: string) => {
    let r = rest.trim()
    if (/^showData\b/.test(r)) {
      pie.showData = true
      r = r.replace(/^showData\b\s*/, '')
    }
    const tm = /^title\s+(.+)$/.exec(r)
    if (tm !== null) pie.title = unquote(tm[1] ?? '')
    else if (r !== '') return false
    return true
  }
  if (!header(hm[1] ?? '')) throw new Error(`cannot read "${head}"`)
  for (const line of lines) {
    if (header(line)) continue
    const m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(\S+)$/.exec(line)
    if (m === null) throw new Error(`cannot read "${line}"`)
    const value = num(m[2] ?? '')
    if (value === undefined || value < 0) throw new Error(`"${m[2]}" is not a number`)
    pie.slices.push({ label: unquote(m[1] ?? ''), value })
  }
  if (pie.slices.length === 0) throw new Error('no slices')
  if (!(pie.slices.reduce((n, s) => n + s.value, 0) > 0)) throw new Error('the slices add up to nothing')
  return pie
}

const share = (v: number, total: number): string => {
  const p = (v / total) * 100
  return `${p.toFixed(1)}%`
}

type Entry = { slice: Slice; color: string | undefined; pct: string }

const titleLines = (ctx: DiagramContext, pie: Pie): Line[] =>
  pie.title === undefined
    ? []
    : [...wrapText(pie.title, ctx.width).map(l => [{ text: l, bold: true, ...(ctx.theme.heading === undefined ? {} : { color: ctx.theme.heading }) }]), []]

const bars = (ctx: DiagramContext, pie: Pie, entries: Entry[]): DiagramResult => {
  const t = ctx.theme
  const textStyle: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const numStyle: Style = t.number === undefined ? {} : { color: t.number }
  const pctW = widest(entries.map(e => e.pct))
  const dataW = pie.showData ? widest(entries.map(e => fmtNum(e.slice.value))) + 4 : 0
  const labelW = Math.min(widest(entries.map(e => e.slice.label)), Math.max(6, Math.floor(ctx.width * 0.35)))
  const barW = ctx.width - labelW - 2 - 1 - pctW - dataW
  if (barW < 4) return { error: 'too narrow' }
  const max = Math.max(...entries.map(e => e.slice.value))
  const lines: Line[] = titleLines(ctx, pie)
  entries.forEach((e, i) => {
    const bar = hbar((e.slice.value / max) * barW) || (e.slice.value > 0 ? '▏' : '')
    const style: Style = e.color === undefined ? (i === 0 ? { bold: true } : {}) : { color: e.color }
    const label = ellipsis(e.slice.label, labelW)
    const line: Line = [{ ...textStyle, text: label + ' '.repeat(labelW - width(label) + 2) }]
    line.push({ ...style, text: bar })
    line.push({ text: ' '.repeat(barW - width(bar) + 1) })
    line.push({ ...numStyle, text: e.pct.padStart(pctW) })
    if (pie.showData) line.push({ text: '  ' }, { ...numStyle, dim: true, text: `(${fmtNum(e.slice.value)})` })
    lines.push(line)
  })
  return { lines }
}

const round = (ctx: DiagramContext, pie: Pie, entries: Entry[], total: number): DiagramResult | undefined => {
  const t = ctx.theme
  const textStyle: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const numStyle: Style = t.number === undefined ? {} : { color: t.number }
  // The legend: a swatch, the label, the share and maybe the value.
  const pctW = widest(entries.map(e => e.pct))
  const dataW = pie.showData ? widest(entries.map(e => fmtNum(e.slice.value))) + 4 : 0
  const fullLabel = widest(entries.map(e => e.slice.label))
  const legendW = (labelW: number) => 2 + labelW + 2 + pctW + dataW

  // Radius in cells: R rows tall, 2R columns wide.
  let R = ctx.width >= 90 ? 11 : ctx.width >= 60 ? 9 : 8
  R = Math.max(R, Math.ceil(entries.length / 2) + 1)
  R = Math.min(R, 12)
  const diam = 2 * R
  let beside = true
  let labelW = Math.min(fullLabel, ctx.width - diam - 3 - legendW(0))
  if (labelW < Math.min(fullLabel, 8)) {
    beside = false
    labelW = Math.min(fullLabel, ctx.width - legendW(0))
  }
  if (labelW < Math.min(fullLabel, 4) || diam > ctx.width) return undefined

  // Slice boundaries as fractions of a turn, clockwise from 12 o'clock.
  const ends: number[] = []
  let acc = 0
  for (const e of entries) {
    acc += e.slice.value / total
    ends.push(acc)
  }
  const sliceAt = (px: number, py: number): number | undefined => {
    // Pixel centers on a 2R x 2R grid of square pixels.
    const x = px + 0.5 - R
    const y = py + 0.5 - R
    if (x * x + y * y > R * R) return undefined
    let a = Math.atan2(x, -y) / (2 * Math.PI)
    if (a < 0) a += 1
    const i = ends.findIndex(e => a < e)
    return i === -1 ? entries.length - 1 : i
  }

  const cv = new Canvas()
  const colorOf = (i: number | undefined) => (i === undefined ? undefined : entries[i]?.color)
  for (let row = 0; row < R; row++) {
    for (let col = 0; col < diam; col++) {
      const top = sliceAt(col, row * 2)
      const bottom = sliceAt(col, row * 2 + 1)
      if (top === undefined && bottom === undefined) continue
      if (top === bottom || bottom === undefined) {
        cv.put(col, row, top === bottom ? '█' : '▀', { color: colorOf(top) })
      } else if (top === undefined) {
        cv.put(col, row, '▄', { color: colorOf(bottom) })
      } else {
        const fg = colorOf(top)
        const bg = colorOf(bottom)
        cv.put(col, row, '▀', bg === undefined ? { color: fg } : { color: fg, bg })
      }
    }
  }

  const legendX = beside ? diam + 3 : 0
  const legendY = beside ? Math.max(0, Math.floor((R - entries.length) / 2)) : R + 1
  entries.forEach((e, i) => {
    const y = legendY + i
    cv.put(legendX, y, '█', { color: e.color })
    const label = ellipsis(e.slice.label, labelW)
    cv.text(legendX + 2, y, label, textStyle)
    let x = legendX + 2 + labelW + 2
    x = cv.text(x + pctW - width(e.pct), y, e.pct, numStyle)
    if (pie.showData) cv.text(x + 2, y, `(${fmtNum(e.slice.value)})`, { ...numStyle, dim: true })
  })
  const body = cv.lines().map(l => l.map(r => (r.color === undefined ? withoutColor(r) : r)))
  return { lines: [...titleLines(ctx, pie), ...body] }
}

const withoutColor = <T extends { color?: string }>(r: T): T => {
  const { color: _c, ...rest } = r
  return rest as T
}

const render: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  const pie = parse(source)
  const total = pie.slices.reduce((n, s) => n + s.value, 0)
  const colors = ctx.isMono ? [] : seriesColors(ctx.theme)
  const sorted = pie.slices.map((s, i) => ({ s, i })).sort((a, b) => b.s.value - a.s.value || a.i - b.i).map(x => x.s)
  const entries: Entry[] = sorted.map((slice, i) => ({
    slice, color: colors.length === 0 ? undefined : colors[i % colors.length], pct: share(slice.value, total),
  }))
  const canRound = ctx.pieStyle === 'round' && !ctx.isMono && ctx.width >= 40 && sorted.length <= colors.length
  if (canRound) {
    const r = round(ctx, pie, entries, total)
    if (r !== undefined) return r
  }
  return bars(ctx, pie, entries)
}

export const PIE_RENDERERS: Record<string, Renderer> = { pie: render }
