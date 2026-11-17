// Mermaid gitGraph histories, top to bottom: one colored lane per branch,
// forks and merges joined with box lines, and beside each commit its id, its
// [tags], its message and (at a branch's first commit) the branch name.

import type { DiagramContext, DiagramResult, Line, Renderer, Run } from './types'
import { seriesColors } from './types'
import { cut, width } from '../width'

type Kind = 'commit' | 'merge' | 'cherry-pick'
type CommitType = 'NORMAL' | 'HIGHLIGHT' | 'REVERSE'
type Commit = {
  id: string
  /** Whether the id came from the source (an auto id is not shown on merges and cherry-picks). */
  hasId: boolean
  branch: string
  parents: string[]
  type: CommitType
  tags: string[]
  msg: string
  kind: Kind
  /** merge: the branch merged in; cherry-pick: the commit picked. */
  other: string
}
type Graph = { commits: Commit[]; branches: { name: string; order: number; seq: number }[] }
type Style = Omit<Run, 'text'>

// ---------------------------------------------------------------- parsing

const unquote = (s: string) => (/^".*"$/.test(s) || /^'.*'$/.test(s) ? s.slice(1, -1) : s)

/** `id: "x" tag: "v1" type: HIGHLIGHT` to a record; tags may repeat. */
const attrsOf = (text: string): { values: Record<string, string>; tags: string[] } => {
  const values: Record<string, string> = {}
  const tags: string[] = []
  const re = /([A-Za-z]+)\s*:\s*("[^"]*"|'[^']*'|[^\s"']+)/g
  for (const m of text.matchAll(re)) {
    const key = (m[1] ?? '').toLowerCase()
    const value = unquote(m[2] ?? '')
    if (key === 'tag') tags.push(value)
    else values[key] = value
  }
  return { values, tags }
}

const typeOf = (v: string | undefined): CommitType => {
  const t = (v ?? 'NORMAL').toUpperCase()
  if (t === 'NORMAL' || t === 'HIGHLIGHT' || t === 'REVERSE') return t
  throw new Error(`unknown commit type "${v}"`)
}

export const parseGitGraph = (source: string): Graph => {
  const lines = source.split('\n')
  const start = lines.findIndex(l => /^\s*gitGraph\b/.test(l))
  if (start === -1) throw new Error('no gitGraph keyword')
  const commits: Commit[] = []
  const byId = new Map<string, Commit>()
  const heads = new Map<string, string | undefined>([['main', undefined]])
  const branches: Graph['branches'] = [{ name: 'main', order: 0, seq: 0 }]
  let current = 'main'
  let auto = 0
  const add = (c: Omit<Commit, 'id' | 'hasId'> & { id?: string }) => {
    let id = c.id
    const hasId = id !== undefined && id !== ''
    if (!hasId) {
      do id = `c${++auto}`
      while (byId.has(id))
    }
    if (byId.has(id as string)) throw new Error(`commit id "${id}" is used twice`)
    const commit: Commit = { ...c, id: id as string, hasId }
    commits.push(commit)
    byId.set(commit.id, commit)
    heads.set(c.branch, commit.id)
  }
  // Commands may share a line (`commit; commit`) in some sources.
  const statements = lines
    .slice(start + 1)
    .flatMap(l => l.split(';'))
    .map(l => l.trim())
  // A `gitGraph LR:` header may sit on the keyword line itself: nothing to do.
  for (const line of statements) {
    if (line === '' || line.startsWith('%%')) continue
    if (/^(accTitle|accDescr|title)\b/.test(line)) continue
    const word = /^(\S+)\s*(.*)$/.exec(line)
    const cmd = word?.[1] ?? ''
    const rest = word?.[2] ?? ''
    if (cmd === 'commit') {
      const { values, tags } = attrsOf(rest)
      const head = heads.get(current)
      add({
        id: values.id, branch: current, parents: head === undefined ? [] : [head], type: typeOf(values.type),
        tags, msg: values.msg ?? '', kind: 'commit', other: '',
      })
    } else if (cmd === 'branch') {
      const m = /^("[^"]*"|'[^']*'|\S+)\s*(.*)$/.exec(rest)
      const name = unquote(m?.[1] ?? '')
      if (name === '') throw new Error('a branch without a name')
      if (heads.has(name)) throw new Error(`branch "${name}" already exists`)
      const order = Number(attrsOf(m?.[2] ?? '').values.order ?? NaN)
      heads.set(name, heads.get(current))
      branches.push({ name, order: Number.isFinite(order) ? order : branches.length, seq: branches.length })
      current = name
    } else if (cmd === 'checkout' || cmd === 'switch') {
      const name = unquote(rest.trim())
      if (!heads.has(name)) throw new Error(`no branch "${name}" to check out`)
      current = name
    } else if (cmd === 'merge') {
      const m = /^("[^"]*"|'[^']*'|\S+)\s*(.*)$/.exec(rest)
      const name = unquote(m?.[1] ?? '')
      if (!heads.has(name)) throw new Error(`no branch "${name}" to merge`)
      if (name === current) throw new Error(`cannot merge "${name}" into itself`)
      const from = heads.get(name)
      const into = heads.get(current)
      if (from === undefined) throw new Error(`branch "${name}" has no commits`)
      if (from === into) throw new Error(`"${name}" has nothing to merge`)
      const { values, tags } = attrsOf(m?.[2] ?? '')
      add({
        id: values.id, branch: current, parents: into === undefined ? [from] : [into, from], type: typeOf(values.type),
        tags, msg: values.msg ?? '', kind: 'merge', other: name,
      })
    } else if (cmd === 'cherry-pick') {
      const { values, tags } = attrsOf(rest)
      const picked = values.id
      if (picked === undefined) throw new Error('cherry-pick without an id')
      if (!byId.has(picked)) throw new Error(`no commit "${picked}" to cherry-pick`)
      const head = heads.get(current)
      add({
        branch: current, parents: head === undefined ? [] : [head], type: 'NORMAL',
        tags, msg: '', kind: 'cherry-pick', other: picked,
      })
    } else {
      throw new Error(`unknown command "${cmd.length > 20 ? `${cmd.slice(0, 20)}…` : cmd}"`)
    }
  }
  if (commits.length === 0) throw new Error('the graph has no commits')
  return { commits, branches }
}

