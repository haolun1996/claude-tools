// A block parser for the markdown Claude writes: headings, paragraphs, fenced
// code, lists (nested, numbered, tasks), quotes, GitHub alerts, tables and
// rules. Not full CommonMark: it aims at what replies hold, and it keeps a
// fence that has not closed yet (a streaming reply) as code.

export type Align = 'left' | 'center' | 'right'
export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type ListItem = { task?: 'todo' | 'done'; blocks: Block[] }

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; text: string; isOpen: boolean }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'alert'; alert: AlertKind; blocks: Block[] }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i

const isBlank = (line: string) => line.trim() === ''

/** Splits a table row into its cells, keeping `\|` and pipes inside inline code. */
export const splitRow = (line: string): string[] => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|'
      i++
    } else if (ch === '`') {
      inCode = !inCode
      cell += ch
    } else if (ch === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
    } else cell += ch
  }
  cells.push(cell.trim())
  return cells
}

const alignOf = (cell: string): Align => {
  const c = cell.trim()
  if (c.startsWith(':') && c.endsWith(':')) return 'center'
  if (c.endsWith(':')) return 'right'
  return 'left'
}

const isTableStart = (lines: readonly string[], i: number) => {
  const head = lines[i]
  const delim = lines[i + 1]
  return head !== undefined && delim !== undefined && head.includes('|') && DELIMITER.test(delim) && delim.includes('-')
}

/** Whether a line opens a block other than a paragraph, ending a paragraph before it. */
const startsBlock = (lines: readonly string[], i: number) => {
  const line = lines[i] ?? ''
  return (
    FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) ||
    BULLET.test(line) || ORDERED.test(line) || isTableStart(lines, i)
  )
}

const indentOf = (line: string) => (line.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length

const dedent = (line: string, n: number) => {
  let cut = 0
  let seen = 0
  while (cut < line.length && seen < n && (line[cut] === ' ' || line[cut] === '\t')) {
    seen += line[cut] === '\t' ? 4 : 1
    cut++
  }
  return line.slice(cut)
}

const parseList = (lines: readonly string[], start: number): { block: Block; next: number } => {
  const first = lines[start] ?? ''
  const ordered = ORDERED.test(first) && !BULLET.test(first)
  const baseIndent = indentOf(first)
  const items: ListItem[] = []
  let number = 1
  let i = start

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const m = ordered ? ORDERED.exec(line) : BULLET.exec(line)
    if (!m || indentOf(line) !== baseIndent) break
    if (items.length === 0 && ordered) number = Number(m[2])
    const markerEnd = (m[1] ?? '').length + (m[2] ?? '').length + (ordered ? 1 : 0)
    const contentIndent = line.length - (m[3] ?? '').length
    const body: string[] = [m[3] ?? '']
    i++
    // The item's own lines: indented past the marker, a lazy continuation, or
    // blank lines followed by more of the item.
    while (i < lines.length) {
      const next = lines[i] ?? ''
      if (isBlank(next)) {
        const after = lines.slice(i + 1).find(l => !isBlank(l))
        if (after !== undefined && indentOf(after) >= contentIndent) {
          body.push('')
          i++
          continue
        }
        break
      }
      if (indentOf(next) >= contentIndent) {
        body.push(dedent(next, contentIndent))
        i++
        continue
      }
      if (indentOf(next) > baseIndent && (BULLET.test(next) || ORDERED.test(next))) {
        body.push(dedent(next, Math.max(markerEnd, indentOf(next))))
        i++
        continue
      }
      if (!startsBlock(lines, i) && indentOf(next) > baseIndent) {
        body.push(next.trim())
        i++
        continue
      }
      if (!startsBlock(lines, i) && !isBlank(lines[i - 1] ?? '')) {
        // A lazy continuation of the item's paragraph.
        body.push(next.trim())
        i++
        continue
      }
      break
    }
    const task = TASK.exec(body[0] ?? '')
    if (task) body[0] = task[2] ?? ''
    items.push({
      ...(task ? { task: task[1] === ' ' ? ('todo' as const) : ('done' as const) } : {}),
      blocks: parse(body.join('\n')),
    })
    // A blank line between items keeps the list going.
    if (isBlank(lines[i] ?? 'x')) {
      const after = lines.slice(i).findIndex(l => !isBlank(l))
      const j = after === -1 ? -1 : i + after
      const again = j === -1 ? null : (ordered ? ORDERED : BULLET).exec(lines[j] ?? '')
      if (again && indentOf(lines[j] ?? '') === baseIndent) i = j
    }
  }

  return { block: { kind: 'list', ordered, start: number, items }, next: i }
}

export const parse = (text: string): Block[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1] ?? '```'
      const indent = indentOf(line)
      const body: string[] = []
      let closed = false
      i++
      while (i < lines.length) {
        const l = lines[i] ?? ''
        const t = l.trim()
        if (t.length >= marker.length && [...t].every(c => c === marker[0])) {
          closed = true
          i++
          break
        }
        body.push(dedent(l, indent))
        i++
      }
      blocks.push({ kind: 'code', lang: (fence[2] ?? '').toLowerCase(), text: body.join('\n'), isOpen: !closed })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        body.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '')
        i++
      }
      const alert = ALERT.exec(body[0]?.trim() ?? '')
      if (alert) {
        blocks.push({ kind: 'alert', alert: (alert[1] ?? 'note').toLowerCase() as AlertKind, blocks: parse(body.slice(1).join('\n')) })
      } else blocks.push({ kind: 'quote', blocks: parse(body.join('\n')) })
      continue
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const { block, next } = parseList(lines, i)
      blocks.push(block)
      i = next
      continue
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1] ?? '').map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && !isBlank(lines[i] ?? '') && (lines[i] ?? '').includes('|')) {
        const cells = splitRow(lines[i] ?? '')
        rows.push(header.map((_, c) => cells[c] ?? ''))
        i++
      }
      blocks.push({ kind: 'table', header, align: header.map((_, c) => align[c] ?? 'left'), rows })
      continue
    }

    const para: string[] = [line.trim()]
    i++
    while (i < lines.length && !isBlank(lines[i] ?? '') && !startsBlock(lines, i)) {
      para.push((lines[i] ?? '').trim())
      i++
    }
    blocks.push({ kind: 'paragraph', text: para.join('\n') })
  }

  return blocks
}
