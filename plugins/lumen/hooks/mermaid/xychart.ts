// xychart-beta: bar and line series on a category or number x axis, drawn
// with eighth blocks so bar heights are precise and braille for lines.
// Vertical by default, `horizontal` turns the bars sideways.

import type { DiagramContext, DiagramResult, Renderer } from './types'
import { seriesColors } from './types'
import {
  Canvas, LEFT_EIGHTHS, type Style, UP_EIGHTHS, ellipsis, fmtCompact, fmtLike, fmtNum, listItems, niceStep, num, sourceLines,
  unquote, widest, wrapText,
} from './chart-util'
import { width } from '../width'

type Series = { kind: 'bar' | 'line'; name: string; values: number[] }

type Chart = {
  horizontal: boolean
  title: string | undefined
  xTitle: string | undefined
  categories: string[] | undefined
  xRange: [number, number] | undefined
  yTitle: string | undefined
  yRange: [number, number] | undefined
  series: Series[]
}

const RANGE = /^(.*?)\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*-->\s*(-?[\d.]+(?:e[+-]?\d+)?)$/i

const parse = (source: string): Chart => {
  const lines = sourceLines(source)
  const head = lines.shift() ?? ''
  const hm = /^xychart(?:-beta)?\b\s*(.*)$/.exec(head)
  if (hm === null) throw new Error('not an xychart')
  const chart: Chart = {
    horizontal: /\bhorizontal\b/.test(hm[1] ?? ''),
    title: undefined, xTitle: undefined, categories: undefined, xRange: undefined,
    yTitle: undefined, yRange: undefined, series: [],
  }
  for (const line of lines) {
    let m: RegExpExecArray | null
    if (/^(horizontal|vertical)$/.test(line)) {
      chart.horizontal = line === 'horizontal'
      continue
    }
    if ((m = /^title\s+(.+)$/.exec(line))) {
      chart.title = unquote(m[1] ?? '')
      continue
    }
    if ((m = /^([xy])-axis\b\s*(.*)$/.exec(line))) {
      const isX = m[1] === 'x'
      let rest = (m[2] ?? '').trim()
      let title: string | undefined
      const br = rest.indexOf('[')
      if (isX && br !== -1 && rest.endsWith(']')) {
        chart.categories = listItems(rest.slice(br + 1, -1))
        rest = rest.slice(0, br).trim()
        title = rest === '' ? undefined : unquote(rest)
      } else {
        const r = RANGE.exec(rest)
        if (r !== null) {
          const lo = num(r[2] ?? '')
          const hi = num(r[3] ?? '')
          if (lo === undefined || hi === undefined || hi <= lo) throw new Error(`bad range in "${line}"`)
          if (isX) chart.xRange = [lo, hi]
          else chart.yRange = [lo, hi]
          rest = (r[1] ?? '').trim()
        }
        title = rest === '' ? undefined : unquote(rest)
      }
      if (isX) chart.xTitle = title
      else chart.yTitle = title
      continue
    }
    if ((m = /^(bar|line)\b\s*(.*?)\s*\[(.*)\]$/.exec(line))) {
      const values = listItems(m[3] ?? '').map(v => {
        const n = num(v)
        if (n === undefined) throw new Error(`"${v}" is not a number`)
        return n
      })
      if (values.length === 0) throw new Error('a series without values')
      const kind = m[1] === 'bar' ? 'bar' : 'line'
      const name = unquote(m[2] ?? '')
      chart.series.push({ kind, name: name === '' ? `${kind} ${chart.series.filter(s => s.kind === kind).length + 1}` : name, values })
      continue
    }
    throw new Error(`cannot read "${line}"`)
  }
  if (chart.series.length === 0) throw new Error('no bar or line series')
  return chart
}

type Scale = { lo: number; hi: number; ticks: number[]; cells: number }

