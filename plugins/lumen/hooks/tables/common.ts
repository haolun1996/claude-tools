// Shared pieces of the special tables: cell text without its markdown, column
// lookup by header, the paints a kind puts on cells, and the readers of
// statuses, durations and quantities that more than one kind uses.

import type { Line, Run, Theme } from './types'

/** How a kind restyles a cell: a color, or bold / dim where the theme has none (mono). */
export type Paint = { color?: string; bold?: boolean; dim?: boolean }

/** What one kind found in a table. Cells are keyed `row:col` (original indexes). */
export type Part = {
  cells: Map<string, Paint>
  order?: number[]
  ruleAfter?: Set<number>
  footer?: Line[]
}

export const key = (row: number, col: number) => `${row}:${col}`

/** A paint in `color`; without one (mono) the fallback marks it instead. */
export const tone = (color: string | undefined, fallback: Omit<Paint, 'color'> = {}, extra: Omit<Paint, 'color'> = {}): Paint =>
  color === undefined ? { ...fallback, ...extra } : { color, ...extra }

export const applyPaint = (runs: Run[], p: Paint): Run[] =>
  runs.map(r => ({
    ...r,
    ...(p.color !== undefined ? { color: p.color } : {}),
    ...(p.bold ? { bold: true } : {}),
    ...(p.dim ? { dim: true } : {}),
  }))

/** A footer run in a paint. */
export const run = (text: string, p: Paint = {}): Run => ({ text, ...p })

