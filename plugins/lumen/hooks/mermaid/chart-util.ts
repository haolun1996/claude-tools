// Shared pieces of the chart renderers: a grid of styled cells that turns
// into lines, source-line cleanup, number formatting and nice axis steps.

import type { Line, Run } from './types'
import { charWidth, cut, width } from '../width'
import { wrap } from '../wrap'

export type Style = Omit<Run, 'text'>

type Cell = { ch: string; style: Style; solid?: boolean }

const BLANK: Cell = { ch: ' ', style: {} }

const styleKey = (s: Style): string =>
  `${s.color ?? ''}|${s.bg ?? ''}|${s.bold ? 1 : 0}|${s.dim ? 1 : 0}|${s.italic ? 1 : 0}|${s.underline ? 1 : 0}|${s.strike ? 1 : 0}`

/**
 * A grid of cells that grows as it is written to. A wide character takes its
 * cell and the next one (left as an empty continuation).
 */
export class Canvas {
  private rows: Cell[][] = []

  get height(): number {
    return this.rows.length
  }

  private row(y: number): Cell[] {
    while (this.rows.length <= y) this.rows.push([])
    return this.rows[y] as Cell[]
  }

  get(x: number, y: number): string {
    return this.rows[y]?.[x]?.ch ?? ' '
  }

  isBlank(x: number, y: number): boolean {
    const c = this.rows[y]?.[x]
    return c === undefined || c.solid !== true
  }

  /** Writes one character; returns the columns it took. */
  put(x: number, y: number, ch: string, style: Style = {}): number {
    if (x < 0 || y < 0) return 0
    const r = this.row(y)
    while (r.length <= x + 2) r.push(BLANK)
    const w = Math.max(1, charWidth(ch))
    // Writing over half of a wide character blanks its other half.
    if (r[x]?.ch === '' && x > 0) r[x - 1] = BLANK
    if (r[x + 1]?.ch === '') r[x + 1] = BLANK
    if (w === 2 && r[x + 2]?.ch === '') r[x + 2] = BLANK
    r[x] = { ch, style, solid: true }
    if (w === 2) r[x + 1] = { ch: '', style, solid: true }
    return w
  }

  /** Writes text from column x; returns the column after it. */
  text(x: number, y: number, text: string, style: Style = {}): number {
    let at = x
    for (const ch of text) {
      if (charWidth(ch) === 0) continue
      at += this.put(at, y, ch, style)
    }
    return at
  }

  /** Writes text only into cells nothing was written to. */
  under(x: number, y: number, text: string, style: Style = {}): void {
    let at = x
    for (const ch of text) {
      if (this.isBlank(at, y)) this.put(at, y, ch, style)
      at += 1
    }
  }

  lines(): Line[] {
    return this.rows.map(r => {
      let end = r.length
      while (end > 0 && (r[end - 1] as Cell).ch === ' ' && (r[end - 1] as Cell).style.bg === undefined) end--
      // A space that shows nothing of its style (no background, underline or
      // strike) takes the style around it, so "Web App" stays one run.
      const neutral = (c: Cell) => c.ch === ' ' && c.style.bg === undefined && !c.style.underline && !c.style.strike
      const styles: Style[] = []
      for (let i = 0; i < end; i++) {
        const c = r[i] as Cell
        if (!neutral(c)) {
          styles.push(c.style)
          continue
        }
        const prev = styles[styles.length - 1]
        let j = i + 1
        while (j < end && neutral(r[j] as Cell)) j++
        const next = r[j]?.style
        styles.push(prev !== undefined && next !== undefined && styleKey(prev) === styleKey(next) ? prev : {})
      }
      const line: Line = []
      let lastKey = ''
      for (let i = 0; i < end; i++) {
        const c = r[i] as Cell
        if (c.ch === '') continue
        const style = styles[i] ?? {}
        const key = styleKey(style)
        const last = line[line.length - 1]
        if (last !== undefined && key === lastKey) last.text += c.ch
        else {
          line.push({ ...style, text: c.ch })
          lastKey = key
        }
      }
      return line
    })
  }
}

