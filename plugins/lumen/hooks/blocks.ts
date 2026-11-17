// Blocks to lines: every block is drawn as styled text lines at a width, so
// quotes, lists and alerts can frame whatever they hold.

import { inline } from './inline'
import type { Line, Run } from './inline'
import type { AlertKind, Block, ListItem } from './markdown'
import type { Style } from './options'
import { drawFigure } from './figure'
import { drawMermaid } from './mermaid'
import { codeLine } from './shell'
import { drawTable } from './table'
import { hardWrap, lineWidth, padLine, wrap } from './wrap'

const MIN_WIDTH = 8

const colored = (color: string | undefined, extra: Omit<Run, 'text'> = {}) => (color === undefined ? extra : { ...extra, color })

/** Gives every run without a color the default one, and adds marks to all. */
const tint = (lines: Line[], color: string | undefined, marks: Omit<Run, 'text' | 'color'> = {}): Line[] =>
  lines.map(l => l.map(r => ({ ...r, ...marks, ...(r.color === undefined && color !== undefined ? { color } : {}) })))

const prefix = (lines: Line[], first: Run[], rest: Run[]): Line[] =>
  lines.map((l, n) => [...(n === 0 ? first : rest), ...l])

const frame = (lines: Line[], inner: number, border: Omit<Run, 'text'>, title?: Run[]): Line[] => {
  // The whole frame is inner + 4 wide: "╭─ " title " " dashes "╮".
  const dashes = title === undefined ? 0 : Math.max(1, inner - lineWidth(title) - 1)
  const top: Line = title === undefined
    ? [{ ...border, text: `╭${'─'.repeat(inner + 2)}╮` }]
    : [{ ...border, text: '╭─ ' }, ...title, { ...border, text: ` ${'─'.repeat(dashes)}╮` }]
  return [
    top,
    ...lines.map(l => [{ ...border, text: '│ ' }, ...padLine(l, inner), { ...border, text: ' │' }]),
    [{ ...border, text: `╰${'─'.repeat(inner + 2)}╯` }],
  ]
}

const heading = (style: Style, level: number, text: string, width: number): Line[] => {
  const t = style.theme
  const color = level <= 2 ? t.heading : t.accent
  const look = style.headingStyle
  const shown = look === 'uppercase' && level === 1 ? text.toUpperCase() : text
  const underline = look === 'underline' && level <= 2
  const runs = inline(style, shown, { text: '', bold: true, ...(underline ? { underline: true } : {}), ...colored(color) })

  if (look === 'banner' && level === 1) {
    const inner = Math.max(1, width - 4)
    const lines = wrap(runs, inner)
    const w = Math.max(...lines.map(lineWidth))
    return frame(lines, w, colored(color))
  }
  const lines = wrap(runs, width)
  if (look === 'banner' && level === 2) {
    const w = Math.min(width, Math.max(...lines.map(lineWidth)))
    return [...lines, [{ text: '━'.repeat(w), ...colored(color) }]]
  }
  return lines
}

const ASCII: Record<string, string> = {
  '─': '-', '━': '=', '═': '=', '┄': '-', '╌': '-', '│': '|', '┃': '|', '║': '|', '┆': ':', '╎': ':',
  '┌': '+', '┐': '+', '└': '+', '┘': '+', '╭': '+', '╮': '+', '╰': '+', '╯': '+', '├': '+', '┤': '+', '┬': '+',
  '┴': '+', '┼': '+', '╞': '+', '╡': '+', '╪': '+', '►': '>', '◄': '<', '▲': '^', '▼': 'v',
}
const asciiLines = (lines: Line[]): Line[] =>
  lines.map(l => l.map(r => ({ ...r, text: [...r.text].map(ch => ASCII[ch] ?? ch).join('') })))

/** A note above a block kept as code, saying why it was not drawn. */
const keptNote = (style: Style, what: string, why: string): Line => [
  { text: `${what} kept as code: ${why}`, dim: true, ...(style.theme.codeComment !== undefined ? { color: style.theme.codeComment } : {}) },
]

