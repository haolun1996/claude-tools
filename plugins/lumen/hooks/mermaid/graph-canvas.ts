// A grid of character cells that edges, boxes and labels are drawn into. Edge
// cells remember which way their lines run, so crossings and branches come
// out as the right box-drawing junctions; boxes remember where a line meets
// their border, so the border shows ┬ ┴ ├ ┤ there.

import type { Line, Run } from '../inline'
import type { LineStyle } from './graph-model'
import { charWidth } from '../width'

export const U = 1
export const D = 2
export const L = 4
export const R = 8

const EMPTY = 0
const FRAME = 1
const LINE = 2
const SOLID = 3

export type Ink = { color?: string; bold?: boolean; dim?: boolean }

type Cell = {
  kind: number
  ch: string
  ink: Ink
  mask: number
  /** Bit set of line styles: 1 solid, 2 dotted, 4 thick. */
  styles: number
  /** Directions lines leave this (border) cell in. */
  attach: number
  /** Second column of a wide character. */
  cont: boolean
}

const STYLE_BIT: Record<LineStyle, number> = { solid: 1, dotted: 2, thick: 4 }

const blank = (): Cell => ({ kind: EMPTY, ch: ' ', ink: {}, mask: 0, styles: 0, attach: 0, cont: false })

const lineChar = (mask: number, styles: number): string => {
  const thick = styles === 4
  const dotted = styles === 2
  const v = (mask & (U | D)) !== 0
  const h = (mask & (L | R)) !== 0
  if (v && !h) return thick ? '┃' : dotted ? '┆' : '│'
  if (h && !v) return thick ? '━' : dotted ? '┄' : '─'
  switch (mask) {
    case D | R: return thick ? '┏' : '╭'
    case D | L: return thick ? '┓' : '╮'
    case U | R: return thick ? '┗' : '╰'
    case U | L: return thick ? '┛' : '╯'
    case U | D | R: return thick ? '┣' : '├'
    case U | D | L: return thick ? '┫' : '┤'
    case D | L | R: return thick ? '┳' : '┬'
    case U | L | R: return thick ? '┻' : '┴'
    default: return thick ? '╋' : '┼'
  }
}

/** A border glyph with lines leaving it in `a`. */
const attachChar = (ch: string, a: number): string => {
  const up = (a & U) !== 0
  const down = (a & D) !== 0
  const left = (a & L) !== 0
  const right = (a & R) !== 0
  switch (ch) {
    case '─':
      return up && down ? '┼' : down ? '┬' : up ? '┴' : ch
    case '│':
    case '(':
    case ')':
      return left && right ? '┼' : right ? '├' : left ? '┤' : ch
    case '║':
      return right ? '╟' : left ? '╢' : ch
    case '━':
      return up && down ? '┿' : down ? '┯' : up ? '┷' : ch
    case '┃':
      return left && right ? '╂' : right ? '┠' : left ? '┨' : ch
    default:
      return ch
  }
}

export type Pt = { x: number; y: number }

export class Canvas {
  private readonly rows: Cell[][] = []
  width = 0
  height = 0
  /** Line cells that ran into a box or label (zero in a clean drawing). */
  collisions = 0

  private cell(x: number, y: number): Cell {
    while (this.rows.length <= y) this.rows.push([])
    const row = this.rows[y]!
    while (row.length <= x) row.push(blank())
    if (y + 1 > this.height) this.height = y + 1
    if (x + 1 > this.width) this.width = x + 1
    return row[x]!
  }

  private peek(x: number, y: number): Cell | undefined {
    return this.rows[y]?.[x]
  }

  isSolid(x: number, y: number): boolean {
    return (this.peek(x, y)?.kind ?? EMPTY) === SOLID
  }

  isFree(x: number, y: number): boolean {
    const k = this.peek(x, y)?.kind ?? EMPTY
    return k === EMPTY || k === FRAME
  }