/** The value axis: a round range and its ticks, over `target` cells or so. */
const scaleOf = (chart: Chart, target: number): Scale => {
  const all = chart.series.flatMap(s => s.values)
  if (chart.yRange !== undefined) {
    const [lo, hi] = chart.yRange
    const step = niceStep(hi - lo, 5)
    const ticks: number[] = []
    for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(Math.round(t / step) * step)
    if (ticks[0] !== lo) ticks.unshift(lo)
    if (ticks[ticks.length - 1] !== hi) ticks.push(hi)
    return { lo, hi, ticks, cells: target }
  }
  let lo = Math.min(0, ...all)
  let hi = Math.max(0, ...all)
  if (hi === lo) hi = lo + 1
  const step = niceStep(hi - lo, 5)
  lo = Math.floor(lo / step + 1e-9) * step
  hi = Math.ceil(hi / step - 1e-9) * step
  const k = Math.round((hi - lo) / step)
  const per = Math.max(1, Math.round(target / k))
  const ticks: number[] = []
  for (let i = 0; i <= k; i++) ticks.push(Math.round((lo + i * step) / step) * step)
  return { lo, hi, ticks, cells: k * per }
}

const fmtTicks = (ticks: readonly number[]): string[] => {
  const plain = ticks.map(fmtNum)
  return widest(plain) > 6 ? ticks.map(fmtCompact) : plain
}

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

/** Braille dots for line series: a cell per 2 x 4 dots. */
class Dots {
  cells = new Map<string, { bits: number; color: string | undefined; x: number; y: number }>()

  /** A dot at sub-cell (sx, sy), sy counted down from the top. */
  dot(sx: number, sy: number, color: string | undefined) {
    const x = Math.floor(sx / 2)
    const y = Math.floor(sy / 4)
    const bit = BRAILLE_BITS[sy - y * 4]?.[sx - x * 2] ?? 0
    const key = `${x}:${y}`
    const c = this.cells.get(key)
    if (c === undefined) this.cells.set(key, { bits: bit, color, x, y })
    else {
      c.bits |= bit
      c.color = color
    }
  }

  segment(x0: number, y0: number, x1: number, y1: number, color: string | undefined) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= steps; i++) {
      this.dot(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), color)
    }
  }

  paint(cv: Canvas, ox: number, oy: number, bold: boolean) {
    for (const c of this.cells.values()) {
      const st: Style = c.color === undefined ? (bold ? { bold: true } : {}) : { color: c.color }
      cv.put(ox + c.x, oy + c.y, String.fromCharCode(0x2800 + c.bits), st)
    }
  }
}

