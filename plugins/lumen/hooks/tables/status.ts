// statusMatrix (status cells colored, a count line, rows grouped by status)
// and testMatrix (a report line for a table of test runs).

import {
  STATUSES, STATUS_GLYPH, durationOf, findColumn, findStatusColumn, formatDuration, gray, isBlank, key, run, statusOf,
  statusPaint, tone,
} from './common'
import type { Column, Part, Status } from './common'
import type { Line, Run, SpecialOptions, Theme } from './types'

/** Group order: what needs attention first. Rows without a status go last. */
export const GROUP_ORDER: readonly Status[] = ['fail', 'warn', 'wait', 'pass']

const separator = (theme: Theme): Run => run(' · ', gray(theme))

const counts = (statuses: readonly (Status | undefined)[]) => {
  const n: Record<Status, number> = { pass: 0, fail: 0, warn: 0, wait: 0 }
  for (const s of statuses) if (s !== undefined) n[s]++
  return n
}

export const statusMatrix = (
  mode: SpecialOptions['statusMatrix'],
  theme: Theme,
  cols: readonly Column[],
): Part | undefined => {
  if (mode === 'off') return undefined
  const col = findStatusColumn(cols)
  if (col === undefined) return undefined
  const statuses = col.cells.map(c => (isBlank(c) ? undefined : statusOf(c)))
  const cells = new Map(statuses.flatMap((s, row) => (s === undefined ? [] : [[key(row, col.index), statusPaint(theme, s)] as const])))
  const part: Part = { cells }

  if (mode === 'summary' || mode === 'group') {
    const n = counts(statuses)
    const line: Run[] = []
    for (const s of STATUSES) {
      if (n[s] === 0) continue
      if (line.length > 0) line.push(separator(theme))
      line.push(run(`${STATUS_GLYPH[s]} ${n[s]}`, statusPaint(theme, s)))
    }
    part.footer = [line]
  }

  if (mode === 'group') {
    const rank = (s: Status | undefined) => (s === undefined ? GROUP_ORDER.length : GROUP_ORDER.indexOf(s))
    const order = statuses.map((_, i) => i).sort((a, b) => rank(statuses[a]) - rank(statuses[b]) || a - b)
    const ruleAfter = new Set<number>()
    for (let p = 0; p + 1 < order.length; p++) {
      if (statuses[order[p] ?? 0] !== statuses[order[p + 1] ?? 0]) ruleAfter.add(p)
    }
    part.order = order
    part.ruleAfter = ruleAfter
  }
  return part
}

const DURATION_HINT = /time|duration|elapsed|took|runtime|wall|latency/

const LABEL: Record<Exclude<Status, 'pass'>, string> = { fail: 'failed', warn: 'warned', wait: 'pending' }

/** The report line: share passed, a count of every other kind, the total time. */
export const testMatrix = (mode: SpecialOptions['testMatrix'], theme: Theme, cols: readonly Column[]): Part | undefined => {
  if (mode === 'off') return undefined
  const status = findStatusColumn(cols)
  if (status === undefined) return undefined
  const time = findColumn(cols, c => durationOf(c) !== undefined, DURATION_HINT, 2, new Set([status.index]))
  if (time === undefined) return undefined

  const statuses = status.cells.map(c => (isBlank(c) ? undefined : statusOf(c)))
  const n = counts(statuses)
  const total = n.pass + n.fail + n.warn + n.wait
  if (total === 0) return undefined
  let share = Math.round((n.pass / total) * 100)
  if (share === 100 && n.pass < total) share = 99
  if (share === 0 && n.pass > 0) share = 1

  const line: Line = [run(`${STATUS_GLYPH.pass} ${share}% passed`, statusPaint(theme, 'pass'))]
  for (const s of ['fail', 'warn', 'wait'] as const) {
    if (n[s] === 0) continue
    // A warn that every cell calls skipped reads as skipped.
    const label = s === 'warn' && status.cells.every((c, i) => statuses[i] !== 'warn' || /skip|⏭/i.test(c)) ? 'skipped' : LABEL[s]
    line.push(separator(theme), run(`${STATUS_GLYPH[s]} ${n[s]} ${label}`, statusPaint(theme, s)))
  }
  const ms = time.cells.reduce((sum, c) => sum + (durationOf(c) ?? 0), 0)
  line.push(separator(theme), run(`${formatDuration(ms)} total`, tone(theme.number)))
  return { cells: new Map(), footer: [line] }
}
