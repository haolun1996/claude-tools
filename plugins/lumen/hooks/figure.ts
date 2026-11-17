// ```figure blocks: text pictures drawn line by line as written, with
// `{role:text}` runs in the theme's colors. A figure that would not draw as
// written (an emoji, a wide or invisible character, a tab, broken markup, too
// tall or too wide) is refused with the reason, and stays code.

import type { Line, Run } from './inline'
import { paint, seriesColors } from './mermaid/types'
import type { Theme } from './theme'
import { charWidth, width as textWidth } from './width'

export const MAX_FIGURE_LINES = 80
export const MAX_FIGURE_WIDTH = 100

export const ROLES = ['accent', 'warn', 'ok', 'note', 'dim', 'strong'] as const
export type Role = (typeof ROLES)[number]

export type FigureResult = { lines: Line[] } | { error: string }

// Glyph checks.

/** Symbols that are emoji by the tables but every terminal draws as text. */
const TEXT_SAFE = new Set(['↔', '↕', '↖', '↗', '↘', '↙', '↩', '↪', '©', '®', '™'])
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u
const FORMAT = /\p{Cf}/u
const MARK = /\p{M}/u

const NAMES: Record<number, string> = {
  0x00ad: 'soft hyphen', 0x200b: 'zero-width space', 0x200c: 'zero-width non-joiner', 0x200d: 'zero-width joiner',
  0x200e: 'left-to-right mark', 0x200f: 'right-to-left mark', 0x2060: 'word joiner', 0xfeff: 'byte order mark',
  0x061c: 'Arabic letter mark', 0x202a: 'direction embedding', 0x202b: 'direction embedding', 0x202c: 'direction pop',
  0x202d: 'direction override', 0x202e: 'direction override', 0x2066: 'direction isolate', 0x2067: 'direction isolate',
  0x2068: 'direction isolate', 0x2069: 'direction isolate',
}

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

/** Why a character would not draw as written, or undefined when it draws fine. */
const glyphProblem = (ch: string): string | undefined => {
  const cp = ch.codePointAt(0) ?? 0
  if (ch === '\t') return 'a tab, use spaces'
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return `control character ${hex(cp)}`
  if (cp === 0xfe0f) return `${hex(cp)} (emoji variation selector) may draw an emoji, use a text glyph`
  if (FORMAT.test(ch) || NAMES[cp] !== undefined) return `${hex(cp)} (${NAMES[cp] ?? 'invisible format character'}) draws no column, remove it`
  if (MARK.test(ch)) return `${hex(cp)} (combining mark) draws no column of its own, use a precomposed character`
  if (EMOJI.test(ch) && !TEXT_SAFE.has(ch)) return `"${ch}" may draw as an emoji, use a text glyph`
  if (charWidth(ch) === 2) return `"${ch}" takes two columns, use a one-column glyph`
  return undefined
}

// Colors.

type Rgb = [number, number, number]

const rgbOf = (color: string): Rgb | undefined => {
  const m = /^#([0-9a-f]{6})$/i.exec(color) ?? /^#([0-9a-f]{3})$/i.exec(color)
  if (!m) return undefined
  const h = (m[1] ?? '').length === 3 ? [...(m[1] ?? '')].map(c => c + c).join('') : (m[1] ?? '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

/** Hue in degrees, saturation (HSL) and chroma of a color. */
const hueOf = ([r, g, b]: Rgb): { hue: number; sat: number; chroma: number } => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d === 0) return { hue: 0, sat, chroma: 0 }
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { hue: (hue * 60 + 360) % 360, sat, chroma: d }
}

// Red sits a little toward crimson so an orange is not taken for it.
const TARGET_HUE = { warn: 355, ok: 120, note: 42 } as const
type Signal = keyof typeof TARGET_HUE

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * The reddest, greenest and most amber colors of the theme, each a different
 * one and none the diagram color: the assignment with the least total hue
 * distance (a pale color costs more) among the theme's hex colors. A grayish
 * color is not a candidate.
 */
export const signalColors = (theme: Theme): Partial<Record<Signal, string>> => {
  const pool = [...seriesColors(theme), theme.diffRemoved, theme.diffAdded, theme.alertWarning, theme.number]
  const diagram = theme.diagram?.toLowerCase()
  const candidates = [...new Set(pool.filter((c): c is string => c !== undefined).map(c => c.toLowerCase()))]
    .filter(c => c !== diagram)
    .flatMap(c => {
      const rgb = rgbOf(c)
      if (rgb === undefined) return []
      const { hue, sat, chroma } = hueOf(rgb)
      return sat < 0.15 ? [] : [{ color: c, hue, chroma }]
    })
  // A pale color reads less as its hue: the pastel rose of a theme is not its red.
  const cost = (c: { hue: number; chroma: number } | undefined, s: Signal) =>
    c === undefined ? 400 : hueDistance(c.hue, TARGET_HUE[s]) + (1 - c.chroma) * 60
  const options = [undefined, ...candidates]
  type Candidate = (typeof candidates)[number]
  let bestPick: [Candidate | undefined, Candidate | undefined, Candidate | undefined] = [undefined, undefined, undefined]
  let bestCost = Infinity
  for (const w of options) {
    for (const o of options) {
      if (o !== undefined && o === w) continue
      for (const n of options) {
        if (n !== undefined && (n === w || n === o)) continue
        const total = cost(w, 'warn') + cost(o, 'ok') + cost(n, 'note')
        if (total < bestCost) {
          bestCost = total
          bestPick = [w, o, n]
        }
      }
    }
  }
  const [w, o, n] = bestPick
  return {
    ...(w ? { warn: w.color } : {}),
    ...(o ? { ok: o.color } : {}),
    ...(n ? { note: n.color } : {}),
  }
}