  /** Writes text from (x, y); wide characters take two cells. Returns the columns used. */
  text(x: number, y: number, s: string, ink: Ink): number {
    if (x < 0 || y < 0) return 0
    let cx = x
    for (const ch of s) {
      const w = charWidth(ch)
      if (w === 0) continue
      const c = this.cell(cx, y)
      c.kind = SOLID
      c.ch = ch
      c.ink = ink
      c.mask = 0
      c.cont = false
      if (w === 2) {
        const n = this.cell(cx + 1, y)
        n.kind = SOLID
        n.ch = ''
        n.ink = ink
        n.cont = true
      }
      cx += w
    }
    return cx - x
  }

  /** A frame cell: drawn only where nothing else is, and given way to by edges. */
  frame(x: number, y: number, ch: string, ink: Ink): void {
    if (x < 0 || y < 0) return
    const c = this.cell(x, y)
    if (c.kind !== EMPTY) return
    c.kind = FRAME
    c.ch = ch
    c.ink = ink
  }

  /** An orthogonal polyline. Ends on a solid cell (a border) mark that cell as attached. */
  path(points: readonly Pt[], style: LineStyle, ink: Ink): void {
    if (points.length < 2) return
    const cells: Pt[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!
      const b = points[i + 1]!
      const dx = Math.sign(b.x - a.x)
      const dy = Math.sign(b.y - a.y)
      let x = a.x
      let y = a.y
      if (i === 0) cells.push({ x, y })
      while (x !== b.x || y !== b.y) {
        if (x !== b.x) x += dx
        else y += dy
        cells.push({ x, y })
      }
    }
    const dirTo = (from: Pt, to: Pt): number =>
      to.x > from.x ? R : to.x < from.x ? L : to.y > from.y ? D : U
    cells.forEach((p, i) => {
      if (p.x < 0 || p.y < 0) return
      const prev = cells[i - 1]
      const next = cells[i + 1]
      let bits = 0
      if (prev !== undefined && (prev.x !== p.x || prev.y !== p.y)) bits |= dirTo(p, prev)
      if (next !== undefined && (next.x !== p.x || next.y !== p.y)) bits |= dirTo(p, next)
      const c = this.cell(p.x, p.y)
      if (c.kind === SOLID) {
        if (i > 0 && i < cells.length - 1) this.collisions++
        c.attach |= bits
        return
      }
      if (c.kind !== LINE) {
        c.kind = LINE
        c.mask = 0
        c.styles = 0
      }
      c.mask |= bits
      c.styles |= STYLE_BIT[style]
      c.ink = ink
    })
  }

  /** A single glyph that replaces whatever line is there (arrowheads). */
  mark(x: number, y: number, ch: string, ink: Ink): void {
    this.text(x, y, ch, ink)
  }

  toLines(): Line[] {
    const out: Line[] = []
    for (let y = 0; y < this.height; y++) {
      const row = this.rows[y] ?? []
      let last = row.length - 1
      while (last >= 0 && (row[last]!.kind === EMPTY || (row[last]!.ch === ' ' && row[last]!.kind !== LINE))) last--
      const line: Run[] = []
      let cur: Run | undefined
      let curInk: Ink | undefined
      for (let x = 0; x <= last; x++) {
        const c = row[x]!
        if (c.cont) continue
        let ch = c.ch
        let ink = c.ink
        if (c.kind === LINE) ch = lineChar(c.mask, c.styles)
        else if (c.kind === SOLID && c.attach !== 0) ch = attachChar(ch, c.attach)
        else if (c.kind === EMPTY) ink = {}
        if (cur !== undefined && curInk !== undefined && sameInk(curInk, ink)) {
          cur.text += ch
          continue
        }
        cur = { text: ch }
        if (ink.color !== undefined) cur.color = ink.color
        if (ink.bold) cur.bold = true
        if (ink.dim) cur.dim = true
        curInk = ink
        line.push(cur)
      }
      out.push(line)
    }
    return out
  }
}

const sameInk = (a: Ink, b: Ink): boolean =>
  a.color === b.color && Boolean(a.bold) === Boolean(b.bold) && Boolean(a.dim) === Boolean(b.dim)
