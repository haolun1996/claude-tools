// benchTable: a column of changes (-10%, +3%) beside two columns of runs.
// Changes are drawn green for an improvement and red for a regression;
// `trend` adds a sparkline of the runs under the table.

import { filled, findColumn, gray, isBlank, key, quantityOf, run, tone } from './common'
import type { Column, Paint, Part, Quantity } from './common'
import type { Line, SpecialOptions, Theme } from './types'

const CHANGE = /^(?:\(\s*)?([+\-−±↑↓▲▼]?)\s*(\d+(?:\.\d+)?)\s*%(?:\s*\))?(?:\s*[↑↓▲▼])?$/u

type Change = { sign: -1 | 0 | 1 | undefined; size: number }

/** A change cell: its sign when written (undefined when it has none) and size. */
export const changeOf = (cell: string): Change | undefined => {
  const m = CHANGE.exec(cell.trim())
  if (!m) return undefined
  const size = Number(m[2])
  const mark = m[1] !== '' ? m[1] : /[↑↓▲▼]\s*$/u.exec(cell.trim())?.[0]?.trim()
  if (size === 0) return { sign: 0, size }
  const sign = mark === '+' || mark === '↑' || mark === '▲' ? 1 : mark === '-' || mark === '−' || mark === '↓' || mark === '▼' ? -1 : undefined
  return { sign, size }
}

const CHANGE_HINT = /change|delta|diff|Δ|vs\.?\b|%|improvement|regression|speedup|gain/
/** A header or unit that says higher is better. */
export const HIGHER_IS_BETTER = /req\/s|ops\/s|\/s(?:ec)?\b|throughput|score|qps|rps|ops\/sec|req\/sec|per second|iterations/

export type BenchShape = { change: Column; runs: [Column, Column]; higherIsBetter: boolean }

export const benchShape = (cols: readonly Column[]): BenchShape | undefined => {
  const change = findColumn(cols, c => changeOf(c) !== undefined, CHANGE_HINT)
  if (change === undefined) return undefined
  // A change column without a hint holds at least one signed change.
  if (!CHANGE_HINT.test(change.header) && !filled(change).some(c => changeOf(c)?.sign !== undefined)) return undefined
  const runCols = cols.filter(col => {
    if (col.index === change.index) return false
    const cells = filled(col)
    return cells.length > 0 && cells.every(c => quantityOf(c) !== undefined)
  })
  if (runCols.length < 2) return undefined
  // The two runs nearest before the change column, else the first two.
  const before = runCols.filter(c => c.index < change.index)
  const pick = before.length >= 2 ? before.slice(-2) : runCols.slice(0, 2)
  const [a, b] = pick
  if (a === undefined || b === undefined) return undefined
  const words = [...cols.map(c => c.header), ...a.cells, ...b.cells].join(' ').toLowerCase()
  return { change, runs: [a, b], higherIsBetter: HIGHER_IS_BETTER.test(words) }
}

/** +1 improved, -1 regressed, 0 unchanged, undefined unknown. */
const verdicts = (shape: BenchShape): (-1 | 0 | 1 | undefined)[] =>
  shape.change.cells.map((cell, row) => {
    const ch = isBlank(cell) ? undefined : changeOf(cell)
    let sign = ch?.sign
    if (sign === undefined) {
      const a = quantityOf(shape.runs[0].cells[row] ?? '')
      const b = quantityOf(shape.runs[1].cells[row] ?? '')
      if (a === undefined || b === undefined || a.family !== b.family) return undefined
      sign = b.value > a.value ? 1 : b.value < a.value ? -1 : 0
    }
    if (sign === 0) return 0
    return (sign > 0) === shape.higherIsBetter ? 1 : -1
  })

const verdictPaint = (theme: Theme, v: -1 | 0 | 1 | undefined): Paint | undefined =>
  v === 1 ? tone(theme.diffAdded, { bold: true }) : v === -1 ? tone(theme.diffRemoved, { bold: true }) : v === 0 ? gray(theme) : undefined

const BARS = '▁▂▃▄▅▆▇█'

/** A bar for `value` on a scale up to `max`; `log` spreads values that differ by orders of magnitude. */
const bar = (value: number, max: number, min = 0, log = false): string => {
  if (max <= 0) return BARS[0] as string
  const share = log && min > 0 ? (Math.log(value) - Math.log(min) + 1) / (Math.log(max) - Math.log(min) + 1) : value / max
  const i = Math.min(BARS.length - 1, Math.max(0, Math.ceil(share * BARS.length) - 1))
  return BARS[i] as string
}

/** Two sparklines, the first run and the second, one glyph a row, the second colored by the row's verdict. */
const sparklines = (theme: Theme, shape: BenchShape, verdict: readonly (-1 | 0 | 1 | undefined)[]): Line[] => {
  const pairs = shape.runs[0].cells.map((cell, row): [Quantity, Quantity] | undefined => {
    const a = quantityOf(cell)
    const b = quantityOf(shape.runs[1].cells[row] ?? '')
    return a && b ? [a, b] : undefined
  })
  const kept = pairs.flatMap((p, row) => (p ? [{ p, row }] : []))
  if (kept.length === 0) return []
  // One scale for all rows when they measure the same thing; else each row its own.
  const families = new Set(kept.flatMap(({ p }) => [p[0].family, p[1].family]))
  const all = kept.flatMap(({ p }) => [p[0].value, p[1].value])
  const globalMax = Math.max(...all)
  const globalMin = Math.min(...all)
  const shared = families.size === 1
  const log = shared && globalMin > 0 && globalMax / globalMin > 10
  const glyph = (v: number, p: [Quantity, Quantity]) => (shared ? bar(v, globalMax, globalMin, log) : bar(v, Math.max(p[0].value, p[1].value)))
  const labelA = shape.runs[0].header || 'before'
  const labelB = shape.runs[1].header || 'after'
  const labelWidth = Math.max([...labelA].length, [...labelB].length)
  const label = (text: string) => run(`${text.padEnd(labelWidth)}  `, gray(theme))
  const first: Line = [label(labelA), run(kept.map(({ p }) => glyph(p[0].value, p)).join(''), gray(theme))]
  const second: Line = [label(labelB)]
  for (const { p, row } of kept) second.push(run(glyph(p[1].value, p), verdictPaint(theme, verdict[row]) ?? {}))
  return [first, second]
}

export const benchTable = (mode: SpecialOptions['benchTable'], theme: Theme, cols: readonly Column[]): Part | undefined => {
  if (mode === 'off') return undefined
  const shape = benchShape(cols)
  if (shape === undefined) return undefined
  const verdict = verdicts(shape)
  const cells = new Map<string, Paint>()
  verdict.forEach((v, row) => {
    const p = verdictPaint(theme, v)
    if (p !== undefined) cells.set(key(row, shape.change.index), p)
  })
  const part: Part = { cells }
  if (mode === 'trend') part.footer = sparklines(theme, shape, verdict)
  return part
}