const vertical = (ctx: DiagramContext, chart: Chart): DiagramResult => {
  const t = ctx.theme
  const colors = ctx.isMono ? [] : seriesColors(t)
  const n = Math.max(...chart.series.map(s => s.values.length))
  const cats = categoriesOf(chart, n)
  const bars = chart.series.filter(s => s.kind === 'bar')
  const linesS = chart.series.filter(s => s.kind === 'line')
  const single = bars.length === 1
  const sc = scaleOf(chart, ctx.width < 70 ? 9 : 11)
  const H = sc.cells
  const tickText = fmtTicks(sc.ticks)
  const gutter = widest(tickText) + 1
  const plotW = ctx.width - gutter - 2
  const slot = Math.min(14, Math.floor(plotW / n))
  if (slot < Math.max(1, bars.length)) return { error: 'too many points for the width' }
  const bw = bars.length === 0 ? 0 : Math.max(1, Math.min(8, Math.floor((slot - 1) / bars.length)))
  const groupW = bw * bars.length
  const x0 = gutter + 1
  const level8 = (v: number) => ((Math.min(sc.hi, Math.max(sc.lo, v)) - sc.lo) / (sc.hi - sc.lo)) * H * 8
  const zero = Math.round(level8(0) / 8)

  const cv = new Canvas()
  let y = 0
  const titleStyle: Style = { bold: true, ...(t.heading === undefined ? {} : { color: t.heading }) }
  const textStyle: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const axisStyle: Style = t.diagram === undefined ? { dim: true } : { color: t.diagram }
  const ruleStyle: Style = t.rule === undefined ? { dim: true } : { color: t.rule, dim: true }
  const numStyle: Style = t.number === undefined ? {} : { color: t.number }
  if (chart.title !== undefined) {
    for (const l of wrapText(chart.title, ctx.width)) cv.text(0, y++, l, titleStyle)
    y++
  }
  if (chart.yTitle !== undefined) cv.text(0, y++, ellipsis(chart.yTitle, ctx.width), { ...textStyle, dim: true })
  const top = y // row of level H
  const rowOf = (level: number) => top + H - level
  const plotRight = x0 + slot * n

  // Bars.
  const colorFor = (i: number) => colors[i % Math.max(1, colors.length)]
  const tallest = single ? Math.max(...(bars[0] as Series).values) : NaN
  const ref = Math.max(...chart.series.flatMap(s => s.values.map(Math.abs)))
  const valueLabels: [number, number, string, Style][] = []
  const shades = ['█', '▓', '▒', '░']
  bars.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const left = x0 + i * slot + Math.floor((slot - groupW) / 2) + si * bw
      const isTop = single && v === tallest
      const color = single ? (isTop ? colors[0] : (colors[1] ?? colors[0])) : colorFor(si)
      const st: Style = color === undefined ? (isTop ? { bold: true } : {}) : { color }
      // In mono, series past the first fill with shades and round their tops.
      const shade = ctx.isMono && !single && si > 0 ? (shades[si % shades.length] ?? '█') : undefined
      const v8 = shade === undefined ? Math.round(level8(v)) : Math.round(level8(v) / 8) * 8
      const z8 = zero * 8
      for (let x = left; x < left + bw; x++) {
        if (v8 >= z8) {
          for (let l = zero; l * 8 < v8; l++) {
            const amount = Math.min(8, v8 - l * 8)
            cv.put(x, rowOf(l), amount === 8 && shade !== undefined ? shade : (UP_EIGHTHS[amount] ?? '█'), st)
          }
        } else {
          for (let l = zero - 1; (l + 1) * 8 > v8; l--) {
            const amount = Math.min(8, (l + 1) * 8 - v8)
            cv.put(x, rowOf(l), amount >= 6 ? '█' : amount >= 2 ? '▀' : '▔', st)
          }
        }
      }
      if (single) {
        const label = fmtLike(v, ref)
        if (width(label) <= Math.max(bw, slot - 1)) {
          // Above a bar, or under one that hangs below zero when there is room.
          const below = Math.floor(v8 / 8) - 1
          const level = v8 >= z8 ? Math.min(H, Math.ceil(v8 / 8)) : below >= 0 ? below : zero
          const lx = x0 + i * slot + Math.floor((slot - width(label)) / 2)
          valueLabels.push([lx, rowOf(level), label, isTop ? { ...numStyle, bold: true } : numStyle])
        }
      }
    })
  })

  // Lines in braille, a dot row per quarter cell.
  const dots = new Dots()
  linesS.forEach((s, li) => {
    const color = colorFor(bars.length === 1 ? li + 2 : bars.length + li)
    let prev: [number, number] | undefined
    s.values.forEach((v, i) => {
      const sx = i * slot * 2 + slot
      const sub = Math.min(H * 4 + 3, Math.floor((level8(v) / 8) * 4))
      const sy = (H + 1) * 4 - 1 - sub
      if (prev !== undefined) dots.segment(prev[0], prev[1], sx, sy, color)
      else dots.dot(sx, sy, color)
      prev = [sx, sy]
    })
  })
  dots.paint(cv, x0, top, true)
  for (const [lx, ly, label, st] of valueLabels) cv.text(lx, ly, label, st)

  // Axis, ticks and dim gridlines under everything.
  sc.ticks.forEach((tv, i) => {
    const level = Math.round(level8(tv) / 8)
    const label = tickText[i] ?? ''
    const row = i === 0 ? rowOf(0) + 1 : rowOf(level)
    cv.text(gutter - 1 - width(label), row, label, numStyle)
    if (i > 0) {
      cv.put(gutter, row, '┤', axisStyle)
      cv.under(x0, row, '┈'.repeat(plotRight - x0), ruleStyle)
    }
  })
  for (let l = 0; l <= H; l++) if (cv.isBlank(gutter, rowOf(l))) cv.put(gutter, rowOf(l), '│', axisStyle)
  const axisRow = rowOf(0) + 1
  cv.put(gutter, axisRow, '└', axisStyle)
  cv.text(x0, axisRow, '─'.repeat(plotRight - x0), axisStyle)
  y = axisRow + 1

  // Category labels: one row if they fit their slots, two staggered rows, or cut.
  const catW = widest(cats)
  const stagger = catW > slot - 1 && catW <= slot * 2 - 1
  const room = stagger ? slot * 2 - 1 : Math.max(1, slot - 1)
  cats.forEach((c, i) => {
    const label = ellipsis(c, room)
    const row = stagger && i % 2 === 1 ? y + 1 : y
    if (stagger && i % 2 === 1) cv.put(x0 + i * slot + Math.floor(slot / 2), y, '╵', ruleStyle)
    cv.text(Math.max(0, x0 + i * slot + Math.floor((slot - width(label)) / 2)), row, label, textStyle)
  })
  y += stagger ? 2 : 1
  if (chart.xTitle !== undefined) {
    const label = ellipsis(chart.xTitle, ctx.width)
    cv.text(Math.max(0, x0 + Math.floor((plotRight - x0 - width(label)) / 2)), y++, label, { ...textStyle, dim: true })
  }
  if (chart.series.length > 1) y = legend(cv, y + 1, ctx, chart, bars.length, colorFor)
  return { lines: cv.lines() }
}

