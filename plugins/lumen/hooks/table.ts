// Tables drawn as text: four styles (box, rules, grid, minimal) and four
// layouts (classic, auto, compact, stacked), with :---: alignment honored and
// columns sized to the width there is.

import { inline } from './inline'
import type { Line, Run } from './inline'
import type { Align } from './markdown'
import type { Style } from './options'
import { decorateTable } from './tables/special'
import type { Decoration } from './tables/types'
import { padLine, wrap } from './wrap'
import { width as textWidth } from './width'

const MIN_COLUMN = 3
/** A column this narrow is kept whole while longer ones wrap. */
const SHORT_COLUMN = 12

type Cell = Run[]

const cellRuns = (style: Style, text: string, isHeader: boolean): Cell =>
  inline(style, text.replace(/<br\s*\/?>/gi, '\n'), isHeader ? { text: '', bold: true, ...(style.theme.tableHeader ? { color: style.theme.tableHeader } : {}) } : { text: '' })

const naturalOf = (cell: Cell) => Math.max(0, ...cell.map(r => r.text).join('').split('\n').map(textWidth))
const longestWord = (cell: Cell) => Math.max(1, ...cell.map(r => r.text).join('').split(/\s+/).map(textWidth))

/** Shrinks the widest columns, one column at a time, until they fit `room`, none below its floor. */
const shrink = (widths: number[], floors: readonly number[], room: number): number[] => {
  const w = [...widths]
  let total = w.reduce((a, b) => a + b, 0)
  while (total > room) {
    let widest = -1
    for (let c = 0; c < w.length; c++) {
      if ((w[c] ?? 0) > (floors[c] ?? MIN_COLUMN) && (widest === -1 || (w[c] ?? 0) > (w[widest] ?? 0))) widest = c
    }
    if (widest === -1) break
    w[widest] = (w[widest] ?? 0) - 1
    total--
  }
  return w
}

const fit = (natural: number[], words: number[], room: number, compact: boolean): number[] => {
  const start = compact ? words.map((w, c) => Math.min(w, natural[c] ?? w)) : natural
  const total = (w: number[]) => w.reduce((a, b) => a + b, 0)
  if (total(start) <= room) return start
  const wordFloor = words.map(w => Math.max(MIN_COLUMN, w))
  // Long columns wrap first and short ones (a status, a time) stay whole; then
  // every column down to its longest word; then below it where need be.
  const keepShort = shrink(start, start.map((w, c) => (w <= SHORT_COLUMN ? w : (wordFloor[c] ?? MIN_COLUMN))), room)
  if (total(keepShort) <= room) return keepShort
  const keepWords = shrink(keepShort, wordFloor, room)
  if (total(keepWords) <= room) return keepWords
  return shrink(keepWords, start.map(() => MIN_COLUMN), room)
}

const ruleRun = (style: Style, text: string): Run => ({ text, ...(style.theme.tableRule ? { color: style.theme.tableRule } : { dim: true }) })

const withDefault = (line: Line, color: string | undefined): Line =>
  color === undefined ? line : line.map(r => (r.color === undefined ? { ...r, color } : r))

const stacked = (style: Style, header: Cell[], rows: Cell[][], width: number): Line[] => {
  const labelWidth = Math.min(Math.max(...header.map(naturalOf), 1), Math.floor(width * 0.4))
  const valueWidth = Math.max(MIN_COLUMN, width - labelWidth - 2)
  const out: Line[] = []
  rows.forEach((row, r) => {
    if (r > 0) out.push([ruleRun(style, '─'.repeat(Math.min(width, 40)))])
    header.forEach((label, c) => {
      const labels = wrap(label, labelWidth)
      const values = wrap(row[c] ?? [], valueWidth).map(l => withDefault(l, style.theme.tableText))
      const height = Math.max(labels.length, values.length)
      for (let n = 0; n < height; n++) {
        out.push([...padLine(labels[n] ?? [], labelWidth), { text: '  ' }, ...(values[n] ?? [])])
      }
    })
  })
  return out
}

const decorationOf = (style: Style, header: readonly string[], rows: readonly (readonly string[])[]): Decoration | undefined =>
  Object.values(style.special).some(v => v !== 'off') ? decorateTable(style.special, style.theme, header, rows) : undefined

export const drawTable = (style: Style, headerText: readonly string[], align: readonly Align[], rowsText: readonly (readonly string[])[], width: number): Line[] => {
  const deco = decorationOf(style, headerText, rowsText)
  const out = drawPlainTable(style, headerText, align, rowsText, width, deco)
  return deco !== undefined && deco.footer.length > 0 ? [...out, ...deco.footer] : out
}

