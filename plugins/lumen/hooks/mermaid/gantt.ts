// Gantt charts: task bars on one shared time axis, section names over their
// tasks, task names in a left column. A bar starts on a half cell and ends on
// an eighth so close durations draw apart. Dates are read by hand from the
// dateFormat into minute counts: no clock, no time zone.

import type { DiagramContext, DiagramResult, Renderer } from './types'
import { seriesColors } from './types'
import { Canvas, LEFT_EIGHTHS, type Style, ellipsis, sourceLines, widest, wrapText } from './chart-util'
import { width } from '../width'

// ---- dates ----------------------------------------------------------------

const DAY = 1440

/** Days since 1970-01-01 of a civil date (proleptic Gregorian). */
export const daysFromCivil = (y0: number, m: number, d: number): number => {
  const y = m <= 2 ? y0 - 1 : y0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export const civilFromDays = (z0: number): { y: number; m: number; d: number } => {
  const z = z0 + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}

const TOKENS = /YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|X|x|A|a|\[[^\]]*\]|./g

/** Reads `text` by a dayjs-style format into minutes since 1970-01-01 00:00; undefined when it does not match. */
export const parseDate = (text: string, format: string): number | undefined => {
  const s = text.trim()
  let i = 0
  let y = 1970
  let mo = 1
  let d = 1
  let h = 0
  let mi = 0
  let sec = 0
  let pm: boolean | undefined
  let epoch: number | undefined
  const digits = (min: number, max: number): number | undefined => {
    let j = i
    while (j < s.length && j - i < max && /[0-9]/.test(s[j] as string)) j++
    if (j - i < min) return undefined
    const v = Number(s.slice(i, j))
    i = j
    return v
  }
  for (const tok of format.match(TOKENS) ?? []) {
    let v: number | undefined
    switch (tok) {
      case 'YYYY': v = digits(4, 4); if (v !== undefined) y = v; break
      case 'YY': v = digits(2, 2); if (v !== undefined) y = 2000 + v; break
      case 'MM': case 'M': v = digits(tok.length, 2); if (v !== undefined) mo = v; break
      case 'DD': case 'D': v = digits(tok.length, 2); if (v !== undefined) d = v; break
      case 'HH': case 'H': case 'hh': case 'h': v = digits(tok.length, 2); if (v !== undefined) h = v; break
      case 'mm': case 'm': v = digits(tok.length, 2); if (v !== undefined) mi = v; break
      case 'ss': case 's': v = digits(tok.length, 2); if (v !== undefined) sec = v; break
      case 'SSS': v = digits(1, 3); break
      case 'X': case 'x': {
        const m = /^-?\d+(\.\d+)?/.exec(s.slice(i))
        if (m === null) return undefined
        i += m[0].length
        epoch = Number(m[0]) / (tok === 'X' ? 60 : 60000)
        v = 0
        break
      }
      case 'A': case 'a': {
        const m = /^(am|pm)/i.exec(s.slice(i))
        if (m === null) return undefined
        pm = m[0].toLowerCase() === 'pm'
        i += 2
        v = 0
        break
      }
      default: {
        const lit = tok.startsWith('[') && tok.length > 1 ? tok.slice(1, -1) : tok
        if (s.slice(i, i + lit.length) !== lit) return undefined
        i += lit.length
        v = 0
      }
    }
    if (v === undefined) return undefined
  }
  if (i !== s.length) return undefined
  if (epoch !== undefined) return epoch
  if (pm !== undefined) h = (h % 12) + (pm ? 12 : 0)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || sec > 59) return undefined
  return daysFromCivil(y, mo, d) * DAY + h * 60 + mi + sec / 60
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|M|y)$/
const UNIT: Record<string, number> = { ms: 1 / 60000, s: 1 / 60, m: 1, h: 60, d: DAY, w: 7 * DAY, M: 30 * DAY, y: 365 * DAY }