/** Cell text as read for detection: markdown marks, links and tags removed. */
export const plainCell = (text: string): string =>
  text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\`*_~|[\]()#+\-.!])/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/^[*_]+|[*_]+$/g, '')
    .replace(/️/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export type Column = { index: number; header: string; cells: string[] }

/** Each column's lowercased header and plain cells. */
export const columnsOf = (header: readonly string[], rows: readonly (readonly string[])[]): Column[] =>
  header.map((h, index) => ({
    index,
    header: plainCell(h).toLowerCase(),
    cells: rows.map(row => plainCell(row[index] ?? '')),
  }))

/** Placeholder cells that say "nothing here". */
export const isBlank = (cell: string) => /^(?:|-|–|—|n\/a|na)$/i.test(cell.trim())

/** The non-blank cells of a column. */
export const filled = (col: Column) => col.cells.filter(c => !isBlank(c))

/**
 * A column every filled cell of which `accepts`, with at least one filled
 * cell; when the header does not match `hint`, at least `minWithoutHint`.
 * Columns whose header matches come first.
 */
export const findColumn = (
  cols: readonly Column[],
  accepts: (cell: string) => boolean,
  hint: RegExp,
  minWithoutHint = 2,
  exclude: ReadonlySet<number> = new Set(),
): Column | undefined => {
  const ok = cols.filter(col => {
    if (exclude.has(col.index)) return false
    const cells = filled(col)
    if (cells.length === 0 || !cells.every(accepts)) return false
    return hint.test(col.header) || cells.length >= minWithoutHint
  })
  return ok.find(col => hint.test(col.header)) ?? ok[0]
}

/** The column whose header matches. */
export const headerColumn = (cols: readonly Column[], hint: RegExp, exclude: ReadonlySet<number> = new Set()): Column | undefined =>
  cols.find(col => !exclude.has(col.index) && hint.test(col.header))

// Statuses.

export type Status = 'pass' | 'fail' | 'warn' | 'wait'
export const STATUSES: readonly Status[] = ['pass', 'fail', 'warn', 'wait']

const GLYPHS: readonly [RegExp, Status][] = [
  [/^(?:✓|✔|✅|☑|🟢|🆗)/u, 'pass'],
  [/^(?:✗|✘|❌|✖|✕|🔴|⛔|🚫)/u, 'fail'],
  [/^(?:⚠|🟡|🟠|⏭)/u, 'warn'],
  [/^(?:●|○|◌|◐|…|⋯|⏳|⌛|🔄|⏸|🕐)/u, 'wait'],
]

const WORDS: readonly [RegExp, Status][] = [
  [/^(?:passed|pass|passing|ok|okay|done|success|successful|succeeded|complete|completed)$/, 'pass'],
  [/^(?:failed|fail|failing|failure|error|errored|errors|broken|crashed)$/, 'fail'],
  [/^(?:warn|warning|warnings|warned|skipped|skip|skipping|flaky|partial|degraded)$/, 'warn'],
  [/^(?:pending|running|waiting|todo|queued|wip|scheduled|in[ -]progress|not started)$/, 'wait'],
]

/** The status a cell opens with: a glyph, or a word like passed / failed / pending. */
export const statusOf = (cell: string): Status | undefined => {
  const text = cell.trim()
  for (const [re, s] of GLYPHS) if (re.test(text)) return s
  const lower = text.toLowerCase()
  const two = /^[a-z]+(?:[ -][a-z]+)?/.exec(lower)?.[0] ?? ''
  const one = /^[a-z]+/.exec(lower)?.[0] ?? ''
  for (const [re, s] of WORDS) if (re.test(two) || re.test(one)) return s
  return undefined
}

export const STATUS_HINT = /status|result|state|outcome|check|verdict|ci\b|build|^test/

export const findStatusColumn = (cols: readonly Column[]) => findColumn(cols, c => statusOf(c) !== undefined, STATUS_HINT)

export const statusColor = (theme: Theme, s: Status): string | undefined =>
  s === 'pass' ? theme.diffAdded : s === 'fail' ? theme.diffRemoved : s === 'warn' ? theme.alertWarning : theme.codeComment

export const statusPaint = (theme: Theme, s: Status): Paint =>
  tone(statusColor(theme, s), s === 'fail' || s === 'warn' ? { bold: true } : s === 'wait' ? { dim: true } : {})

export const STATUS_GLYPH: Record<Status, string> = { pass: '✓', fail: '✗', warn: '⚠', wait: '●' }

export const gray = (theme: Theme): Paint => tone(theme.codeComment, { dim: true })

// Durations.

const UNIT_MS: Record<string, number> = {
  ns: 1e-6, 'µs': 1e-3, 'μs': 1e-3, us: 1e-3, ms: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
}

/** Milliseconds in `120 ms`, `3.2 s`, `1m 5s`, `1h2m`; undefined for anything else. */
export const durationOf = (cell: string): number | undefined => {
  const text = cell.trim().toLowerCase()
  if (!/^(?:\d+(?:\.\d+)?\s*[a-zµμ]+\s*)+$/u.test(text)) return undefined
  let total = 0
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*([a-zµμ]+)/gu)) {
    const unit = UNIT_MS[m[2] ?? '']
    if (unit === undefined) return undefined
    total += Number(m[1]) * unit
  }
  return total
}

const trim0 = (n: number, digits: number) => n.toFixed(digits).replace(/\.0+$/, '')

export const formatDuration = (ms: number): string => {
  if (ms < 1) return `${trim0(ms * 1000, 0)} µs`
  if (ms < 1000) return `${trim0(ms, ms < 10 ? 1 : 0)} ms`
  if (ms < 60_000) return `${trim0(ms / 1000, 1)} s`
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms - m * 60_000) / 1000)
    return s === 60 ? `${m + 1}m` : s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms - h * 3_600_000) / 60_000)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// Quantities (bench runs, scores).

export type Quantity = { value: number; family: string }

const TIME_UNITS: Record<string, number> = { ns: 1e-6, 'µs': 1e-3, 'μs': 1e-3, us: 1e-3, ms: 1, s: 1000, sec: 1000, min: 60_000, m: 60_000, h: 3_600_000 }
const SIZE_UNITS: Record<string, number> = {
  b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
}

/** A number with an optional unit: `12.3 ms`, `1,204 req/s`, `1.2 MB`, `450`. Time and size units are normalized. */
export const quantityOf = (cell: string): Quantity | undefined => {
  const m = /^(\d[\d,_]*(?:\.\d+)?|\.\d+)\s*([a-zµμ]+(?:\/[a-z]+)?)?$/iu.exec(cell.trim())
  if (!m) return undefined
  const value = Number((m[1] ?? '').replace(/[,_]/g, ''))
  if (!Number.isFinite(value)) return undefined
  const unit = m[2] ?? ''
  const lower = unit.toLowerCase()
  const time = TIME_UNITS[unit === 'M' ? 'x' : lower]
  if (time !== undefined) return { value: value * time, family: 'time' }
  const size = SIZE_UNITS[lower]
  if (size !== undefined && /b$/i.test(unit)) return { value: value * size, family: 'size' }
  if (lower === 'k') return { value: value * 1e3, family: '' }
  return { value, family: lower }
}
