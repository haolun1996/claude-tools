// Sequence diagrams: participant boxes at the top and bottom, each in its own
// color, dim lifelines, labelled messages between them, notes, and titled
// frames (loop, alt, opt, par, critical, break) around the parts they hold.

import type { DiagramContext, DiagramResult, Line, Renderer } from './types'
import { seriesColors } from './types'
import { Canvas, type Style, sourceLines, splitBr, unquote, widest, wrapText } from './chart-util'
import { width } from '../width'

type Arrow = { dashed: boolean; head: 'arrow' | 'open' | 'cross' | 'async'; both: boolean }

type Participant = { id: string; label: string; actor: boolean }

type Msg = { kind: 'msg'; from: number; to: number; arrow: Arrow; text: string; on: boolean; off: boolean }
type Note = { kind: 'note'; pos: 'left' | 'right' | 'over'; a: number; b: number; text: string }
type Act = { kind: 'act'; who: number; on: boolean }
type Section = { label: string; items: Item[] }
type Frame = { kind: 'frame'; type: string; sections: Section[] }
type Item = Msg | Note | Act | Frame

type Parsed = { title: string | undefined; parts: Participant[]; items: Item[] }

const ARROWS: readonly [string, Arrow][] = [
  ['<<-->>', { dashed: true, head: 'arrow', both: true }],
  ['<<->>', { dashed: false, head: 'arrow', both: true }],
  ['-->>', { dashed: true, head: 'arrow', both: false }],
  ['->>', { dashed: false, head: 'arrow', both: false }],
  ['--x', { dashed: true, head: 'cross', both: false }],
  ['-x', { dashed: false, head: 'cross', both: false }],
  ['--)', { dashed: true, head: 'async', both: false }],
  ['-)', { dashed: false, head: 'async', both: false }],
  ['-->', { dashed: true, head: 'open', both: false }],
  ['->', { dashed: false, head: 'open', both: false }],
]

const MESSAGE = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*(?::(.*))?$/
const PARTICIPANT = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i
const FRAME = /^(loop|alt|opt|par|par_over|critical|break|rect|box)\b\s*(.*)$/
const SECTION = /^(else|and|option)\b\s*(.*)$/
const ACTIVATE = /^(activate|deactivate)\s+(.+)$/