export const parseDuration = (text: string): number | undefined => {
  const m = DURATION.exec(text.trim())
  if (m === null) return undefined
  return Number(m[1]) * (UNIT[m[2] ?? ''] ?? 0)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Formats minutes by a d3 time format (%Y-%m-%d, %b %d, %H:%M ...). */
export const formatTime = (t: number, format: string): string => {
  const days = Math.floor(t / DAY)
  const { y, m, d } = civilFromDays(days)
  const mins = Math.round(t - days * DAY)
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  const wd = (((days + 4) % 7) + 7) % 7
  const p2 = (n: number) => String(n).padStart(2, '0')
  return format.replace(/%-?([a-zA-Z%])/g, (all, k: string) => {
    const plain = all.startsWith('%-')
    switch (k) {
      case 'Y': return String(y)
      case 'y': return p2(y % 100)
      case 'm': return plain ? String(m) : p2(m)
      case 'd': return plain ? String(d) : p2(d)
      case 'e': return String(d).padStart(2, ' ')
      case 'H': return plain ? String(hh) : p2(hh)
      case 'I': return p2(((hh + 11) % 12) + 1)
      case 'p': return hh < 12 ? 'AM' : 'PM'
      case 'M': return p2(mm)
      case 'S': return '00'
      case 'b': return MONTHS[m - 1] ?? ''
      case 'B': return MONTHS_LONG[m - 1] ?? ''
      case 'a': return DAYS[wd] ?? ''
      case 'A': return DAYS_LONG[wd] ?? ''
      case 'j': return String(days - daysFromCivil(y, 1, 1) + 1).padStart(3, '0')
      case '%': return '%'
      default: return all
    }
  })
}

// ---- parsing --------------------------------------------------------------

type Tag = 'done' | 'active' | 'crit' | 'milestone'

type RawTask = {
  name: string
  section: number
  tags: Set<Tag>
  id: string | undefined
  start: string | undefined
  end: string
}

type Task = { name: string; section: number; tags: Set<Tag>; start: number; end: number }

type Gantt = { title: string | undefined; axisFormat: string | undefined; sections: string[]; tasks: Task[] }

const TAGS = new Set<string>(['done', 'active', 'crit', 'milestone'])

const parse = (source: string): Gantt => {
  const lines = sourceLines(source)
  const head = lines.shift() ?? ''
  if (!/^gantt\b/.test(head)) throw new Error('not a gantt chart')
  let title: string | undefined
  let dateFormat = 'YYYY-MM-DD'
  let axisFormat: string | undefined
  const sections: string[] = []
  const raw: RawTask[] = []
  for (const line of lines) {
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(line))) title = m[1]
    else if ((m = /^dateFormat\s+(.+)$/.exec(line))) dateFormat = (m[1] ?? '').trim()
    else if ((m = /^axisFormat\s+(.+)$/.exec(line))) axisFormat = (m[1] ?? '').trim()
    else if (/^(excludes|includes|todayMarker|tickInterval|weekday|weekend|inclusiveEndDates|topAxis|displayMode)\b/.test(line)) continue
    else if ((m = /^section\s+(.*)$/.exec(line))) sections.push((m[1] ?? '').trim())
    else {
      const colon = line.indexOf(':')
      if (colon <= 0) throw new Error(`cannot read "${line}"`)
      const name = line.slice(0, colon).trim()
      const items = line.slice(colon + 1).split(',').map(s => s.trim()).filter(s => s !== '')
      const tags = new Set<Tag>()
      while (items.length > 0 && TAGS.has(items[0] as string)) tags.add(items.shift() as Tag)
      let id: string | undefined
      let start: string | undefined
      let end = ''
      const startLike = (s: string) => /^after\s/.test(s) || parseDate(s, dateFormat) !== undefined
      if (items.length >= 3) [id, start, end] = items as [string, string, string]
      else if (items.length === 2) {
        if (startLike(items[0] as string)) [start, end] = items as [string, string]
        else [id, end] = items as [string, string]
      } else if (items.length === 1) end = items[0] as string
      else end = tags.has('milestone') ? '0d' : '1d'
      raw.push({ name, section: Math.max(0, sections.length - 1), tags, id, start, end })
    }
  }
  if (raw.length === 0) throw new Error('no tasks')

  // Resolve starts and ends: a task may follow one defined later.
  const byId = new Map<string, number>()
  raw.forEach((r, i) => r.id !== undefined && byId.set(r.id, i))
  const done = new Map<number, { start: number; end: number }>()
  const busy = new Set<number>()
  const date = (s: string) => parseDate(s, dateFormat) ?? parseDate(s, 'YYYY-MM-DD') ?? parseDate(s, 'YYYY-MM-DD HH:mm')
  const resolve = (i: number): { start: number; end: number } => {
    const known = done.get(i)
    if (known !== undefined) return known
    if (busy.has(i)) throw new Error('tasks wait on each other')
    busy.add(i)
    const r = raw[i] as RawTask
    let start: number
    if (r.start === undefined) start = i === 0 ? (date(r.end) ?? 0) : resolve(i - 1).end
    else if (/^after\s/.test(r.start)) {
      const ids = r.start.replace(/^after\s+/, '').split(/\s+/).filter(s => s !== '')
      const ends = ids.map(id => {
        const at = byId.get(id)
        if (at === undefined) throw new Error(`no task "${id}"`)
        return resolve(at).end
      })
      start = Math.max(...ends)
    } else {
      const d = date(r.start)
      if (d === undefined) throw new Error(`"${r.start}" is not a ${dateFormat} date`)
      start = d
    }
    let end: number
    const dur = parseDuration(r.end)
    if (dur !== undefined) end = start + dur
    else if (/^until\s/.test(r.end)) {
      const at = byId.get(r.end.replace(/^until\s+/, '').trim())
      if (at === undefined) throw new Error(`no task "${r.end}"`)
      end = resolve(at).start
    } else {
      const d = date(r.end)
      if (d === undefined) throw new Error(`"${r.end}" is not a date or duration`)
      end = d
    }
    if (r.start === undefined && i === 0 && dur === undefined) start = end
    const out = { start, end: Math.max(start, end) }
    busy.delete(i)
    done.set(i, out)
    return out
  }
  const tasks = raw.map((r, i) => ({ name: r.name, section: r.section, tags: r.tags, ...resolve(i) }))
  return { title, axisFormat, sections, tasks }
}