// ---------------------------------------------------------------- layout

type Row =
  | { type: 'commit'; commit: Commit; lane: number }
  | { type: 'link'; link: 'fork' | 'merge'; from: number; to: number }

const GLYPH: Record<CommitType, string> = { NORMAL: '●', HIGHLIGHT: '■', REVERSE: '✕' }
const MERGE = '◉'
const PICK = '◎'

const ellipsize = (text: string, max: number): string =>
  width(text) <= max ? text : max <= 1 ? cut(text, max) : `${cut(text, max - 1)}…`

const rowsOf = (graph: Graph) => {
  const { commits } = graph
  // Lanes: branches that hold commits, by `order:` then creation.
  const used = new Set(commits.map(c => c.branch))
  const laneNames = graph.branches
    .filter(b => used.has(b.name))
    .sort((a, b) => a.order - b.order || a.seq - b.seq)
    .map(b => b.name)
  const laneOf = new Map(laneNames.map((n, i) => [n, i]))
  const byId = new Map(commits.map(c => [c.id, c]))
  const lane = (c: Commit) => laneOf.get(c.branch) ?? 0

  // A branch forks right after the commit its first commit grows from.
  const forksAfter = new Map<string, number[]>()
  for (const name of laneNames) {
    const first = commits.find(c => c.branch === name)
    const baseId = first?.parents[0]
    const base = baseId === undefined ? undefined : byId.get(baseId)
    if (base === undefined || base.branch === name) continue
    forksAfter.set(base.id, [...(forksAfter.get(base.id) ?? []), laneOf.get(name) ?? 0])
  }

  const rows: Row[] = []
  for (const c of commits) {
    const here = lane(c)
    // Merged-in parents join just above the merge; a first parent on another lane is the fork.
    c.parents.slice(1).forEach(p => {
      const parent = byId.get(p)
      if (parent !== undefined && lane(parent) !== here) rows.push({ type: 'link', link: 'merge', from: lane(parent), to: here })
    })
    rows.push({ type: 'commit', commit: c, lane: here })
    for (const to of forksAfter.get(c.id) ?? []) rows.push({ type: 'link', link: 'fork', from: here, to })
  }

  // Each lane runs from the first row that touches it to the last.
  const start = laneNames.map(() => Infinity)
  const end = laneNames.map(() => -Infinity)
  const touch = (l: number, r: number) => {
    start[l] = Math.min(start[l] ?? Infinity, r)
    end[l] = Math.max(end[l] ?? -Infinity, r)
  }
  rows.forEach((row, r) => {
    if (row.type === 'commit') touch(row.lane, r)
    else {
      touch(row.from, r)
      touch(row.to, r)
    }
  })
  return { rows, laneNames, start, end }
}

