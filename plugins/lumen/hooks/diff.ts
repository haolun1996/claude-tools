// Diffs: a line diff for files a shell command changed, and diff cards drawn
// in four styles (card, full, marks, bar) with the changed words tinted.

import type { Line, Run } from './inline'
import type { DiffStyle, Style } from './options'
import { lineWidth, padLine } from './wrap'
import { charWidth } from './width'

export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

type Op = { kind: ' ' | '-' | '+'; text: string; oldNo: number; newNo: number }

const CONTEXT = 3
const MAX_CELLS = 4_000_000

/** A line diff of two texts as hunks with three lines of context. */
export const diffTexts = (before: string, after: string): Hunk[] => {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const am = a.slice(head, a.length - tail)
  const bm = b.slice(head, b.length - tail)

  const ops: Op[] = []
  for (let i = 0; i < head; i++) ops.push({ kind: ' ', text: a[i] ?? '', oldNo: i + 1, newNo: i + 1 })
  if (am.length * bm.length > MAX_CELLS) {
    am.forEach((t, i) => ops.push({ kind: '-', text: t, oldNo: head + i + 1, newNo: head }))
    bm.forEach((t, i) => ops.push({ kind: '+', text: t, oldNo: head + am.length, newNo: head + i + 1 }))
  } else {
    // LCS table over the changed middle.
    const n = am.length
    const m = bm.length
    const table = new Int32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * (m + 1) + j] = am[i] === bm[j] ? (table[(i + 1) * (m + 1) + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * (m + 1) + j] ?? 0, table[i * (m + 1) + j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        ops.push({ kind: ' ', text: am[i] ?? '', oldNo: head + i + 1, newNo: head + j + 1 })
        i++
        j++
      } else if (j < m && (i === n || (table[i * (m + 1) + j + 1] ?? 0) > (table[(i + 1) * (m + 1) + j] ?? 0))) {
        ops.push({ kind: '+', text: bm[j] ?? '', oldNo: head + i, newNo: head + j + 1 })
        j++
      } else {
        ops.push({ kind: '-', text: am[i] ?? '', oldNo: head + i + 1, newNo: head + j })
        i++
      }
    }
  }
  for (let k = 0; k < tail; k++) {
    ops.push({ kind: ' ', text: a[a.length - tail + k] ?? '', oldNo: a.length - tail + k + 1, newNo: b.length - tail + k + 1 })
  }

  // Group the changes into hunks with context around them.
  const hunks: Hunk[] = []
  let k = 0
  while (k < ops.length) {
    if (ops[k]?.kind === ' ') {
      k++
      continue
    }
    const start = Math.max(0, k - CONTEXT)
    let end = k
    let quiet = 0
    while (end < ops.length) {
      if (ops[end]?.kind === ' ') {
        quiet++
        if (quiet > CONTEXT * 2) break
      } else quiet = 0
      end++
    }
    const stop = Math.min(ops.length, end - Math.max(0, quiet - CONTEXT))
    const slice = ops.slice(start, stop)
    const first = slice[0]
    hunks.push({
      oldStart: first?.kind === '+' ? first.oldNo + 1 : (first?.oldNo ?? 1),
      oldLines: slice.filter(o => o.kind !== '+').length,
      newStart: first?.kind === '-' ? first.newNo + 1 : (first?.newNo ?? 1),
      newLines: slice.filter(o => o.kind !== '-').length,
      lines: slice.map(o => o.kind + o.text),
    })
    k = stop
  }
  return hunks
}

const cutTo = (runs: Run[], max: number): Run[] => {
  if (lineWidth(runs) <= max) return runs
  const out: Run[] = []
  let used = 0
  for (const r of runs) {
    let text = ''
    for (const ch of r.text) {
      const w = charWidth(ch)
      if (used + w > max - 1) break
      text += ch
      used += w
    }
    if (text !== '') out.push({ ...r, text })
    if (used >= max - 1) break
  }
  const last = out[out.length - 1]
  out.push({ text: '…', ...(last?.color !== undefined ? { color: last.color } : {}) })
  return out
}

/** Splits a changed line into unchanged head, changed middle and unchanged tail against its partner. */
const wordSplit = (line: string, partner: string | undefined): [string, string, string] => {
  if (partner === undefined) return ['', line, '']
  let head = 0
  while (head < line.length && head < partner.length && line[head] === partner[head]) head++
  let tail = 0
  while (tail < line.length - head && tail < partner.length - head && line[line.length - 1 - tail] === partner[partner.length - 1 - tail]) tail++
  return [line.slice(0, head), line.slice(head, line.length - tail), line.slice(line.length - tail)]
}

type Row = { kind: ' ' | '-' | '+' | '⋯'; text: string; no?: number; partner?: string }