const categoriesOf = (chart: Chart, n: number): string[] => {
  if (chart.categories !== undefined && chart.categories.length > 0) {
    return Array.from({ length: n }, (_, i) => chart.categories?.[i] ?? '')
  }
  if (chart.xRange !== undefined) {
    const [lo, hi] = chart.xRange
    return Array.from({ length: n }, (_, i) => fmtCompact(n === 1 ? lo : lo + ((hi - lo) * i) / (n - 1)))
  }
  return Array.from({ length: n }, (_, i) => String(i + 1))
}

const legend = (
  cv: Canvas, y: number, ctx: DiagramContext, chart: Chart, barCount: number, colorFor: (i: number) => string | undefined,
): number => {
  const textStyle: Style = ctx.theme.diagramText === undefined ? {} : { color: ctx.theme.diagramText }
  let x = 0
  let row = y
  let li = 0
  let bi = 0
  const monoBar = ['█', '▓', '▒', '░']
  for (const s of chart.series) {
    const isBar = s.kind === 'bar'
    const color = isBar ? colorFor(bi) : colorFor(barCount === 1 ? li + 2 : barCount + li)
    const mark = isBar ? (ctx.isMono ? (monoBar[bi % 4] ?? '█') : '█') : '⠒⠒'
    if (isBar) bi++
    else li++
    const name = ellipsis(s.name, Math.max(4, ctx.width - 4))
    const w = width(mark) + 1 + width(name)
    if (x > 0 && x + w > ctx.width) {
      row++
      x = 0
    }
    cv.text(x, row, mark, color === undefined ? { bold: true } : { color })
    cv.text(x + width(mark) + 1, row, name, textStyle)
    x += w + 3
  }
  return row + 1
}

