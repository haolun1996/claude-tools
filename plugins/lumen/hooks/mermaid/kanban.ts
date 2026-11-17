// Mermaid kanban boards: the columns side by side, each header with its card
// count, each card a rounded box in its column's color holding the wrapped
// task and its assigned / ticket / priority metadata (high priorities in red).
// Too narrow for the columns side by side, they stack.

import type { DiagramContext, DiagramResult, Line, Renderer, Run } from './types'
import { seriesColors } from './types'
import { cut, width } from '../width'
import { lineWidth, padLine, wrap } from '../wrap'

type Card = { text: string; meta: Record<string, string> }
type Column = { title: string; cards: Card[] }
type Style = Omit<Run, 'text'>

// ---------------------------------------------------------------- parsing

const shapeText = (raw: string): string => {
  const s = raw.trim()
  const shapes = [
    /^[^\s()[\]{}]*\(\((.*)\)\)$/,
    /^[^\s()[\]{}]*\)\)(.*)\(\($/,
    /^[^\s()[\]{}]*\{\{(.*)\}\}$/,
    /^[^\s()[\]{}]*\[(.*)\]$/,
    /^[^\s()[\]{}]*\((.*)\)$/,
  ]
  let text = s
  for (const re of shapes) {
    const m = re.exec(s)
    if (m) {
      text = m[1] ?? ''
      break
    }
  }
  text = text.trim()
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) text = text.slice(1, -1)
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** `assigned: 'knsv', ticket: MC-2038, priority: "High"` to a record. */
export const parseMeta = (body: string): Record<string, string> => {
  const out: Record<string, string> = {}
  let i = 0
  while (i < body.length) {
    const key = /^[\s,]*([\w-]+)\s*:\s*/.exec(body.slice(i))
    if (!key) break
    i += key[0].length
    let value = ''
    const q = body[i]
    if (q === '"' || q === "'") {
      const end = body.indexOf(q, i + 1)
      value = end === -1 ? body.slice(i + 1) : body.slice(i + 1, end)
      i = end === -1 ? body.length : end + 1
    } else {
      const m = /^[^,]*/.exec(body.slice(i))?.[0] ?? ''
      value = m.trim()
      i += m.length
    }
    out[(key[1] ?? '').toLowerCase()] = value.trim()
  }
  return out
}

const indentOf = (line: string): number => {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

export const parseKanban = (source: string): Column[] => {
  const lines = source.split('\n')
  const start = lines.findIndex(l => /^\s*kanban\b/.test(l))
  if (start === -1) throw new Error('no kanban keyword')
  const columns: Column[] = []
  let columnIndent: number | undefined
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('%%')) continue
    if (/^(accTitle|accDescr)\b/.test(line)) continue
    const indent = indentOf(raw)
    columnIndent ??= indent
    const meta = /^(.*?)\s*@\{(.*)\}\s*$/.exec(line)
    const node = meta ? (meta[1] ?? '') : line
    const text = shapeText(node)
    if (indent <= columnIndent) {
      if (meta) throw new Error('a column has metadata')
      columnIndent = indent
      columns.push({ title: text, cards: [] })
      continue
    }
    const column = columns[columns.length - 1]
    if (column === undefined) throw new Error('a card before any column')
    column.cards.push({ text, meta: meta ? parseMeta(meta[2] ?? '') : {} })
  }
  if (columns.length === 0) throw new Error('the board has no columns')
  return columns
}

// ---------------------------------------------------------------- drawing

type Looks = {
  column: (i: number) => { color: string | undefined }
  text: Style
  dim: Style
  ticket: Style
  person: Style
  priority: (p: string) => Style
}

const looksOf = (ctx: DiagramContext): Looks => {
  const t = ctx.theme
  const colors = seriesColors(t)
  const c = (color: string | undefined, extra: Style = {}): Style => (color === undefined || ctx.isMono ? { ...extra } : { color, ...extra })
  return {
    column: i => ({ color: ctx.isMono || colors.length === 0 ? undefined : colors[i % colors.length] }),
    text: c(t.diagramText),
    dim: { dim: true },
    ticket: c(t.number),
    person: c(t.link),
    priority: p => {
      const level = p.toLowerCase().replace(/[\s_-]+/g, '')
      if (level === 'veryhigh' || level === 'high' || level === 'critical' || level === 'urgent') return c(t.diffRemoved, { bold: true })
      if (level === 'medium') return c(t.alertWarning)
      return { dim: true }
    },
  }
}

const ARROWS: Record<string, string> = { veryhigh: '▲▲', high: '▲', medium: '■', low: '▼', verylow: '▼▼' }

