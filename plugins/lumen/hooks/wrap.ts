// Word wrapping of styled runs to a width in columns.

import type { Line, Run } from './inline'
import { charWidth, width } from './width'

type Piece = { run: Run; text: string; isSpace: boolean }

const piecesOf = (runs: readonly Run[]): Piece[][] => {
  // Hard lines first: a newline in any run ends a line.
  const lines: Piece[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    parts.forEach((part, n) => {
      if (n > 0) lines.push([])
      for (const tok of part.match(/\s+|[^\s]+/g) ?? []) {
        lines[lines.length - 1]!.push({ run, text: tok, isSpace: /^\s+$/.test(tok) })
      }
    })
  }
  return lines
}

/** Joins neighbouring pieces of one run back into runs. */
const toLine = (pieces: readonly Piece[]): Line => {
  const line: Line = []
  for (const p of pieces) {
    const last = line[line.length - 1]
    const prev = pieces[pieces.indexOf(p) - 1]
    if (last !== undefined && prev?.run === p.run) last.text += p.text
    else line.push({ ...p.run, text: p.text })
  }
  return line
}

const breakWord = (text: string, max: number): string[] => {
  const out: string[] = []
  let cur = ''
  let n = 0
  for (const ch of text) {
    const w = charWidth(ch)
    if (n + w > max && cur !== '') {
      out.push(cur)
      cur = ''
      n = 0
    }
    cur += ch
    n += w
  }
  if (cur !== '') out.push(cur)
  return out
}

/** Wraps runs to `max` columns; a word longer than a line is broken. */
export const wrap = (runs: readonly Run[], max: number): Line[] => {
  const limit = Math.max(1, max)
  const out: Line[] = []
  for (const hard of piecesOf(runs)) {
    let cur: Piece[] = []
    let used = 0
    const push = () => {
      while (cur.length > 0 && cur[cur.length - 1]!.isSpace) cur.pop()
      out.push(toLine(cur))
      cur = []
      used = 0
    }
    for (const piece of hard) {
      const w = width(piece.text)
      if (piece.isSpace) {
        if (used === 0) continue // no space at a line's start
        if (used + w > limit) {
          push()
          continue
        }
        cur.push(piece)
        used += w
        continue
      }
      if (used + w <= limit) {
        cur.push(piece)
        used += w
        continue
      }
      if (used > 0) push()
      if (w <= limit) {
        cur.push(piece)
        used = w
        continue
      }
      const chunks = breakWord(piece.text, limit)
      chunks.forEach((chunk, n) => {
        const part = { ...piece, text: chunk }
        if (n < chunks.length - 1) {
          cur.push(part)
          push()
        } else {
          cur.push(part)
          used = width(chunk)
        }
      })
    }
    push()
  }
  return out
}

export const lineWidth = (line: Line) => line.reduce((n, r) => n + width(r.text), 0)

/** A line padded with spaces (in `fill`'s style) to `size` columns. */
export const padLine = (line: Line, size: number, fill: Omit<Run, 'text'> = {}, align: 'left' | 'center' | 'right' = 'left'): Line => {
  const room = Math.max(0, size - lineWidth(line))
  if (room === 0) return line
  const space = (n: number): Run[] => (n > 0 ? [{ ...fill, text: ' '.repeat(n) }] : [])
  if (align === 'right') return [...space(room), ...line]
  if (align === 'center') {
    const left = Math.floor(room / 2)
    return [...space(left), ...line, ...space(room - left)]
  }
  return [...line, ...space(room)]
}

/** Breaks a line at exactly `max` columns, keeping every space (for code). */
export const hardWrap = (line: Line, max: number): Line[] => {
  const limit = Math.max(1, max)
  const out: Line[] = [[]]
  let used = 0
  for (const run of line) {
    let text = ''
    for (const ch of run.text) {
      const w = charWidth(ch)
      if (used + w > limit) {
        if (text !== '') out[out.length - 1]!.push({ ...run, text })
        out.push([])
        text = ''
        used = 0
      }
      text += ch
      used += w
    }
    if (text !== '') out[out.length - 1]!.push({ ...run, text })
  }
  return out
}
