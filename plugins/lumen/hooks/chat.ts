// The chat's look: bubbles and frames around prompts and replies, the clock,
// and durations.

import type { Line, Run } from './inline'
import type { Clock } from './options'
import { lineWidth, padLine } from './wrap'

const colorOf = (color: string | undefined): Omit<Run, 'text'> => (color === undefined ? {} : { color })

/** Gives runs without a background the fill, and pads each line to `inner` with it. */
const filled = (lines: Line[], inner: number, fill: string | undefined): Line[] =>
  lines.map(l => {
    const withBg = fill === undefined ? l : l.map(r => (r.bg === undefined ? { ...r, bg: fill } : r))
    return padLine(withBg, inner, fill === undefined ? {} : { bg: fill })
  })

/** A rounded frame around lines, filled inside when `fill` is given. */
export const bubble = (lines: Line[], inner: number, border: string | undefined, fill: string | undefined): Line[] => {
  const b = { ...colorOf(border), ...(border === undefined ? { dim: true } : {}) }
  const pad: Run = { text: ' ', ...(fill !== undefined ? { bg: fill } : {}) }
  return [
    [{ ...b, text: `╭${'─'.repeat(inner + 2)}╮` }],
    ...filled(lines, inner, fill).map(l => [{ ...b, text: '│' }, pad, ...l, pad, { ...b, text: '│' }]),
    [{ ...b, text: `╰${'─'.repeat(inner + 2)}╯` }],
  ]
}

/** Lines on a fill to the edge, with half blocks as soft top and bottom edges. */
export const solid = (lines: Line[], inner: number, fill: string): Line[] => {
  const edge = (top: boolean): Line => [{ text: (top ? '▄' : '▀').repeat(inner + 2), color: fill }]
  const pad: Run = { text: ' ', bg: fill }
  return [edge(true), ...filled(lines, inner, fill).map(l => [pad, ...l, pad]), edge(false)]
}

/** The widest line, at least `min`. */
export const widest = (lines: readonly Line[], min = 1) => Math.max(min, ...lines.map(lineWidth))

/** "6m 20s", "1h 5m", "42s", "850ms". */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A time of day as the clock option reads it, in the user's time zone (`offsetMinutes`
 * east of UTC); a time from another day than `now` gets its date.
 */
export const formatTime = (at: number, now: number, offsetMinutes: number, clock: Exclude<Clock, 'off'>): string => {
  const local = new Date(at + offsetMinutes * 60_000)
  const today = new Date(now + offsetMinutes * 60_000)
  const h = local.getUTCHours()
  const m = String(local.getUTCMinutes()).padStart(2, '0')
  const time = clock === '24h' ? `${String(h).padStart(2, '0')}:${m}` : `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
  const sameDay = local.getUTCFullYear() === today.getUTCFullYear() && local.getUTCMonth() === today.getUTCMonth() && local.getUTCDate() === today.getUTCDate()
  return sameDay ? time : `${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()} ${time}`
}

/** "+0800" or "-0530" to minutes east of UTC. */
export const parseOffset = (text: string): number => {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}