// ---- ticks ----------------------------------------------------------------

const STEPS = [1, 5, 10, 15, 30, 60, 120, 180, 360, 720, DAY, 2 * DAY, 7 * DAY, 14 * DAY]
const MONTH_STEPS = [1, 2, 3, 6, 12]

type Ticks = { at: number[]; format: string }

const ticksFor = (t0: number, t1: number, cols: number, axisFormat: string | undefined): Ticks => {
  const range = t1 - t0
  const scale = cols / range
  const spansDays = Math.floor(t0 / DAY) !== Math.floor((t1 - 1e-9) / DAY)
  const formatFor = (step: number) =>
    axisFormat ?? (step < DAY ? (spansDays ? '%m-%d %H:%M' : '%H:%M') : step >= 28 * DAY ? '%b %Y' : '%b %d')
  const fits = (at: number[], format: string) => {
    const w = widest(at.map(t => formatTime(t, format)))
    for (let i = 1; i < at.length; i++) if (((at[i] as number) - (at[i - 1] as number)) * scale < w + 2) return false
    return true
  }
  for (const step of STEPS) {
    const at: number[] = []
    // Weeks start on Monday (1970-01-05 was one).
    const base = step >= 7 * DAY ? 4 * DAY : 0
    for (let t = base + Math.ceil((t0 - base) / step - 1e-9) * step; t <= t1 + 1e-9; t += step) at.push(t)
    if (at.length > 0 && fits(at, formatFor(step))) return { at, format: formatFor(step) }
  }
  for (const months of MONTH_STEPS) {
    const at: number[] = []
    const first = civilFromDays(Math.floor(t0 / DAY))
    let y = first.y
    let m = first.m
    if (daysFromCivil(y, m, 1) * DAY < t0) m++
    while (true) {
      while (m > 12) {
        m -= 12
        y++
      }
      const t = daysFromCivil(y, m, 1) * DAY
      if (t > t1) break
      if ((m - 1) % months === 0 || months === 1) at.push(t)
      m += 1
    }
    const format = axisFormat ?? '%b %Y'
    if (fits(at, format)) return { at, format }
  }
  return { at: [t0], format: formatFor(range) }
}

// ---- drawing --------------------------------------------------------------