export const renderGitGraph: Renderer = (ctx: DiagramContext, source: string): DiagramResult => {
  let graph: Graph
  try {
    graph = parseGitGraph(source)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const t = ctx.theme
  const { rows, laneNames, start, end } = rowsOf(graph)
  const colors = seriesColors(t)
  const laneStyle = (l: number): Style => {
    const color = ctx.isMono || colors.length === 0 ? undefined : colors[l % colors.length]
    return color === undefined ? {} : { color }
  }
  const text: Style = ctx.isMono || t.diagramText === undefined ? {} : { color: t.diagramText }
  const tagStyle: Style = ctx.isMono || t.number === undefined ? { bold: true } : { color: t.number, bold: true }
  const dim: Style = { dim: true }

  const laneCols = laneNames.length * 2 - 1
  if (laneCols > ctx.width) return { error: 'too many branches for the width' }
  const room = ctx.width - laneCols - 2
  const active = (l: number, r: number) => (start[l] ?? Infinity) < r && r < (end[l] ?? -Infinity)
  const seen = new Set<string>()

  const lines: Line[] = rows.map((row, r) => {
    const cells: Run[] = []
    for (let col = 0; col < laneCols; col++) cells.push({ text: ' ' })
    const set = (col: number, ch: string, style: Style) => {
      cells[col] = { ...style, text: ch }
    }
    laneNames.forEach((_, l) => {
      if (active(l, r)) set(l * 2, '│', laneStyle(l))
    })
    const label: Run[] = []
    if (row.type === 'commit') {
      const c = row.commit
      const glyph = c.type !== 'NORMAL' ? GLYPH[c.type] : c.kind === 'merge' ? MERGE : c.kind === 'cherry-pick' ? PICK : GLYPH.NORMAL
      set(row.lane * 2, glyph, { ...laneStyle(row.lane), bold: true })
      if (c.kind === 'cherry-pick') label.push({ ...dim, text: `cherry-pick: ${c.other}` })
      else if (c.kind === 'merge') {
        if (c.hasId) label.push({ ...text, text: c.id, ...(c.type === 'HIGHLIGHT' ? { bold: true } : {}) })
        label.push({ ...dim, text: `${c.hasId ? ' ' : ''}merge ` })
        label.push({ ...laneStyle(laneNames.indexOf(c.other)), text: c.other })
      } else label.push({ ...text, text: c.id, ...(c.type === 'HIGHLIGHT' ? { bold: true } : {}) })
      for (const tag of c.tags) label.push({ ...tagStyle, text: ` [${tag}]` })
      if (!seen.has(c.branch)) {
        seen.add(c.branch)
        label.push({ ...laneStyle(row.lane), bold: true, text: ` (${c.branch})` })
      }
      if (c.type === 'REVERSE') label.push({ ...dim, text: ' reverse' })
      if (c.msg !== '') label.push({ ...dim, text: `  ${c.msg}` })
    } else {
      const { from: f, to: d, link } = row
      const lo = Math.min(f, d)
      const hi = Math.max(f, d)
      const side = link === 'merge' ? f : d
      const across = laneStyle(side)
      for (let col = lo * 2 + 1; col < hi * 2; col++) {
        const isLane = col % 2 === 0
        set(col, isLane && active(col / 2, r) ? '┼' : '─', across)
      }
      const above = (l: number) => (start[l] ?? Infinity) < r
      const below = (l: number) => (end[l] ?? -Infinity) > r
      const right = (l: number) => l === hi // the horizontal runs to this lane's left
      const joint = (l: number): string => {
        const up = above(l)
        const down = below(l)
        if (up && down) return right(l) ? '┤' : '├'
        if (up) return right(l) ? '╯' : '╰'
        return right(l) ? '╮' : '╭'
      }
      set(f * 2, joint(f), laneStyle(f))
      set(d * 2, joint(d), laneStyle(d))
    }
    // Trim the lanes' trailing blanks, then add the label if any.
    const line: Line = []
    for (const cell of cells) {
      const last = line[line.length - 1]
      if (last !== undefined && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...cell, text: '' })) last.text += cell.text
      else line.push({ ...cell })
    }
    if (label.length > 0 && room >= 4) {
      line.push({ text: '  ' })
      let left = room
      for (const run of label) {
        if (left <= 0) break
        const w = width(run.text)
        if (w <= left) {
          line.push(run)
          left -= w
        } else {
          line.push({ ...run, text: ellipsize(run.text, left) })
          left = 0
        }
      }
    }
    while (line.length > 0) {
      const last = line[line.length - 1] as Run
      const trimmed = last.text.replace(/\s+$/, '')
      if (trimmed === '') line.pop()
      else {
        last.text = trimmed
        break
      }
    }
    return line
  })
  return { lines }
}

export const GITGRAPH_RENDERERS: Record<string, Renderer> = { gitGraph: renderGitGraph }
