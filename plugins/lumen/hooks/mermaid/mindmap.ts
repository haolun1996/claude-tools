// Mermaid mindmaps: an indented tree drawn from the root to the right with
// box-drawing connectors, each top-level branch (and all of it) in its own
// color. Too wide for the window, it becomes an indented outline that wraps.

import type { DiagramContext, DiagramResult, Line, Renderer, Run } from './types'
import { lineRun, seriesColors } from './types'
import { charWidth, width } from '../width'
import { wrap } from '../wrap'

type Node = { text: string; children: Node[] }
type Style = Omit<Run, 'text'>

// ---------------------------------------------------------------- parsing

/** The text of one node line: `id[text]`, `id(text)`, `id((text))`, `id))text((`, `id)text(`, `id{{text}}` or bare text. */
const nodeText = (raw: string): string => {
  const s = raw
    .replace(/::icon\([^)]*\)/g, '')
    .replace(/\s*:::[\w\s-]*$/, '')
    .trim()
  const shapes = [
    /^[^\s()[\]{}]*\(\((.*)\)\)$/, // circle
    /^[^\s()[\]{}]*\)\)(.*)\(\($/, // bang
    /^[^\s()[\]{}]*\{\{(.*)\}\}$/, // hexagon
    /^[^\s()[\]{}]*\)(.*)\($/, // cloud
    /^[^\s()[\]{}]*\[(.*)\]$/, // square
    /^[^\s()[\]{}]*\((.*)\)$/, // rounded
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
  // "quoted" and "`markdown`" strings
  if (/^".*"$/.test(text)) text = text.slice(1, -1)
  if (/^`.*`$/.test(text)) text = text.slice(1, -1)
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
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

export const parseMindmap = (source: string): Node => {
  const lines = source.split('\n')
  const start = lines.findIndex(l => /^\s*mindmap\b/.test(l))
  if (start === -1) throw new Error('no mindmap keyword')
  let root: Node | undefined
  const stack: { indent: number; node: Node }[] = []
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('%%')) continue
    if (trimmed.startsWith('::icon(') || trimmed.startsWith(':::')) continue
    if (/^(accTitle|accDescr)\b/.test(trimmed)) continue
    const text = nodeText(trimmed)
    if (text === '') continue
    const indent = indentOf(line)
    const node: Node = { text, children: [] }
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) stack.pop()
    const parent = stack[stack.length - 1]?.node
    if (root === undefined) root = node
    else (parent ?? root).children.push(node)
    stack.push({ indent: root === node ? -1 : indent, node })
  }
  if (root === undefined) throw new Error('the mindmap has no nodes')
  return root
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
      if (w === 0) {
        const prev = cells[c - 1]
        if (prev) prev.text += ch
        continue
      }
      while (cells.length < c + w) cells.push({ text: ' ', style: {} })
      cells[c] = { text: ch, style }
      if (w === 2) cells[c + 1] = { text: '', style }
      c += w
    }
  }
  get width() {
    return this.rows.reduce((n, r) => Math.max(n, r.length), 0)
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

// ---------------------------------------------------------------- drawing

type Paint = { root: Style; line: Style; branch: (i: number) => { label: Style; line: Style } }

const paints = (ctx: DiagramContext): Paint => {
  const t = ctx.theme
  const colors = ctx.isMono ? [] : seriesColors(t).filter(c => c !== t.accent)
  const { text: _unused, ...lineStyle } = lineRun(t, '')
  return {
    root: ctx.isMono || t.accent === undefined ? { bold: true } : { color: t.accent, bold: true },
    line: lineStyle,
    branch: i => {
      const color = colors.length === 0 ? undefined : colors[i % colors.length]
      if (color === undefined) return { label: {}, line: { dim: true } }
      return { label: { color }, line: { color } }
    },
  }
}

const clean = (s: Style): Style => {
  const out: Style = {}
  for (const [k, v] of Object.entries(s)) if (v !== undefined && k !== 'text') (out as Record<string, unknown>)[k] = v
  return out
}

const leaves = (n: Node): number => (n.children.length === 0 ? 1 : n.children.reduce((s, c) => s + leaves(c), 0))

/** The tree to the right; undefined when it would not fit. */
const drawTree = (ctx: DiagramContext, root: Node, p: Paint): Line[] | undefined => {
  const grid = new Grid()
  const total = leaves(root)
  const spacer = root.children.length > 1 && total + root.children.length - 1 <= 40 ? 1 : 0
  const heightOf = (n: Node, isRoot: boolean): number => {
    if (n.children.length === 0) return 1
    const sum = n.children.reduce((s, c) => s + heightOf(c, false), 0)
    return isRoot ? sum + spacer * (n.children.length - 1) : sum
  }
  const place = (n: Node, row: number, col: number, depth: number, branch: number) => {
    const isRoot = depth === 0
    const looks = p.branch(branch)
    const labelStyle = isRoot ? p.root : depth === 1 && ctx.isMono ? { bold: true } : depth === 1 ? { ...looks.label, bold: true } : looks.label
    grid.put(row, col, n.text, clean(labelStyle))
    if (n.children.length === 0) return
    const hx = col + width(n.text)
    const lineStyle = isRoot ? p.line : looks.line
    grid.put(row, hx, ' ─', clean(lineStyle))
    const j = hx + 2
    let r = row
    n.children.forEach((child, i) => {
      const last = i === n.children.length - 1
      const ch = i === 0 ? (last ? '─' : '┬') : last ? '└' : '├'
      const childBranch = isRoot ? i : branch
      const childLine = clean(isRoot ? p.branch(i).line : looks.line)
      grid.put(r, j, ch, clean(lineStyle))
      grid.put(r, j + 1, '─ ', childLine)
      place(child, r, j + 3, depth + 1, childBranch)
      const h = heightOf(child, false) + (isRoot && !last ? spacer : 0)
      if (!last) for (let k = r + 1; k < r + h; k++) grid.put(k, j, '│', clean(lineStyle))
      r += h
    })
  }
  place(root, 0, 0, 0, 0)
  if (grid.width > ctx.width) return undefined
  return grid.lines()
}

/** An indented outline, wrapping long labels. */
const drawOutline = (ctx: DiagramContext, root: Node, p: Paint): Line[] => {
  const out: Line[] = []
  const first = wrap([{ ...clean(p.root), text: root.text }], ctx.width)
  out.push(...first)
  const walk = (n: Node, prefix: Run[], prefixW: number, depth: number, branch: number) => {
    n.children.forEach((child, i) => {
      const last = i === n.children.length - 1
      const b = depth === 0 ? i : branch
      const looks = p.branch(b)
      const lineStyle = clean(depth === 0 ? p.line : looks.line)
      const room = ctx.width - prefixW - 3
      if (room < 6) throw new Error('too deep for the width')
      const labelStyle = clean(depth === 0 ? (ctx.isMono ? { bold: true } : { ...looks.label, bold: true }) : looks.label)
      const parts = wrap([{ ...labelStyle, text: child.text }], room)
      parts.forEach((part, k) => {
        const joint = k === 0 ? (last ? '└─ ' : '├─ ') : last ? '   ' : '│  '
        out.push([...prefix.map(r => ({ ...r })), { ...lineStyle, text: joint }, ...part])
      })
      walk(child, [...prefix, { ...lineStyle, text: last ? '   ' : '│  ' }], prefixW + 3, depth + 1, b)
    })
  }
  walk(root, [], 0, 0, 0)
  // Merge neighbouring runs of the same style and drop trailing blanks.
  return out.map(line => {
    const merged: Line = []
    for (const r of line) {
      const last = merged[merged.length - 1]
      if (last !== undefined && styleKey(last) === styleKey(r)) last.text += r.text
      else merged.push({ ...r })
    }
    const tail = merged[merged.length - 1]
    if (tail !== undefined) tail.text = tail.text.replace(/\s+$/, '')
    return merged.filter(r => r.text !== '')
  })
}

export const renderMindmap: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  let root: Node
  try {
    root = parseMindmap(source)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const p = paints(ctx)
  const tree = drawTree(ctx, root, p)
  if (tree !== undefined) return { lines: tree }
  try {
    return { lines: drawOutline(ctx, root, p) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export const MINDMAP_RENDERERS: Record<string, Renderer> = { mindmap: renderMindmap }
