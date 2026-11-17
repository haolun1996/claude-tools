// Mermaid user journeys: the sections over their tasks, then a mood line with
// one dot per task at the height of its score (green good, amber neutral, red
// bad) and the actors under each task. With too many tasks for the width each
// task becomes a row: its name, its score as a bar, its actors.

import type { DiagramContext, DiagramResult, Line, Renderer, Run } from './types'
import { lineRun, seriesColors } from './types'
import { charWidth, cut, width } from '../width'
import { wrap } from '../wrap'

type Task = { name: string; score: number; actors: string[]; section: number }
type Journey = { title: string; sections: string[]; tasks: Task[] }
type Style = Omit<Run, 'text'>

export const parseJourney = (source: string): Journey => {
  const lines = source.split('\n')
  const start = lines.findIndex(l => /^\s*journey\b/.test(l))
  if (start === -1) throw new Error('no journey keyword')
  const out: Journey = { title: '', sections: [], tasks: [] }
  let section = -1
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('%%')) continue
    if (/^(accTitle|accDescr)\b/.test(line)) continue
    const title = /^title\s+(.*)$/.exec(line)
    if (title) {
      out.title = (title[1] ?? '').trim()
      continue
    }
    const sec = /^section\s+(.*)$/.exec(line)
    if (sec) {
      out.sections.push((sec[1] ?? '').trim())
      section = out.sections.length - 1
      continue
    }
    const task = /^([^:]+):\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(.*))?$/.exec(line)
    if (!task) throw new Error(`unknown line "${line.length > 30 ? `${line.slice(0, 30)}…` : line}"`)
    if (section === -1) {
      out.sections.push('')
      section = 0
    }
    const score = Math.min(5, Math.max(1, Math.round(Number(task[2]))))
    const actors = (task[3] ?? '').split(',').map(a => a.trim()).filter(a => a !== '')
    out.tasks.push({ name: (task[1] ?? '').trim(), score, actors, section })
  }
  if (out.tasks.length === 0) throw new Error('the journey has no tasks')
  return out
}

const strip = (s: Style & { text?: string }): Style => {
  const out: Style = {}
  for (const [k, v] of Object.entries(s)) if (v !== undefined && k !== 'text') (out as Record<string, unknown>)[k] = v
  return out
}

type Looks = {
  title: Style
  line: Style
  axis: Style
  text: Style
  section: (i: number) => Style
  actor: (i: number) => Style
  mood: (score: number) => Style
}

const looksOf = (ctx: DiagramContext): Looks => {
  const t = ctx.theme
  const colors = seriesColors(t)
  const pick = (i: number) => (colors.length === 0 ? undefined : colors[i % colors.length])
  const colored = (c: string | undefined, extra: Style = {}): Style => (c === undefined ? { ...extra } : { color: c, ...extra })
  return {
    title: colored(ctx.isMono ? undefined : t.heading, { bold: true }),
    line: strip(lineRun(t, '')),
    axis: ctx.isMono ? { dim: true } : colored(t.diagram, { dim: true }),
    text: colored(ctx.isMono ? undefined : t.diagramText),
    section: i => colored(ctx.isMono ? undefined : pick(i), { bold: true }),
    actor: i => (ctx.isMono ? (i === 0 ? {} : { dim: i % 2 === 1 }) : colored(pick(i + 1))),
    mood: score => {
      if (ctx.isMono) return score >= 4 ? { bold: true } : score === 3 ? {} : { dim: true }
      const c = score >= 4 ? t.diffAdded : score === 3 ? t.alertWarning : t.diffRemoved
      return colored(c, { bold: true })
    },
  }
}

// ---------------------------------------------------------------- a grid of cells

type Cell = { text: string; style: Style }
const styleKey = (s: Style) => JSON.stringify([s.color, s.bold, s.dim, s.italic, s.underline])