const drawPlainTable = (style: Style, headerText: readonly string[], align: readonly Align[], rowsText: readonly (readonly string[])[], width: number, deco: Decoration | undefined): Line[] => {
  const header = headerText.map(h => cellRuns(style, h, true))
  const order = deco?.order ?? rowsText.map((_, r) => r)
  const rows = order.map(r => (rowsText[r] ?? []).map((cell, c) => (deco === undefined ? cellRuns(style, cell, false) : deco.cell(r, c, cellRuns(style, cell, false)))))
  const heavyAfter = deco?.ruleAfter ?? new Set<number>()
  const n = header.length
  const framed = style.tableStyle === 'box' || style.tableStyle === 'grid'
  const overhead = framed ? 3 * n + 1 : 2 * (n - 1)
  const room = width - overhead

  const all = [header, ...rows]
  const natural = header.map((_, c) => Math.max(1, ...all.map(row => naturalOf(row[c] ?? []))))
  const words = header.map((_, c) => Math.max(1, ...all.map(row => longestWord(row[c] ?? []))))

  const tooNarrow = room < n * MIN_COLUMN
  const wordsDoNotFit = words.reduce((a, b) => a + Math.max(MIN_COLUMN, b), 0) > room
  if (style.tableLayout === 'stacked' || tooNarrow || (style.tableLayout === 'auto' && wordsDoNotFit)) {
    return stacked(style, header, rows, width)
  }

  const widths = fit(natural, words, room, style.tableLayout === 'compact')
  const line = (left: string, mid: string, right: string, fill: string): Line =>
    [ruleRun(style, left + widths.map(w => fill.repeat(w + 2)).join(mid) + right)]
  const plainRule = (): Line => [ruleRun(style, '─'.repeat(widths.reduce((a, b) => a + b, 0) + 2 * (n - 1)))]
  const heavyRule = (): Line => [ruleRun(style, '━'.repeat(widths.reduce((a, b) => a + b, 0) + 2 * (n - 1)))]

  const drawRow = (cells: Cell[], isHeader: boolean): Line[] => {
    const wrapped = cells.map((cell, c) => wrap(cell, widths[c] ?? MIN_COLUMN).map(l => (isHeader ? l : withDefault(l, style.theme.tableText))))
    const height = Math.max(1, ...wrapped.map(w => w.length))
    const out: Line[] = []
    for (let k = 0; k < height; k++) {
      const parts = wrapped.map((w, c) => padLine(w[k] ?? [], widths[c] ?? MIN_COLUMN, {}, isHeader && !framed ? 'left' : (align[c] ?? 'left')))
      if (framed) {
        const runs: Run[] = [ruleRun(style, '│')]
        parts.forEach(p => runs.push({ text: ' ' }, ...p, { text: ' ' }, ruleRun(style, '│')))
        out.push(runs)
      } else {
        const runs: Run[] = []
        parts.forEach((p, c) => runs.push(...(c > 0 ? [{ text: '  ' }] : []), ...p))
        out.push(runs)
      }
    }
    return out
  }

  const out: Line[] = []
  switch (style.tableStyle) {
    case 'box':
      out.push(line('┌', '┬', '┐', '─'), ...drawRow(header, true), line('╞', '╪', '╡', '═'))
      rows.forEach((row, r) => {
        if (r > 0) out.push(heavyAfter.has(r - 1) ? line('┝', '┿', '┥', '━') : line('├', '┼', '┤', '─'))
        out.push(...drawRow(row, false))
      })
      out.push(line('└', '┴', '┘', '─'))
      break
    case 'grid':
      out.push(line('┌', '┬', '┐', '─'), ...drawRow(header, true), line('├', '┼', '┤', '─'))
      rows.forEach((row, r) => {
        if (r > 0 && heavyAfter.has(r - 1)) out.push(line('┝', '┿', '┥', '━'))
        out.push(...drawRow(row, false))
      })
      out.push(line('└', '┴', '┘', '─'))
      break
    case 'rules':
      out.push(plainRule(), ...drawRow(header, true), plainRule())
      rows.forEach((row, r) => {
        if (r > 0 && heavyAfter.has(r - 1)) out.push(heavyRule())
        out.push(...drawRow(row, false))
      })
      out.push(plainRule())
      break
    case 'minimal':
      out.push(...drawRow(header, true), plainRule())
      rows.forEach((row, r) => {
        if (r > 0 && heavyAfter.has(r - 1)) out.push(heavyRule())
        out.push(...drawRow(row, false))
      })
      break
  }
  return out
}