const horizontal = (ctx: DiagramContext, chart: Chart): DiagramResult => {
  const t = ctx.theme
  const colors = ctx.isMono ? [] : seriesColors(t)
  const n = Math.max(...chart.series.map(s => s.values.length))
  const cats = categoriesOf(chart, n)
  const bars = chart.series.filter(s => s.kind === 'bar')
  const linesS = chart.series.filter(s => s.kind === 'line')
  const single = bars.length === 1
  const colorFor = (i: number) => colors[i % Math.max(1, colors.length)]
  const textStyle: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const axisStyle: Style = t.diagram === undefined ? { dim: true } : { color: t.diagram }
  const ruleStyle: Style = t.rule === undefined ? { dim: true } : { color: t.rule, dim: true }
  const numStyle: Style = t.number === undefined ? {} : { color: t.number }
  const labelW = Math.min(widest(cats), Math.max(4, Math.floor(ctx.width * 0.3)))
  const ref = Math.max(...chart.series.flatMap(s => s.values.map(Math.abs)))
  const valueW = single ? Math.max(...(bars[0] as Series).values.map(v => width(fmtLike(v, ref)))) + 1 : 0
  const plotW = ctx.width - labelW - 2 - valueW - 1
  if (plotW < 10) return { error: 'too narrow' }
  const probe = scaleOf(chart, plotW)
  const tickText = fmtTicks(probe.ticks)
  // Ticks need room for their labels: fewer cells per tick when they crowd.
  const sc: { lo: number; hi: number; ticks: number[] } = probe
  const W = plotW
  const pos8 = (v: number) => ((Math.min(sc.hi, Math.max(sc.lo, v)) - sc.lo) / (sc.hi - sc.lo)) * W * 8
  const zero = Math.round(pos8(0) / 8)
  const x0 = labelW + 2
  const tallest = single ? Math.max(...(bars[0] as Series).values) : NaN
  const per = Math.max(1, bars.length)
  const gap = per > 1 ? 1 : 0

  const cv = new Canvas()
  let y = 0
  if (chart.title !== undefined) {
    for (const l of wrapText(chart.title, ctx.width)) cv.text(0, y++, l, { bold: true, ...(t.heading === undefined ? {} : { color: t.heading }) })
    y++
  }
  if (chart.xTitle !== undefined) cv.text(0, y++, ellipsis(chart.xTitle, ctx.width), { ...textStyle, dim: true })
  const top = y
  for (let i = 0; i < n; i++) {
    const rowBase = top + i * (per + gap)
    cv.text(0, rowBase + Math.floor((per - 1) / 2), ellipsis(cats[i] ?? '', labelW).padStart(labelW), textStyle)
    bars.forEach((s, si) => {
      const v = s.values[i]
      if (v === undefined) return
      const isTop = single && v === tallest
      const color = single ? (isTop ? colors[0] : (colors[1] ?? colors[0])) : colorFor(si)
      const st: Style = color === undefined ? (isTop ? { bold: true } : {}) : { color }
      const v8 = Math.round(pos8(v))
      const row = rowBase + si
      let end = x0 + zero
      if (v8 >= zero * 8) {
        const len = v8 - zero * 8
        const full = Math.floor(len / 8)
        cv.text(x0 + zero, row, '█'.repeat(full), st)
        if (len % 8 > 0) cv.put(x0 + zero + full, row, LEFT_EIGHTHS[len % 8] ?? '█', st)
        end = x0 + zero + Math.ceil(len / 8)
      } else {
        const cells = Math.round((zero * 8 - v8) / 8)
        cv.text(x0 + zero - cells, row, '█'.repeat(cells), st)
      }
      if (single) cv.text(end + 1, row, fmtLike(v, ref), isTop ? { ...numStyle, bold: true } : numStyle)
    })
    linesS.forEach((s, li) => {
      const v = s.values[i]
      if (v === undefined) return
      const color = colorFor(bars.length === 1 ? li + 2 : bars.length + li)
      cv.put(x0 + Math.min(W - 1, Math.floor(pos8(v) / 8)), rowBase + Math.floor((per - 1) / 2), '●', color === undefined ? { bold: true } : { color })
    })
  }
  const bottom = top + n * (per + gap) - gap
  for (let r = top; r < bottom; r++) cv.put(labelW + 1, r, '│', axisStyle)
  cv.put(labelW + 1, bottom, '└', axisStyle)
  cv.text(x0, bottom, '─'.repeat(W + 1), axisStyle)
  let lastEnd = -1
  sc.ticks.forEach((tv, i) => {
    const col = x0 + Math.round(pos8(tv) / 8)
    const label = tickText[i] ?? ''
    if (i > 0) cv.put(col, bottom, '┬', axisStyle)
    for (let r = top; r < bottom; r++) if (i > 0) cv.under(col, r, '┊', ruleStyle)
    const lx = Math.min(ctx.width - width(label), Math.max(0, col - Math.floor(width(label) / 2)))
    if (lx > lastEnd) {
      cv.text(lx, bottom + 1, label, numStyle)
      lastEnd = lx + width(label)
    }
  })
  y = bottom + 2
  if (chart.yTitle !== undefined) {
    const label = ellipsis(chart.yTitle, ctx.width)
    cv.text(Math.max(0, x0 + Math.floor((W - width(label)) / 2)), y++, label, { ...textStyle, dim: true })
  }
  if (chart.series.length > 1) legend(cv, y + 1, ctx, chart, bars.length, colorFor)
  return { lines: cv.lines() }
}

const render: Renderer = (ctx, source) => {
  const chart = parse(source)
  return chart.horizontal ? horizontal(ctx, chart) : vertical(ctx, chart)
}

export const XYCHART_RENDERERS: Record<string, Renderer> = { 'xychart-beta': render, xychart: render }