// Markup.

type Piece = { text: string; role?: Role }

const ROLE_SET: ReadonlySet<string> = new Set(ROLES)
const OPENER = /^\{([A-Za-z][A-Za-z0-9_-]*):/

/** A line split into runs by role, or the reason its markup is broken. */
const parseLine = (line: string): Piece[] | string => {
  const pieces: Piece[] = []
  let plain = ''
  let open: { role: Role; text: string } | undefined
  let i = 0
  while (i < line.length) {
    const rest = line.slice(i)
    const opener = OPENER.exec(rest)
    if (opener) {
      const name = opener[1] ?? ''
      const isRole = ROLE_SET.has(name)
      const lower = name.toLowerCase()
      if (!isRole && ROLE_SET.has(lower)) return `role "{${name}:" is in the wrong case, write {${lower}:`
      if (!isRole) return `unknown role "{${name}:", use one of ${ROLES.join(', ')}`
      if (open !== undefined) return `{${name}: is nested inside {${open.role}:, close the first role before opening another`
      if (plain !== '') pieces.push({ text: plain })
      plain = ''
      open = { role: name as Role, text: '' }
      i += opener[0].length
      continue
    }
    const ch = line[i] as string
    if (ch === '}' && open !== undefined) {
      pieces.push({ text: open.text, role: open.role })
      open = undefined
      i++
      continue
    }
    if (open !== undefined) open.text += ch
    else plain += ch
    i++
  }
  if (open !== undefined) return `{${open.role}: is left open, close it with }`
  if (plain !== '') pieces.push({ text: plain })
  return pieces
}

const ARROWS: Record<string, string> = { '▶': '►', '◀': '◄' }

/** Draws a figure block, or says why it stays code. */
export const drawFigure = (theme: Theme, isMono: boolean, source: string, width: number): FigureResult => {
  const raw = source.replace(/\r\n?/g, '\n').split('\n')
  while (raw.length > 0 && (raw[raw.length - 1] ?? '').trim() === '') raw.pop()
  if (raw.length === 0) return { error: 'figure: the block is empty' }
  if (raw.length > MAX_FIGURE_LINES) return { error: `figure: ${raw.length} lines, more than ${MAX_FIGURE_LINES}` }
  const limit = Math.min(width, MAX_FIGURE_WIDTH)
  const signals = isMono ? {} : signalColors(theme)

  const colorOf = (role: Role | undefined): Omit<Run, 'text'> => {
    const c = (color: string | undefined, extra: Omit<Run, 'text' | 'color'> = {}) => paint('', isMono ? undefined : color, extra)
    switch (role) {
      case undefined: return c(theme.diagramText)
      case 'accent': return c(theme.diagram)
      case 'dim': return c(theme.codeComment, isMono || theme.codeComment === undefined ? { dim: true } : {})
      case 'strong': return c(theme.strong, { bold: true })
      case 'warn': return c(signals.warn ?? theme.diffRemoved, isMono ? { bold: true } : {})
      case 'ok': return c(signals.ok ?? theme.diffAdded)
      case 'note': return c(signals.note ?? theme.alertWarning)
    }
  }

  const lines: Line[] = []
  for (let n = 0; n < raw.length; n++) {
    const text = [...(raw[n] ?? '')].map(ch => ARROWS[ch] ?? ch).join('')
    const where = `figure line ${n + 1}`
    for (const ch of text) {
      const problem = glyphProblem(ch)
      if (problem !== undefined) return { error: `${where}: ${problem}` }
    }
    const pieces = parseLine(text)
    if (typeof pieces === 'string') return { error: `${where}: ${pieces}` }
    const cols = textWidth(pieces.map(p => p.text).join(''))
    if (cols > limit) {
      return { error: `${where}: ${cols} columns, wider than ${width < MAX_FIGURE_WIDTH ? `the window (${width})` : `${MAX_FIGURE_WIDTH}`}` }
    }
    lines.push(pieces.filter(p => p.text !== '').map(p => ({ ...colorOf(p.role), text: p.text })))
  }
  return { lines }
}