const parse = (source: string): Parsed => {
  const lines = sourceLines(source)
  const head = lines.shift() ?? ''
  if (!/^sequenceDiagram\b/.test(head)) throw new Error('not a sequence diagram')
  const parts: Participant[] = []
  const byId = new Map<string, number>()
  let title: string | undefined
  let autonumber = false
  let count = 0

  const who = (raw: string): number => {
    const id = unquote(raw.replace(/@\{.*\}$/, '').trim())
    if (id === '') throw new Error('a message without a participant')
    const known = byId.get(id)
    if (known !== undefined) return known
    parts.push({ id, label: id, actor: false })
    byId.set(id, parts.length - 1)
    return parts.length - 1
  }

  const root: Section = { label: '', items: [] }
  // Open frames; a transparent one (rect, box) passes its items to its parent.
  const stack: { frame: Frame | undefined; section: Section }[] = [{ frame: undefined, section: root }]
  const top = () => stack[stack.length - 1] as { frame: Frame | undefined; section: Section }

  for (const line of lines) {
    let m: RegExpExecArray | null
    if ((m = /^title\s*:?\s*(.*)$/.exec(line))) {
      title = m[1]
      continue
    }
    if (/^autonumber\b/.test(line)) {
      autonumber = true
      continue
    }
    if (/^(destroy|links?|properties|details)\b/.test(line)) continue
    if ((m = PARTICIPANT.exec(line))) {
      const id = unquote((m[2] ?? '').replace(/@\{.*\}$/, '').trim())
      const label = unquote(m[3] ?? id)
      const at = byId.get(id)
      if (at !== undefined) {
        const p = parts[at] as Participant
        p.label = label
        p.actor = m[1]?.toLowerCase() === 'actor'
      } else {
        parts.push({ id, label, actor: m[1]?.toLowerCase() === 'actor' })
        byId.set(id, parts.length - 1)
      }
      continue
    }
    if ((m = NOTE.exec(line))) {
      const names = (m[2] ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
      const ids = names.map(who)
      const pos = (m[1] ?? '').toLowerCase().startsWith('left') ? 'left' : (m[1] ?? '').toLowerCase().startsWith('right') ? 'right' : 'over'
      const a = Math.min(...ids)
      const b = pos === 'over' ? Math.max(...ids) : a
      top().section.items.push({ kind: 'note', pos, a: pos === 'over' ? a : (ids[0] as number), b: pos === 'over' ? b : (ids[0] as number), text: m[3] ?? '' })
      continue
    }
    if ((m = ACTIVATE.exec(line))) {
      top().section.items.push({ kind: 'act', who: who(m[2] ?? ''), on: m[1] === 'activate' })
      continue
    }
    if (line === 'end') {
      if (stack.length <= 1) throw new Error('"end" without a block')
      const done = stack.pop()
      if (done !== undefined && done.frame === undefined) top().section.items.push(...done.section.items)
      continue
    }
    if ((m = SECTION.exec(line)) && top().frame !== undefined) {
      const section: Section = { label: (m[2] ?? '').trim(), items: [] }
      const t = top()
      t.frame?.sections.push(section)
      t.section = section
      continue
    }
    if ((m = FRAME.exec(line)) && !MESSAGE.test(line)) {
      const type = m[1] ?? ''
      const section: Section = { label: (m[2] ?? '').trim(), items: [] }
      if (type === 'rect' || type === 'box') {
        stack.push({ frame: undefined, section })
        continue
      }
      const frame: Frame = { kind: 'frame', type: type === 'par_over' ? 'par' : type, sections: [section] }
      top().section.items.push(frame)
      stack.push({ frame, section })
      continue
    }
    if ((m = MESSAGE.exec(line))) {
      const arrow = ARROWS.find(([k]) => k === m?.[2])?.[1]
      if (arrow === undefined) throw new Error(`unknown arrow in "${line}"`)
      const from = who(m[1] ?? '')
      const to = who(m[4] ?? '')
      const flag = m[3] ?? ''
      let text = (m[5] ?? '').trim()
      if (autonumber) text = `${++count}. ${text}`.trim()
      top().section.items.push({ kind: 'msg', from, to, arrow, text, on: flag === '+', off: flag === '-' })
      continue
    }
    throw new Error(`cannot read "${line}"`)
  }
  if (stack.length > 1) throw new Error('a block is not closed with "end"')
  if (parts.length === 0) throw new Error('no participants')
  return { title, parts, items: root.items }
}

// ---- layout ---------------------------------------------------------------

type Layout = {
  centers: number[]
  labels: Map<object, string[]>
  boxes: { lines: string[]; w: number; left: number }[]
  frames: Map<Frame, [number, number]>
  minX: number
  maxX: number
}

const frameTitle = (f: Frame) => `${f.type} ${f.sections[0]?.label ?? ''}`.trim()

/** The longest word of a label: wrapping keeps words whole unless `breakWords`. */
const longestWord = (text: string) => widest(text.split(/\s+|<br\s*\/?>/i))

const layout = (p: Parsed, limit: number, breakWords: boolean): Layout => {
  const n = p.parts.length
  const labels = new Map<object, string[]>()
  const fit = (text: string) => wrapText(text, breakWords ? limit : Math.max(limit, longestWord(text)))
  const boxes = p.parts.map(part => {
    const lines = fit(part.label)
    const w = widest(lines) + 4
    return { lines, w, left: Math.floor((w - 1) / 2) }
  })
  const half = (i: number) => boxes[i] as { w: number; left: number }
  const need: [number, number, number][] = []
  for (let i = 0; i + 1 < n; i++) need.push([i, i + 1, half(i).w - 1 - half(i).left + half(i + 1).left + 3])

  const walk = (items: readonly Item[]) => {
    for (const it of items) {
      if (it.kind === 'msg') {
        const lines = it.text === '' ? [] : fit(it.text)
        labels.set(it, lines)
        const w = widest(lines)
        if (it.from === it.to) {
          if (it.from + 1 < n) need.push([it.from, it.from + 1, w + 7])
        } else {
          need.push([Math.min(it.from, it.to), Math.max(it.from, it.to), Math.max(w + 4, 6)])
        }
      } else if (it.kind === 'note') {
        const lines = fit(it.text)
        labels.set(it, lines)
        const w = widest(lines) + 4
        if (it.pos === 'right' && it.a + 1 < n) need.push([it.a, it.a + 1, w + 3])
        if (it.pos === 'left' && it.a > 0) need.push([it.a - 1, it.a, w + 3])
        if (it.pos === 'over' && it.b > it.a) need.push([it.a, it.b, w - 5])
      } else if (it.kind === 'frame') {
        for (const s of it.sections) {
          labels.set(s, [s.label])
          walk(s.items)
        }
      }
    }
  }
  walk(p.items)

  const gaps = new Array<number>(Math.max(0, n - 1)).fill(0)
  need.sort((x, y) => x[1] - x[0] - (y[1] - y[0]))
  for (const [a, b, want] of need) {
    let cur = 0
    for (let i = a; i < b; i++) cur += gaps[i] as number
    if (cur >= want) continue
    const extra = want - cur
    const span = b - a
    for (let i = a; i < b; i++) gaps[i] = (gaps[i] as number) + Math.floor(extra / span) + (i === b - 1 ? extra % span : 0)
  }
  const centers = [0]
  for (let i = 0; i + 1 < n; i++) centers.push((centers[i] as number) + (gaps[i] as number))
  const c = (i: number) => centers[i] as number

  let minX = 0
  let maxX = 0
  boxes.forEach((b, i) => {
    minX = Math.min(minX, c(i) - b.left)
    maxX = Math.max(maxX, c(i) - b.left + b.w - 1)
  })

  const frames = new Map<Frame, [number, number]>()
  const extent = (items: readonly Item[]): [number, number] | undefined => {
    let lo = Infinity
    let hi = -Infinity
    const take = (l: number, r: number) => {
      lo = Math.min(lo, l)
      hi = Math.max(hi, r)
    }
    for (const it of items) {
      if (it.kind === 'msg') {
        const w = widest(labels.get(it) ?? [])
        if (it.from === it.to) take(c(it.from), c(it.from) + (w > 0 ? 5 + w : 4))
        else take(c(Math.min(it.from, it.to)), c(Math.max(it.from, it.to)))
      } else if (it.kind === 'note') {
        const w = widest(labels.get(it) ?? []) + 4
        if (it.pos === 'right') take(c(it.a) + 2, c(it.a) + 1 + w)
        else if (it.pos === 'left') take(c(it.a) - 1 - w, c(it.a) - 2)
        else {
          const box = Math.max(w, c(it.b) - c(it.a) + 5)
          const left = Math.floor((c(it.a) + c(it.b)) / 2) - Math.floor((box - 1) / 2)
          take(left, left + box - 1)
        }
      } else if (it.kind === 'act') {
        take(c(it.who), c(it.who))
      } else {
        const inner = it.sections.map(s => extent(s.items)).filter((e): e is [number, number] => e !== undefined)
        let l = inner.length === 0 ? c(0) : Math.min(...inner.map(e => e[0]))
        let r = inner.length === 0 ? c(n - 1) : Math.max(...inner.map(e => e[1]))
        l -= 2
        r += 2
        const titleW = Math.max(width(frameTitle(it)) + 6, ...it.sections.slice(1).map(s => width(`[${s.label}]`) + 6))
        r = Math.max(r, l + titleW)
        frames.set(it, [l, r])
        take(l, r)
      }
      if (lo !== Infinity) {
        minX = Math.min(minX, lo)
        maxX = Math.max(maxX, hi)
      }
    }
    return lo === Infinity ? undefined : [lo, hi]
  }
  extent(p.items)
  return { centers, labels, boxes, frames, minX, maxX }
}

// ---- drawing --------------------------------------------------------------

const draw = (ctx: DiagramContext, p: Parsed, lay: Layout): Line[] => {
  const t = ctx.theme
  const colors = seriesColors(t)
  const colorOf = (i: number) => (ctx.isMono ? undefined : colors[i % Math.max(1, colors.length)])
  const shift = -lay.minX
  const cx = (i: number) => (lay.centers[i] as number) + shift
  const cv = new Canvas()
  const line: Style = t.diagram === undefined ? { dim: true } : { color: t.diagram }
  const text: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const frameLine: Style = t.rule === undefined ? { dim: true } : { color: t.rule }
  const noteLine: Style = ctx.isMono || t.alertWarning === undefined ? { dim: true } : { color: t.alertWarning }
  const n = p.parts.length
  let y = 0
  if (p.title !== undefined && p.title !== '') {
    for (const l of wrapText(p.title, ctx.width)) cv.text(0, y++, l, { bold: true, ...(t.heading === undefined ? {} : { color: t.heading }) })
    y++
  }

  const boxH = 2 + Math.max(...lay.boxes.map(b => b.lines.length))
  const drawBoxes = (y0: number, top: boolean) => {
    lay.boxes.forEach((b, i) => {
      const color = colorOf(i)
      const st: Style = color === undefined ? { bold: true } : { color }
      const actor = p.parts[i]?.actor === true
      const [tl, tr, bl, br] = actor ? ['╭', '╮', '╰', '╯'] : ['┌', '┐', '└', '┘']
      const left = cx(i) - b.left
      const inner = b.w - 2
      cv.text(left, y0, tl + '─'.repeat(inner) + tr, st)
      cv.text(left, y0 + boxH - 1, bl + '─'.repeat(inner) + br, st)
      for (let r = 1; r < boxH - 1; r++) {
        cv.put(left, y0 + r, '│', st)
        cv.put(left + b.w - 1, y0 + r, '│', st)
      }
      const pad = boxH - 2 - b.lines.length
      b.lines.forEach((l, k) => {
        const x = left + 1 + Math.floor((inner - width(l)) / 2)
        cv.text(x, y0 + 1 + Math.floor(pad / 2) + k, l, { bold: true, ...(color === undefined ? {} : { color }) })
      })
      cv.put(cx(i), top ? y0 + boxH - 1 : y0, top ? '┬' : '┴', st)
    })
  }
  drawBoxes(y, true)
  y += boxH
  const bodyTop = y
  y += 1

  const active = new Array<number>(n).fill(0)
  const activeRows: Set<string> = new Set()
  const mark = (y0: number, y1: number) => {
    for (let i = 0; i < n; i++) if ((active[i] as number) > 0) for (let r = y0; r < y1; r++) activeRows.add(`${i}:${r}`)
  }

  const head = (a: Arrow, right: boolean): string => {
    if (a.head === 'arrow') return right ? '►' : '◄'
    if (a.head === 'cross') return '×'
    if (a.head === 'async') return right ? '▷' : '◁'
    return a.dashed ? '╌' : '─'
  }

  const drawItems = (items: readonly Item[]) => {
    for (const it of items) {
      const y0 = y
      if (it.kind === 'act') {
        active[it.who] = Math.max(0, (active[it.who] as number) + (it.on ? 1 : -1))
        continue
      }
      if (it.kind === 'msg') {
        const lines = lay.labels.get(it) ?? []
        const dash = it.arrow.dashed ? '╌' : '─'
        if (it.from === it.to) {
          const x = cx(it.from)
          const rows = Math.max(2, lines.length + 1)
          cv.text(x + 1, y, `${dash}${dash}┐`, line)
          for (let r = 1; r < rows - 1; r++) cv.put(x + 3, y + r, it.arrow.dashed ? '┆' : '│', line)
          cv.text(x + 1, y + rows - 1, `${it.arrow.head === 'open' ? dash : '◄'}${dash}┘`, line)
          lines.forEach((l, k) => cv.text(x + 5, y + k, l, text))
          y += rows
        } else {
          const a = cx(it.from)
          const b = cx(it.to)
          const lo = Math.min(a, b)
          const hi = Math.max(a, b)
          const mid = Math.floor((lo + hi) / 2)
          lines.forEach(l => {
            cv.text(mid - Math.floor(width(l) / 2), y, l, text)
            y++
          })
          for (let x = lo + 1; x < hi; x++) cv.put(x, y, dash, line)
          const right = b > a
          cv.put(right ? hi - 1 : lo + 1, y, head(it.arrow, right), line)
          if (it.arrow.both) cv.put(right ? lo + 1 : hi - 1, y, head(it.arrow, !right), line)
          y++
        }
        mark(y0, y)
        if (it.on) active[it.to] = (active[it.to] as number) + 1
        if (it.off) active[it.from] = Math.max(0, (active[it.from] as number) - 1)
        continue
      }
      if (it.kind === 'note') {
        const lines = lay.labels.get(it) ?? []
        const w = widest(lines) + 4
        let left: number
        let boxW = w
        if (it.pos === 'right') left = cx(it.a) + 2
        else if (it.pos === 'left') left = cx(it.a) - 1 - w
        else {
          boxW = Math.max(w, cx(it.b) - cx(it.a) + 5)
          left = Math.floor((cx(it.a) + cx(it.b)) / 2) - Math.floor((boxW - 1) / 2)
        }
        cv.text(left, y, `╭${'─'.repeat(boxW - 2)}╮`, noteLine)
        lines.forEach((l, k) => {
          cv.put(left, y + 1 + k, '│', noteLine)
          cv.text(left + 1, y + 1 + k, ' '.repeat(boxW - 2), {})
          cv.text(left + 1 + Math.floor((boxW - 2 - width(l)) / 2), y + 1 + k, l, text)
          cv.put(left + boxW - 1, y + 1 + k, '│', noteLine)
        })
        cv.text(left, y + 1 + lines.length, `╰${'─'.repeat(boxW - 2)}╯`, noteLine)
        y += lines.length + 2
        mark(y0, y)
        continue
      }
      // A frame.
      const [l0, r0] = lay.frames.get(it) ?? [0, 0]
      const l = l0 + shift
      const r = r0 + shift
      const rows: number[] = []
      it.sections.forEach((s, k) => {
        const yy = y
        rows.push(yy)
        cv.text(l, yy, (k === 0 ? '┌' : '├') + (k === 0 ? '─' : '┄').repeat(r - l - 1) + (k === 0 ? '┐' : '┤'), frameLine)
        let x = l + 2
        if (k === 0) {
          x = cv.text(x, yy, ` ${it.type} `, { bold: true, ...(t.diagram === undefined ? {} : { color: t.diagram }) })
          if (s.label !== '') x = cv.text(x, yy, `${s.label} `, text)
        } else if (s.label !== '') {
          x = cv.text(x, yy, ` [${s.label}] `, text)
        }
        mark(yy, yy + 1)
        y++
        drawItems(s.items)
      })
      const end = y
      cv.text(l, end, `└${'─'.repeat(r - l - 1)}┘`, frameLine)
      mark(end, end + 1)
      y++
      for (let yy = rows[0] as number; yy < end; yy++) {
        if (rows.includes(yy)) continue
        cv.put(l, yy, '│', frameLine)
        cv.put(r, yy, '│', frameLine)
      }
    }
  }
  drawItems(p.items)
  y += 1
  const bodyEnd = y
  drawBoxes(y, false)

  for (let i = 0; i < n; i++) {
    const color = colorOf(i)
    for (let r = bodyTop; r < bodyEnd; r++) {
      const on = activeRows.has(`${i}:${r}`)
      cv.under(cx(i), r, on ? '┃' : '│', on ? (color === undefined ? { bold: true } : { color }) : { dim: true, ...(color === undefined ? {} : { color }) })
    }
  }
  return cv.lines()
}

const render: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  const p = parse(source)
  const words = [
    ...p.parts.map(x => x.label),
    ...(function* all(items: readonly Item[]): Generator<string> {
      for (const it of items) {
        if (it.kind === 'msg' || it.kind === 'note') yield it.text
        if (it.kind === 'frame') for (const s of it.sections) yield* all(s.items)
      }
    })(p.items),
  ]
  const top = Math.max(6, widest(words.flatMap(splitBr)))
  for (const breakWords of [false, true]) {
    let limit = top
    for (let tries = 0; tries < 60; tries++) {
      const lay = layout(p, limit, breakWords)
      if (lay.maxX - lay.minX + 1 <= ctx.width) return { lines: draw(ctx, p, lay) }
      if (limit <= 6) break
      limit = Math.max(6, Math.min(limit - 1, Math.floor(limit * 0.9)))
    }
  }
  return { error: 'too wide for the window' }
}

export const SEQUENCE_RENDERERS: Record<string, Renderer> = { sequenceDiagram: render }