/** The meaningful lines of a mermaid block: comments, front matter and blanks dropped, trimmed. */
export const sourceLines = (source: string): string[] => {
  const raw = source.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  // Front matter.
  while (i < raw.length && (raw[i] ?? '').trim() === '') i++
  if ((raw[i] ?? '').trim() === '---') {
    i++
    while (i < raw.length && (raw[i] ?? '').trim() !== '---') i++
    i++
  }
  for (; i < raw.length; i++) {
    const t = (raw[i] ?? '').trim()
    if (t === '' || t.startsWith('%%')) continue
    if (/^acc(Title|Descr)\b/.test(t)) continue
    out.push(t)
  }
  return out
}

/** Text without a pair of quotes around it. */
export const unquote = (s: string): string => {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1)
  return t
}

/** Splits a label on `<br>` tags and newlines. */
export const splitBr = (text: string): string[] => text.split(/<br\s*\/?>|\\n|\n/i).map(s => s.trim())

/** Text wrapped to lines of at most `max` columns. */
export const wrapText = (text: string, max: number): string[] => {
  const out: string[] = []
  for (const part of splitBr(text)) {
    if (part === '') {
      out.push('')
      continue
    }
    for (const l of wrap([{ text: part }], Math.max(1, max))) out.push(l.map(r => r.text).join(''))
  }
  return out.length === 0 ? [''] : out
}

/** Text cut to `max` columns, with an ellipsis when it was cut. */
export const ellipsis = (text: string, max: number): string => {
  if (width(text) <= max) return text
  if (max <= 1) return cut(text, max)
  return `${cut(text, max - 1)}…`
}

export const widest = (texts: readonly string[]): number => texts.reduce((n, t) => Math.max(n, width(t)), 0)

/** A number in short form: no float noise, at most two decimals. */
export const fmtNum = (v: number): string => {
  if (!Number.isFinite(v)) return String(v)
  const r = Math.round(v * 100) / 100
  if (Object.is(r, -0)) return '0'
  return String(r)
}

/** A number in at most a few characters: 1.2k, 3.4M. */
export const fmtCompact = (v: number): string => {
  const a = Math.abs(v)
  const scaled = (d: number, unit: string) => {
    const x = v / d
    return `${Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10}${unit}`
  }
  if (a >= 1e9) return scaled(1e9, 'B')
  if (a >= 1e6) return scaled(1e6, 'M')
  if (a >= 1e4) return scaled(1e3, 'k')
  if (a >= 100) return String(Math.round(v))
  return fmtNum(Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : v)
}

/** A number in the unit (k, M, B) that suits `ref`, so values side by side read alike. */
export const fmtLike = (v: number, ref: number): string => {
  const a = Math.abs(ref)
  const scaled = (d: number, unit: string) => {
    const x = v / d
    return `${Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10}${unit}`
  }
  if (a >= 1e9) return scaled(1e9, 'B')
  if (a >= 1e6) return scaled(1e6, 'M')
  if (a >= 1e4) return scaled(1e3, 'k')
  if (a >= 100) return String(Math.round(v))
  return fmtNum(a >= 10 ? Math.round(v * 10) / 10 : v)
}

/** A round step (1, 2, 2.5 or 5 times a power of ten) near range / count. */
export const niceStep = (range: number, count: number): number => {
  if (!(range > 0)) return 1
  const raw = range / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return m * pow
}

/** Parses a number as mermaid writes it; undefined when it is not one. */
export const num = (s: string): number | undefined => {
  const t = s.trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return undefined
  return Number(t)
}

/** Splits a bracketed list `[a, "b, c", d]` into items. */
export const listItems = (inner: string): string[] => {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of inner) {
    if (quote !== '') {
      if (ch === quote) quote = ''
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '' || out.length > 0) out.push(cur.trim())
  return out
}

/** Bars rising in eighths: index 0 to 8. */
export const UP_EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const
/** Bars growing to the right in eighths: index 0 to 8. */
export const LEFT_EIGHTHS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const

/** A horizontal bar of `len` columns (fractional), drawn to the eighth. */
export const hbar = (len: number): string => {
  const e = Math.max(0, Math.round(len * 8))
  return '█'.repeat(Math.floor(e / 8)) + (e % 8 > 0 ? LEFT_EIGHTHS[e % 8] : '')
}

export type Result = { lines: Line[] } | { error: string }