const rowsOf = (hunks: readonly Hunk[]): Row[] => {
  const rows: Row[] = []
  hunks.forEach((h, n) => {
    if (n > 0) rows.push({ kind: '⋯', text: '' })
    let oldNo = h.oldStart
    let newNo = h.newStart
    const lines = h.lines.filter(l => !l.startsWith('\\'))
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] ?? ''
      const kind = (l[0] === '+' || l[0] === '-' ? l[0] : ' ') as ' ' | '-' | '+'
      const text = l.slice(1)
      if (kind === '-') rows.push({ kind, text, no: oldNo++ })
      else if (kind === '+') rows.push({ kind, text, no: newNo++ })
      else {
        rows.push({ kind, text, no: newNo++ })
        oldNo++
      }
    }
  })
  // Pair each run of removed lines with the added run right after it, line by
  // line, so an edited line tints only the words that changed.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.kind !== '-') continue
    let j = i
    while (rows[j]?.kind === '-') j++
    let k = j
    while (rows[k]?.kind === '+') k++
    const removed = j - i
    const added = k - j
    if (removed === added) {
      for (let p = 0; p < removed; p++) {
        const r = rows[i + p]
        const a = rows[j + p]
        if (r && a) {
          r.partner = a.text
          a.partner = r.text
        }
      }
    }
    i = k - 1
  }
  return rows
}

export type DiffDraw = { lines: Line[]; hidden: number }

/**
 * Draws hunks as a diff in the style asked: `title` heads it (a path), the
 * first `limit` rows show and the rest are counted in `hidden`.
 */
export const drawDiff = (style: Style, title: Run[], hunks: readonly Hunk[], width: number, limit = Infinity, look: DiffStyle = style.diffStyle): DiffDraw => {
  const t = style.theme
  const f = style.fills
  const rows = rowsOf(hunks)
  const shown = rows.slice(0, limit)
  const hidden = Math.max(0, rows.length - shown.length)
  const maxNo = Math.max(1, ...rows.map(r => r.no ?? 0))
  const numW = String(maxNo).length
  const framed = look === 'card'
  const inner = Math.max(10, width - (framed ? 4 : 0))
  const tinted = (look === 'card' || look === 'full') && f.added !== undefined

  const body: Line[] = shown.map(row => {
    if (row.kind === '⋯') return [{ text: `${' '.repeat(numW)}  ⋯`, dim: true }]
    const isAdd = row.kind === '+'
    const isDel = row.kind === '-'
    const lineBg = tinted ? (isAdd ? f.added : isDel ? f.removed : undefined) : undefined
    const wordBg = tinted ? (isAdd ? f.addedWord : isDel ? f.removedWord : undefined) : undefined
    const markColor = isAdd ? t.diffAdded : isDel ? t.diffRemoved : undefined
    const bg = (c?: string) => (c !== undefined ? { bg: c } : {})
    const textColor = isDel ? (t.codeComment ?? t.codeText) : t.codeText
    const lead: Run[] = []
    if (look === 'bar') lead.push(isAdd || isDel ? { text: '▌', ...(markColor ? { color: markColor } : {}) } : { text: ' ' })
    lead.push({ text: String(row.no ?? '').padStart(numW) + ' ', dim: true, ...bg(lineBg) })
    lead.push({ text: isAdd ? '+ ' : isDel ? '− ' : '  ', ...(markColor ? { color: markColor } : {}), ...(isAdd || isDel ? { bold: true } : {}), ...bg(lineBg) })
    const [h, mid, tl] = isAdd || isDel ? wordSplit(row.text, row.partner) : [row.text, '', '']
    const color = textColor !== undefined ? { color: textColor } : {}
    const text: Run[] = [
      { text: h.replace(/\t/g, '    '), ...color, ...bg(lineBg) },
      ...(mid !== '' ? [{ text: mid.replace(/\t/g, '    '), ...color, ...bg(row.partner !== undefined ? wordBg : lineBg) }] : []),
      ...(tl !== '' ? [{ text: tl.replace(/\t/g, '    '), ...color, ...bg(lineBg) }] : []),
    ].filter(r => r.text !== '')
    const line = cutTo([...lead, ...text], inner)
    return lineBg !== undefined ? padLine(line, inner, { bg: lineBg }) : line
  })

  const border = t.rule !== undefined ? { color: t.rule } : { dim: true }
  if (framed) {
    const titleW = lineWidth(title)
    const dashes = Math.max(1, inner - titleW - 1)
    return {
      lines: [
        [{ ...border, text: '╭─ ' }, ...title, { ...border, text: ` ${'─'.repeat(dashes)}╮` }],
        ...body.map(l => [{ ...border, text: '│ ' }, ...padLine(l, inner), { ...border, text: ' │' }]),
        [{ ...border, text: `╰${'─'.repeat(inner + 2)}╯` }],
      ],
      hidden,
    }
  }
  return { lines: [title, ...body], hidden }
}

/** The lines of a new file shown as numbered code (a Write that created it). */
export const drawNewFile = (style: Style, title: Run[], content: string, width: number, limit: number): DiffDraw => {
  const t = style.theme
  const all = content.replace(/\n$/, '').split('\n')
  const shown = all.slice(0, limit)
  const numW = String(all.length).length
  const inner = Math.max(10, width - 2)
  const code = t.codeText !== undefined ? { color: t.codeText } : {}
  const lines: Line[] = [
    title,
    ...shown.map((l, i) => cutTo([{ text: `  ${String(i + 1).padStart(numW)} `, dim: true }, { text: l.replace(/\t/g, '    '), ...code }], inner)),
  ]
  return { lines, hidden: Math.max(0, all.length - shown.length) }
}

export const countLines = (text: string) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length)