/** A ```mermaid, ```figure or ```math block drawn as a picture, or undefined to keep it as code. */
const picture = (style: Style, lang: string, text: string, width: number, isOpen: boolean): Line[] | undefined => {
  if (isOpen) return undefined
  if (lang === 'figure') {
    const drawn = drawFigure(style.theme, style.isMono, text, width)
    return 'lines' in drawn ? drawn.lines : [keptNote(style, 'figure', drawn.error), ...code(style, 'figure', text, width, true)]
  }
  if (lang === 'mermaid' && style.mermaid) {
    const drawn = drawMermaid({ theme: style.theme, width, isMono: style.isMono, pieStyle: style.pieStyle }, text)
    if ('lines' in drawn) return style.mermaidAscii ? asciiLines(drawn.lines) : drawn.lines
    return [keptNote(style, 'diagram', drawn.error), ...code(style, 'mermaid', text, width, true)]
  }
  if (lang === 'math' || lang === 'latex' || lang === 'tex') {
    const formula = style.formulas?.get(text.trim())
    if (formula !== undefined) {
      return [[{ text: '', image: { ...formula, alt: text.trim() } }], ...Array.from({ length: formula.rows - 1 }, () => [] as Line)]
    }
  }
  return undefined
}

const code = (style: Style, lang: string, text: string, width: number, asCode = false): Line[] => {
  if (!asCode) {
    const drawn = picture(style, lang, text, width, false)
    if (drawn !== undefined) return drawn
  }
  const t = style.theme
  const raw = text.replace(/\n$/, '').split('\n').map(l => codeLine(t, lang, l.replace(/\t/g, '    ')))
  const fill = t.codeFill
  const look = fill === undefined && style.codeStyle === 'filled' ? 'framed' : fill === undefined && style.codeStyle === 'card' ? 'framed' : style.codeStyle
  const border = colored(t.codeBorder, t.codeBorder === undefined ? { dim: true } : {})

  if (look === 'plain') {
    const inner = Math.max(MIN_WIDTH, width - 2)
    return prefix(raw.flatMap(l => hardWrap(l, inner)), [{ text: '  ' }], [{ text: '  ' }])
  }

  const room = Math.max(MIN_WIDTH, width - 4)
  const lines = raw.flatMap(l => hardWrap(l, room))
  const inner = Math.min(room, Math.max(20, ...lines.map(lineWidth)))

  if (look === 'framed') return frame(lines, inner, border)

  const bg = { bg: fill as string }
  const filledRow = (l: Line): Line => [{ ...bg, text: ' ' }, ...padLine(l.map(r => ({ ...r, ...bg })), inner, bg), { ...bg, text: ' ' }]
  const blank: Line = [{ ...bg, text: ' '.repeat(inner + 2) }]
  if (look === 'filled') return [blank, ...lines.map(filledRow), blank]

  // card: the frame, filled inside.
  return [
    [{ ...border, text: `╭${'─'.repeat(inner + 2)}╮` }],
    ...[blank, ...lines.map(filledRow), blank].map(l => [{ ...border, text: '│' }, ...l, { ...border, text: '│' }]),
    [{ ...border, text: `╰${'─'.repeat(inner + 2)}╯` }],
  ]
}

const DOTS = ['•', '◦']

const taskGlyph = (style: Style, task: 'todo' | 'done'): string => {
  switch (style.taskStyle) {
    case 'ticks':
    case 'progress':
      return task === 'done' ? '✓' : '○'
    case 'box':
      return task === 'done' ? '✓' : '□'
    default:
      return task === 'done' ? '[✓]' : '[ ]'
  }
}

const list = (style: Style, ordered: boolean, start: number, items: readonly ListItem[], width: number, depth: number): Line[] => {
  const t = style.theme
  const out: Line[] = []
  const tasks = items.filter(i => i.task !== undefined)
  if (style.taskStyle === 'progress' && tasks.length > 0 && depth === 0) {
    const done = tasks.filter(i => i.task === 'done').length
    const filled = Math.round((done / tasks.length) * 20)
    out.push([
      { text: '━'.repeat(filled), ...colored(t.accent) },
      { text: '─'.repeat(20 - filled), ...colored(t.bullet), dim: true },
      { text: ` ${done}/${tasks.length} done`, ...colored(t.bullet) },
    ])
  }
  const numberWidth = String(start + items.length - 1).length + 1
  items.forEach((item, n) => {
    const marker = item.task !== undefined
      ? taskGlyph(style, item.task)
      : ordered
        ? `${start + n}.`.padStart(numberWidth)
        : style.listMarker === 'dash'
          ? '-'
          : (DOTS[depth % DOTS.length] as string)
    const markerColor = item.task === 'done' ? t.accent : t.bullet
    const lead = `${marker} `
    const room = Math.max(MIN_WIDTH, width - lead.length)
    let body = drawBlocks(style, item.blocks, room, depth + 1, true)
    if (item.task === 'done') body = tint(body, undefined, { dim: true, strike: true })
    if (body.length === 0) body = [[]]
    out.push(...prefix(body, [{ text: lead, ...colored(markerColor) }], [{ text: ' '.repeat(lead.length) }]))
  })
  return out
}