class Grid {
  rows: Cell[][] = []
  put(row: number, col: number, text: string, style: Style) {
    while (this.rows.length <= row) this.rows.push([])
    const cells = this.rows[row] as Cell[]
    let c = col
    for (const ch of text) {
      const w = charWidth(ch)
      if (w === 0) continue
      while (cells.length < c + w) cells.push({ text: ' ', style: {} })
      cells[c] = { text: ch, style }
      if (w === 2) cells[c + 1] = { text: '', style }
      c += w
    }
  }
  lines(): Line[] {
    return this.rows.map(cells => {
      let end = cells.length
      while (end > 0 && (cells[end - 1] as Cell).text === ' ') end--
      const line: Line = []
      let key = ''
      for (const cell of cells.slice(0, end)) {
        const k = styleKey(cell.style)
        const last = line[line.length - 1]
        if (last !== undefined && k === key) last.text += cell.text
        else {
          line.push({ ...cell.style, text: cell.text })
          key = k
        }
      }
      return line
    })
  }
}

const ellipsize = (text: string, max: number): string =>
  width(text) <= max ? text : max <= 1 ? cut(text, max) : `${cut(text, max - 1)}…`

const centered = (text: string, size: number): number => Math.max(0, Math.floor((size - width(text)) / 2))

// ---------------------------------------------------------------- columns

const MIN_COL = 7
const MAX_COL = 16
const LEFT = 4 // "5 ┤ "

const drawColumns = (ctx: DiagramContext, j: Journey, looks: Looks, cw: number): Line[] => {
  const grid = new Grid()
  const n = j.tasks.length
  const actorIndex = new Map<string, number>()
  for (const t of j.tasks) for (const a of t.actors) if (!actorIndex.has(a)) actorIndex.set(a, actorIndex.size)
  const x = (i: number) => LEFT + i * (cw + 1)
  const center = (i: number) => x(i) + Math.floor((cw - 1) / 2)
  let row = 0

  // Section headers: the name, then a rule over the section's tasks.
  if (j.sections.some(s => s !== '')) {
    j.sections.forEach((name, s) => {
      const idx = j.tasks.flatMap((t, i) => (t.section === s ? [i] : []))
      const first = idx[0]
      const last = idx[idx.length - 1]
      if (first === undefined || last === undefined) return
      const span = x(last) + cw - x(first)
      const label = name === '' ? '' : ellipsize(name, span - 2)
      const style = looks.section(s)
      grid.put(row, x(first), label, style)
      const rest = span - width(label) - (label === '' ? 0 : 1)
      grid.put(row, x(first) + width(label) + (label === '' ? 0 : 1), '─'.repeat(Math.max(0, rest)), { ...strip(style), bold: false })
    })
    row++
  }

  // Task names, up to three lines each.
  const names = j.tasks.map(t => {
    const parts = wrap([{ text: t.name }], cw).map(l => l.map(r => r.text).join(''))
    if (parts.length > 3) parts.splice(2, parts.length - 2, ellipsize(parts.slice(2).join(' '), cw))
    return parts
  })
  const nameRows = Math.max(...names.map(p => p.length))
  names.forEach((parts, i) => {
    parts.forEach((p, k) => grid.put(row + k, x(i) + centered(p, cw), p, looks.text))
  })
  row += nameRows

  // The mood plot: score 5 at the top, 1 at the bottom.
  const top = row
  const rowOf = (score: number) => top + (5 - score)
  for (let s = 5; s >= 1; s--) grid.put(rowOf(s), 0, `${s} ┤`, looks.axis)
  for (let i = 0; i + 1 < n; i++) {
    const a = j.tasks[i] as Task
    const b = j.tasks[i + 1] as Task
    const ra = rowOf(a.score)
    const rb = rowOf(b.score)
    const ca = center(i)
    const cb = center(i + 1)
    const m = Math.floor((ca + cb) / 2)
    for (let c = ca + 1; c < m; c++) grid.put(ra, c, '─', looks.line)
    for (let c = m + 1; c < cb; c++) grid.put(rb, c, '─', looks.line)
    if (ra === rb) grid.put(ra, m, '─', looks.line)
    else {
      const down = rb > ra
      grid.put(ra, m, down ? '╮' : '╯', looks.line)
      grid.put(rb, m, down ? '╰' : '╭', looks.line)
      for (let r = Math.min(ra, rb) + 1; r < Math.max(ra, rb); r++) grid.put(r, m, '│', looks.line)
    }
  }
  j.tasks.forEach((t, i) => grid.put(rowOf(t.score), center(i), '●', looks.mood(t.score)))
  row = top + 5
  grid.put(row, 2, `└${'─'.repeat(Math.max(0, x(n - 1) + cw - 3))}`, looks.axis)
  row++

  // Actors under each task, up to three.
  j.tasks.forEach((t, i) => {
    const shown = t.actors.length > 3 ? [...t.actors.slice(0, 2), `+${t.actors.length - 2}`] : t.actors
    shown.forEach((a, k) => {
      const label = ellipsize(a, cw)
      const idx = actorIndex.get(a)
      grid.put(row + k, x(i) + centered(label, cw), label, idx === undefined ? looks.axis : looks.actor(idx))
    })
  })

  const lines = grid.lines()
  if (j.title !== '') lines.unshift([{ ...looks.title, text: ellipsize(j.title, ctx.width) }], [])
  return lines
}

