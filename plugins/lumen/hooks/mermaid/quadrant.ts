// Quadrant charts: a framed grid split in four, the quadrant names in their
// corners, numbered points (moved apart within their own quadrant when they
// land on one cell) and a numbered legend under the grid.

import type { DiagramContext, DiagramResult, Renderer } from './types'
import { seriesColors } from './types'
import { Canvas, type Style, ellipsis, fmtNum, sourceLines, unquote, widest, wrapText } from './chart-util'
import { width } from '../width'

type Point = { name: string; x: number; y: number }

type Quadrant = {
  title: string | undefined
  x: [string, string]
  y: [string, string]
  names: [string, string, string, string]
  points: Point[]
}

const axis = (rest: string): [string, string] => {
  const [lo = '', hi = ''] = rest.split('-->').map(s => unquote(s))
  return [lo, hi]
}

const parse = (source: string): Quadrant => {
  const lines = sourceLines(source)
  const head = lines.shift() ?? ''
  if (!/^quadrantChart\b/.test(head)) throw new Error('not a quadrant chart')
  const q: Quadrant = { title: undefined, x: ['', ''], y: ['', ''], names: ['', '', '', ''], points: [] }
  for (const line of lines) {
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(line))) q.title = unquote(m[1] ?? '')
    else if ((m = /^x-axis\s+(.+)$/.exec(line))) q.x = axis(m[1] ?? '')
    else if ((m = /^y-axis\s+(.+)$/.exec(line))) q.y = axis(m[1] ?? '')
    else if ((m = /^quadrant-([1-4])\s+(.+)$/.exec(line))) q.names[Number(m[1]) - 1] = unquote(m[2] ?? '')
    else if (/^classDef\b/.test(line)) continue
    else if ((m = /^(.+?)(?::::\w+)?\s*:\s*\[\s*([^,\]]+)\s*,\s*([^\]]+?)\s*\](.*)$/.exec(line))) {
      const x = Number(m[2])
      const y = Number(m[3])
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad point in "${line}"`)
      q.points.push({ name: unquote(m[1] ?? ''), x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) })
    } else throw new Error(`cannot read "${line}"`)
  }
  return q
}

const render: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  const q = parse(source)
  const t = ctx.theme
  const colors = ctx.isMono ? [] : seriesColors(t)
  const textStyle: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const frame: Style = t.diagram === undefined ? { dim: true } : { color: t.diagram }
  const numStyle: Style = t.number === undefined ? {} : { color: t.number }
  // Quadrant colors: 1 top right, 2 top left, 3 bottom left, 4 bottom right.
  const qColor = (k: number) => colors[k % Math.max(1, colors.length)]

  // The y-axis labels sit in a gutter on the left.
  const gutter = Math.min(12, Math.max(widest(q.y.flatMap(s => s.split(/\s+/))), widest(q.y)))
  const gx = gutter > 0 ? gutter + 1 : 0
  const half = Math.min(24, Math.floor((ctx.width - gx - 3) / 2))
  if (half < 8) return { error: 'too narrow' }
  const hh = ctx.width >= 80 ? 8 : 7
  const left = gx // frame column
  const innerL = left + 1
  const mid = innerL + half // middle divider column
  const innerR = mid + 1
  const right = innerR + half
  const cv = new Canvas()
  let y = 0
  if (q.title !== undefined) {
    for (const l of wrapText(q.title, ctx.width)) cv.text(0, y++, l, { bold: true, ...(t.heading === undefined ? {} : { color: t.heading }) })
    y++
  }
  const top = y
  const midRow = top + 1 + hh
  const bottom = midRow + 1 + hh
  cv.text(left, top, `┌${'─'.repeat(half)}┬${'─'.repeat(half)}┐`, frame)
  cv.text(left, midRow, `├${'─'.repeat(half)}┼${'─'.repeat(half)}┤`, frame)
  cv.text(left, bottom, `└${'─'.repeat(half)}┴${'─'.repeat(half)}┘`, frame)
  for (let r = top + 1; r < bottom; r++) {
    if (r === midRow) continue
    cv.put(left, r, '│', frame)
    cv.put(mid, r, '│', frame)
    cv.put(right, r, '│', frame)
  }

  // Cells taken by names and markers.
  const taken = new Set<string>()
  const take = (x: number, r: number, w: number) => {
    for (let i = -1; i <= w; i++) taken.add(`${x + i}:${r}`)
  }
  const free = (x: number, r: number, w: number) => {
    for (let i = 0; i < w; i++) if (taken.has(`${x + i}:${r}`)) return false
    return true
  }
  const corner = (k: number, x: number, r: number, alignRight: boolean) => {
    const name = ellipsis(q.names[k] ?? '', half - 2)
    if (name === '') return
    const color = qColor(k)
    const nx = alignRight ? x + half - 1 - width(name) : x + 1
    cv.text(nx, r, name, { bold: true, ...(color === undefined ? {} : { color }) })
    take(nx, r, width(name))
  }
  corner(1, innerL, top + 1, false)
  corner(0, innerR, top + 1, true)
  corner(2, innerL, bottom - 1, false)
  corner(3, innerR, bottom - 1, true)

  // Points: their cell, or the nearest free one in their quadrant.
  const placed: { n: number; x: number; r: number; k: number }[] = []
  q.points.forEach((p, i) => {
    const label = String(i + 1)
    const w = width(label)
    const isRight = p.x >= 0.5
    const isTop = p.y >= 0.5
    const k = isTop ? (isRight ? 0 : 1) : isRight ? 3 : 2
    const x0 = isRight ? innerR : innerL
    const r0 = isTop ? top + 1 : midRow + 1
    const fx = isRight ? (p.x - 0.5) * 2 : p.x * 2
    const fy = isTop ? (1 - p.y) * 2 : (0.5 - p.y) * 2
    const cx = x0 + Math.min(half - w, Math.max(0, Math.round(fx * (half - w))))
    const cr = r0 + Math.min(hh - 1, Math.max(0, Math.round(fy * (hh - 1))))
    let best: [number, number] | undefined
    let bestD = Infinity
    for (let r = r0; r < r0 + hh; r++) {
      for (let x = x0; x + w <= x0 + half; x++) {
        if (!free(x, r, w)) continue
        const d = ((x - cx) / 2) ** 2 + (r - cr) ** 2
        if (d < bestD) {
          bestD = d
          best = [x, r]
        }
      }
    }
    if (best === undefined) return
    take(best[0], best[1], w)
    placed.push({ n: i + 1, x: best[0], r: best[1], k })
  })
  if (placed.length < q.points.length) return { error: 'too many points for the grid' }
  for (const p of placed) {
    const color = qColor(p.k)
    cv.text(p.x, p.r, String(p.n), { bold: true, ...(color === undefined ? {} : { color }) })
  }

  // Axis labels: x under each half, y beside each half.
  const ax = { ...textStyle, dim: true }
  const xl = ellipsis(q.x[0], half)
  const xr = ellipsis(q.x[1], half)
  if (xl !== '') cv.text(innerL + Math.floor((half - width(xl)) / 2), bottom + 1, xl, ax)
  if (xr !== '') cv.text(innerR + Math.floor((half - width(xr)) / 2), bottom + 1, xr, ax)
  if (q.x[0] !== '' && q.x[1] !== '') cv.text(mid - 1, bottom + 1, '─►', frame)
  const yLabel = (text: string, r0: number) => {
    if (gutter === 0 || text === '') return
    const lines = wrapText(text, gutter).slice(0, hh)
    const start = r0 + Math.floor((hh - lines.length) / 2)
    lines.forEach((l, i) => cv.text(gutter - width(l), start + i, l, ax))
  }
  yLabel(q.y[1], top + 1)
  yLabel(q.y[0], midRow + 1)
  y = bottom + (q.x[0] !== '' || q.x[1] !== '' ? 3 : 2)

  // The legend, in columns when the points are many.
  if (placed.length > 0) {
    const numW = String(q.points.length).length
    const items = q.points.map((p, i) => ({ i, text: `${p.name} (${fmtNum(p.x)}, ${fmtNum(p.y)})` }))
    const itemW = Math.min(ctx.width, numW + 1 + widest(items.map(x => x.text)))
    const cols = Math.max(1, Math.min(3, Math.floor((ctx.width + 3) / (itemW + 3))))
    const rows = Math.ceil(items.length / cols)
    items.forEach((it, j) => {
      const col = Math.floor(j / rows)
      const row = j % rows
      const x = col * (itemW + 3)
      const k = placed[it.i]?.k ?? 0
      const color = qColor(k)
      cv.text(x, y + row, String(it.i + 1).padStart(numW), { bold: true, ...(color === undefined ? {} : { color }) })
      const p = q.points[it.i] as Point
      const nameText = ellipsis(p.name, Math.max(1, itemW - numW - 1 - width(` (${fmtNum(p.x)}, ${fmtNum(p.y)})`)))
      const after = cv.text(x + numW + 1, y + row, nameText, textStyle)
      cv.text(after, y + row, ` (${fmtNum(p.x)}, ${fmtNum(p.y)})`, { ...numStyle, dim: true })
    })
  }
  return { lines: cv.lines() }
}

export const QUADRANT_RENDERERS: Record<string, Renderer> = { quadrantChart: render }