const ALERTS: Record<AlertKind, { label: string; token: 'alertNote' | 'alertTip' | 'alertImportant' | 'alertWarning' | 'alertCaution' }> = {
  note: { label: 'Note', token: 'alertNote' },
  tip: { label: 'Tip', token: 'alertTip' },
  important: { label: 'Important', token: 'alertImportant' },
  warning: { label: 'Warning', token: 'alertWarning' },
  caution: { label: 'Caution', token: 'alertCaution' },
}

const alert = (style: Style, kind: AlertKind, blocks: Block[], width: number, depth: number): Line[] => {
  const { label, token } = ALERTS[kind]
  const color = style.theme[token]
  const inner = Math.max(MIN_WIDTH, width - 4)
  const body = drawBlocks(style, blocks, inner, depth + 1)
  return frame(body, inner, colored(color), [{ text: label, bold: true, ...colored(color) }])
}

const quote = (style: Style, blocks: Block[], width: number, depth: number): Line[] => {
  const t = style.theme
  const body = tint(drawBlocks(style, blocks, Math.max(MIN_WIDTH, width - 2), depth + 1), t.quote)
  const bar: Run = { text: '▎ ', ...colored(t.accent) }
  return (body.length === 0 ? [[]] : body).map(l => [bar, ...l])
}

const drawBlock = (style: Style, block: Block, width: number, depth: number): Line[] => {
  const t = style.theme
  switch (block.kind) {
    case 'paragraph':
      return wrap(inline(style, block.text), width)
    case 'heading':
      return heading(style, block.level, block.text, width)
    case 'code':
      return block.isOpen ? code(style, block.lang, block.text, width, true) : code(style, block.lang, block.text, width)
    case 'list':
      return list(style, block.ordered, block.start, block.items, width, depth)
    case 'quote':
      return quote(style, block.blocks, width, depth)
    case 'alert':
      return alert(style, block.alert, block.blocks, width, depth)
    case 'table':
      return drawTable(style, block.header, block.align, block.rows, width)
    case 'rule':
      return [[{ text: '─'.repeat(width), ...colored(t.rule, t.rule === undefined ? { dim: true } : {}) }]]
  }
}

const GAP = 3

/** Tables, diagrams and figures are pictures: back to back, they may share a row. */
const isPicture = (block: Block) =>
  block.kind === 'table' || (block.kind === 'code' && !block.isOpen && (block.lang === 'mermaid' || block.lang === 'figure'))

/** Places drawn pictures side by side, as many to a row as fit, each row's pictures top-aligned. */
const sideBySide = (drawn: Line[][], width: number): Line[] => {
  const out: Line[] = []
  let row: Line[][] = []
  let used = 0
  const flush = () => {
    if (row.length === 0) return
    if (out.length > 0) out.push([])
    const widths = row.map(p => widest(p))
    const height = Math.max(...row.map(p => p.length))
    for (let k = 0; k < height; k++) {
      const line: Line = []
      row.forEach((p, i) => {
        if (i > 0) line.push({ text: ' '.repeat(GAP) })
        line.push(...(i < row.length - 1 ? padLine(p[k] ?? [], widths[i] ?? 0) : (p[k] ?? [])))
      })
      out.push(line)
    }
    row = []
    used = 0
  }
  for (const p of drawn) {
    const w = widest(p)
    if (row.length > 0 && used + GAP + w > width) flush()
    row.push(p)
    used += (row.length > 1 ? GAP : 0) + w
  }
  flush()
  return out
}

const widest = (lines: readonly Line[]) => Math.max(0, ...lines.map(lineWidth))

/** Draws blocks one under another, a blank line between; tight (a list item's) keeps a nested list close. */
export const drawBlocks = (style: Style, blocks: readonly Block[], width: number, depth = 0, tight = false): Line[] => {
  const w = Math.max(MIN_WIDTH, width)
  const out: Line[] = []
  for (let n = 0; n < blocks.length; n++) {
    const block = blocks[n] as Block
    if (n > 0 && !(tight && block.kind === 'list')) out.push([])
    if (isPicture(block) && depth === 0 && n + 1 < blocks.length && isPicture(blocks[n + 1] as Block)) {
      const run: Line[][] = []
      while (n < blocks.length && isPicture(blocks[n] as Block)) {
        run.push(drawBlock(style, blocks[n] as Block, w, depth))
        n++
      }
      n--
      out.push(...sideBySide(run, w))
      continue
    }
    out.push(...drawBlock(style, block, w, depth))
  }
  return out
}