// ---------------------------------------------------------------- rows

const drawRows = (ctx: DiagramContext, j: Journey, looks: Looks): Line[] => {
  const out: Line[] = []
  if (j.title !== '') out.push([{ ...looks.title, text: ellipsize(j.title, ctx.width) }], [])
  const hasSections = j.sections.some(s => s !== '')
  const indent = hasSections ? 2 : 0
  const fixed = indent + 1 + 5 + 2 + 1 // gap, bar, gap+score
  const longest = Math.max(...j.tasks.map(t => width(t.name)))
  const nameW = Math.max(4, Math.min(longest, Math.floor(ctx.width * 0.45), ctx.width - fixed - 2))
  if (indent + nameW + fixed > ctx.width) throw new Error('too narrow')
  const actorIndex = new Map<string, number>()
  for (const t of j.tasks) for (const a of t.actors) if (!actorIndex.has(a)) actorIndex.set(a, actorIndex.size)
  let section = -1
  for (const t of j.tasks) {
    if (t.section !== section) {
      section = t.section
      const name = j.sections[section] ?? ''
      if (name !== '') out.push([{ ...looks.section(section), text: ellipsize(name, ctx.width) }])
    }
    const name = ellipsize(t.name, nameW)
    const line: Line = [
      { text: ' '.repeat(indent) },
      { ...looks.text, text: name + ' '.repeat(nameW - width(name) + 1) },
      { ...looks.mood(t.score), text: '█'.repeat(t.score) },
      { ...looks.axis, text: '░'.repeat(5 - t.score) },
      { ...looks.mood(t.score), text: ` ${t.score}` },
    ]
    let room = ctx.width - (indent + nameW + fixed)
    if (t.actors.length > 0 && room > 3) {
      line.push({ text: '  ' })
      room -= 2
      t.actors.forEach((a, k) => {
        if (room <= 0) return
        const sep = k === 0 ? '' : ', '
        const restCount = t.actors.length - k
        const label = sep + a
        if (width(label) > room || (restCount > 1 && width(label) + 3 > room)) {
          const more = k === 0 ? '…' : ', …'
          if (width(more) <= room) line.push({ ...looks.axis, text: more })
          room = 0
          return
        }
        if (sep !== '') line.push({ ...looks.axis, text: sep })
        line.push({ ...looks.actor(actorIndex.get(a) ?? 0), text: a })
        room -= width(label)
      })
    }
    out.push(line.filter(r => r.text !== ''))
  }
  return out
}

export const renderJourney: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  let j: Journey
  try {
    j = parseJourney(source)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const looks = looksOf(ctx)
  const n = j.tasks.length
  const longest = Math.max(...j.tasks.map(t => width(t.name)))
  const fit = Math.floor((ctx.width - LEFT + 1) / n) - 1
  const cw = Math.min(fit, MAX_COL, Math.max(MIN_COL, longest))
  try {
    if (cw >= MIN_COL) return { lines: drawColumns(ctx, j, looks, cw) }
    return { lines: drawRows(ctx, j, looks) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export const JOURNEY_RENDERERS: Record<string, Renderer> = { journey: renderJourney }