const ellipsize = (text: string, max: number): string =>
  width(text) <= max ? text : max <= 1 ? cut(text, max) : `${cut(text, max - 1)}…`

const cardLines = (card: Card, cw: number, color: string | undefined, looks: Looks, isMono: boolean): Line[] => {
  const border: Style = color === undefined ? (isMono ? {} : { dim: true }) : { color }
  const inner = cw - 4
  const body: Line[] = []
  body.push(...wrap([{ ...looks.text, text: card.text === '' ? ' ' : card.text }], inner))
  const { assigned, ticket, priority, ...rest } = card.meta
  const who: Run[] = []
  if (ticket !== undefined && ticket !== '') who.push({ ...looks.ticket, text: ticket })
  if (assigned !== undefined && assigned !== '') {
    if (who.length > 0) who.push({ ...looks.dim, text: ' · ' })
    who.push({ ...looks.person, text: `@${assigned}` })
  }
  if (who.length > 0) body.push(...wrap(who, inner))
  if (priority !== undefined && priority !== '') {
    const arrow = ARROWS[priority.toLowerCase().replace(/[\s_-]+/g, '')]
    body.push(...wrap([{ ...looks.priority(priority), text: arrow === undefined ? priority : `${arrow} ${priority}` }], inner))
  }
  for (const [k, v] of Object.entries(rest)) if (v !== '') body.push(...wrap([{ ...looks.dim, text: `${k}: ${v}` }], inner))
  const side = (s: string): Run => ({ ...border, text: s })
  return [
    [side(`╭${'─'.repeat(cw - 2)}╮`)],
    ...body.map(l => [side('│ '), ...padLine(l, inner), side(' │')]),
    [side(`╰${'─'.repeat(cw - 2)}╯`)],
  ]
}

const columnLines = (col: Column, index: number, cw: number, looks: Looks, isMono: boolean): Line[] => {
  const { color } = looks.column(index)
  const count = ` (${col.cards.length})`
  const title = ellipsize(col.title, Math.max(1, cw - width(count) - 2))
  const used = width(title) + width(count)
  const header: Line = [
    color === undefined ? { text: title, bold: true } : { text: title, color, bold: true },
    { ...looks.dim, text: count },
  ]
  if (cw - used > 1) header.push(color === undefined ? { text: ` ${'─'.repeat(cw - used - 1)}`, dim: true } : { text: ` ${'─'.repeat(cw - used - 1)}`, color })
  const out: Line[] = [header]
  if (col.cards.length === 0) out.push([{ ...looks.dim, text: 'no cards' }])
  for (const card of col.cards) out.push(...cardLines(card, cw, color, looks, isMono))
  return out
}

const MIN_COL = 16
const MAX_COL = 34
const GAP = 2

export const renderKanban: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  let columns: Column[]
  try {
    columns = parseKanban(source)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const looks = looksOf(ctx)
  const n = columns.length
  // As many columns side by side as fit, in balanced bands; one per band stacks them.
  const perBand = Math.max(1, Math.min(n, Math.floor((ctx.width + GAP) / (MIN_COL + GAP))))
  const bands = Math.ceil(n / perBand)
  const k = Math.ceil(n / bands)
  if (k > 1) {
    const cw = Math.min(Math.floor((ctx.width - GAP * (k - 1)) / k), MAX_COL)
    const lines: Line[] = []
    for (let from = 0; from < n; from += k) {
      if (from > 0) lines.push([])
      const blocks = columns.slice(from, from + k).map((c, i) => columnLines(c, from + i, cw, looks, ctx.isMono))
      const height = Math.max(...blocks.map(b => b.length))
      for (let r = 0; r < height; r++) {
        const line: Line = []
        blocks.forEach((b, i) => {
          if (i > 0) line.push({ text: ' '.repeat(GAP) })
          line.push(...padLine(b[r] ?? [], cw))
        })
        // Trailing blanks off.
        while (line.length > 0 && /^\s*$/.test(line[line.length - 1]?.text ?? '')) line.pop()
        lines.push(line)
      }
    }
    return { lines }
  }
  const cw = Math.min(ctx.width, 48)
  if (cw < 8) return { error: 'too narrow' }
  const lines: Line[] = []
  columns.forEach((c, i) => {
    if (i > 0) lines.push([])
    lines.push(...columnLines(c, i, cw, looks, ctx.isMono))
  })
  if (lines.some(l => lineWidth(l) > ctx.width)) return { error: 'too narrow' }
  return { lines }
}

export const KANBAN_RENDERERS: Record<string, Renderer> = { kanban: renderKanban }