/** The cells of a bar from column `s` to `e` (fractional): starts on a half, ends on an eighth. */
const barCells = (s: number, e: number): [number, string][] => {
  const s2 = Math.round(s * 2) / 2
  let e8 = Math.round(e * 8) / 8
  if (e8 <= s2) e8 = s2 + 0.125
  const out: [number, string][] = []
  for (let c = Math.floor(s2); c < Math.ceil(e8); c++) {
    const cs = Math.max(s2, c) - c
    const ce = Math.min(e8, c + 1) - c
    if (cs >= 0.5) out.push([c, '▐'])
    else out.push([c, ce >= 1 ? '█' : (LEFT_EIGHTHS[Math.max(1, Math.round(ce * 8))] ?? '█')])
  }
  return out
}

const render: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  const g = parse(source)
  const t = ctx.theme
  const colors = ctx.isMono ? [] : seriesColors(t)
  const textStyle: Style = t.diagramText === undefined ? {} : { color: t.diagramText }
  const axisStyle: Style = t.diagram === undefined ? { dim: true } : { color: t.diagram }
  const ruleStyle: Style = t.rule === undefined ? { dim: true } : { color: t.rule, dim: true }
  const numStyle: Style = t.number === undefined ? {} : { color: t.number }
  const critColor = ctx.isMono ? undefined : (t.alertCaution ?? t.diffRemoved)
  const hasSections = g.sections.length > 0
  const indent = hasSections ? 2 : 0
  const nameW = Math.min(widest(g.tasks.map(x => x.name)) + indent, Math.max(8, Math.floor(ctx.width * 0.35)))
  const x0 = nameW + 2
  const W = ctx.width - x0 - 1
  if (W < 10) return { error: 'too narrow' }
  const t0 = Math.min(...g.tasks.map(x => x.start))
  let t1 = Math.max(...g.tasks.map(x => x.end))
  if (t1 <= t0) t1 = t0 + DAY
  const scale = W / (t1 - t0)
  const ticks = ticksFor(t0, t1, W, g.axisFormat)
  const colOf = (tm: number) => (tm - t0) * scale

  const cv = new Canvas()
  let y = 0
  if (g.title !== undefined) {
    for (const l of wrapText(g.title, ctx.width)) cv.text(0, y++, l, { bold: true, ...(t.heading === undefined ? {} : { color: t.heading }) })
    y++
  }
  const top = y
  let section = -1
  const headers = new Set<number>()
  g.tasks.forEach(task => {
    if (hasSections && task.section !== section) {
      section = task.section
      const color = colors[section % Math.max(1, colors.length)]
      headers.add(y)
      cv.text(0, y++, ellipsis(g.sections[section] ?? '', ctx.width), { bold: true, ...(color === undefined ? {} : { color }) })
    }
    const color = colors[Math.max(0, task.section) % Math.max(1, colors.length)]
    const crit = task.tags.has('crit')
    const st: Style = {
      ...(crit ? (critColor === undefined ? { bold: true } : { color: critColor }) : color === undefined ? {} : { color }),
      ...(task.tags.has('done') ? { dim: true } : {}),
      ...(task.tags.has('active') ? { bold: true } : {}),
    }
    cv.text(indent, y, ellipsis(task.name, nameW - indent), task.tags.has('done') ? { ...textStyle, dim: true } : textStyle)
    if (task.tags.has('milestone')) {
      const c = Math.min(W - 1, Math.max(0, Math.round(colOf((task.start + task.end) / 2) - 0.5)))
      cv.put(x0 + c, y, '◆', { ...st, bold: true })
    } else {
      for (const [c, ch] of barCells(colOf(task.start), colOf(task.end))) if (c < W) cv.put(x0 + c, y, ch, st)
    }
    y++
  })
  const bottom = y
  // Gridlines at the ticks, under the bars, and the axis with its labels.
  cv.text(x0, bottom, '─'.repeat(W), axisStyle)
  let lastEnd = -1
  for (const tm of ticks.at) {
    const c = Math.min(W - 1, Math.round(colOf(tm)))
    for (let r = top; r < bottom; r++) if (!headers.has(r)) cv.under(x0 + c, r, '┊', ruleStyle)
    cv.put(x0 + c, bottom, '┬', axisStyle)
    const label = formatTime(tm, ticks.format)
    const lx = Math.min(ctx.width - width(label), x0 + c)
    if (lx > lastEnd) {
      cv.text(lx, bottom + 1, label, numStyle)
      lastEnd = lx + width(label)
    }
  }
  return { lines: cv.lines() }
}

export const GANTT_RENDERERS: Record<string, Renderer> = { gantt: render }
