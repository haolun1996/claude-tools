// Parsers for the four box-and-arrow diagram types. Each reads mermaid source
// into a Graph or throws an Error saying what it could not read.

import type { GEdge, Graph, LineStyle, Mark, Shape } from './graph-model'
import { GraphBuilder, cleanText, dirOf, sourceLines } from './graph-model'
import { pad as padText, width as textWidth } from '../width'

const isIdChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)

/** Splits a line at `;` outside quotes and brackets. */
const splitStatements = (line: string): string[] => {
  const out: string[] = []
  let depth = 0
  let quote = false
  let cur = ''
  for (const ch of line) {
    if (ch === '"') quote = !quote
    else if (!quote && (ch === '[' || ch === '(' || ch === '{')) depth++
    else if (!quote && (ch === ']' || ch === ')' || ch === '}')) depth = Math.max(0, depth - 1)
    if (ch === ';' && !quote && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim()).filter(s => s !== '')
}

// ---------------------------------------------------------------- flowchart

type ShapeOpen = { open: string; close: string[]; shape: Shape }

// Longest opener first.
const OPENERS: ShapeOpen[] = [
  { open: '(((', close: [')))'], shape: 'circle' },
  { open: '((', close: ['))'], shape: 'circle' },
  { open: '([', close: ['])'], shape: 'stadium' },
  { open: '[[', close: [']]'], shape: 'sub' },
  { open: '[(', close: [')]'], shape: 'round' },
  { open: '[/', close: ['/]', '\\]'], shape: 'rect' },
  { open: '[\\', close: ['\\]', '/]'], shape: 'rect' },
  { open: '{{', close: ['}}'], shape: 'hexagon' },
  { open: '[', close: [']'], shape: 'rect' },
  { open: '(', close: [')'], shape: 'round' },
  { open: '{', close: ['}'], shape: 'decision' },
  { open: '>', close: [']'], shape: 'rect' },
]

type NodeTok = { id: string; label?: string; shape?: Shape }

type LinkTok = {
  style: LineStyle
  invisible: boolean
  headFrom: Mark
  headTo: Mark
  label?: string
  minlen: number
}

const headOf = (ch: string): Mark => (ch === '<' || ch === '>' ? 'arrow' : ch === 'x' ? 'cross' : ch === 'o' ? 'circle' : 'none')

const LINK = /^([<xo]?)(-{2,}|={2,}|-?\.+-|~{3,})(>|[xo](?![\p{L}\p{N}_])|)/u
const LINK_LOOSE = /^([<xo]?)(-{2,}|={2,}|-?\.+-|~{3,})([>xo]?)/
const OPEN_LABEL = /^([<xo]?)(--|==|-\.)(?![-=.>])(?![xo](?![\p{L}\p{N}_]))/u
const PIPE = /^\s*\|([^|]*)\|/

const linkOf = (left: string, body: string, right: string): LinkTok => {
  const invisible = body.startsWith('~')
  const style: LineStyle = body.includes('=') ? 'thick' : body.includes('.') ? 'dotted' : 'solid'
  const headed = right !== ''
  let minlen = 1
  if (style === 'dotted') minlen = (body.match(/\./g) ?? []).length
  else if (!invisible) minlen = body.length - (headed ? 1 : 2)
  return { style, invisible, headFrom: headOf(left), headTo: headOf(right), minlen: Math.max(1, Math.min(4, minlen)) }
}

class Cursor {
  i = 0
  constructor(readonly s: string) {}
  get rest(): string {
    return this.s.slice(this.i)
  }
  ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i] ?? '')) this.i++
  }
  done(): boolean {
    this.ws()
    return this.i >= this.s.length
  }
}

const readNode = (c: Cursor): NodeTok | undefined => {
  c.ws()
  const s = c.s
  const start = c.i
  let j = c.i
  while (j < s.length) {
    const ch = s[j]
    if (isIdChar(ch)) j++
    else if ((ch === '-' || ch === '.') && j > start && isIdChar(s[j + 1])) j++
    else break
  }
  if (j === start) return undefined
  const tok: NodeTok = { id: s.slice(start, j) }
  c.i = j
  // New shape syntax: A@{ shape: diamond, label: "x" }
  if (s.startsWith('@{', c.i)) {
    const end = s.indexOf('}', c.i)
    if (end === -1) throw new Error(`no closing } after ${tok.id}@{`)
    const body = s.slice(c.i + 2, end)
    const label = /label\s*:\s*"([^"]*)"/.exec(body)?.[1] ?? /label\s*:\s*([^,]+)/.exec(body)?.[1]
    const shapeWord = /shape\s*:\s*([\w-]+)/.exec(body)?.[1] ?? ''
    if (label !== undefined) tok.label = cleanText(label)
    tok.shape = /diam|decision|question/.test(shapeWord) ? 'decision'
      : /circ/.test(shapeWord) ? 'circle'
      : /hex/.test(shapeWord) ? 'hexagon'
      : /stadium|pill|terminal/.test(shapeWord) ? 'stadium'
      : /round|event/.test(shapeWord) ? 'round'
      : 'rect'
    c.i = end + 1
  } else {
    for (const o of OPENERS) {
      if (!s.startsWith(o.open, c.i)) continue
      let k = c.i + o.open.length
      while (k < s.length && s[k] === ' ') k++
      let text: string
      let after: number
      if (s[k] === '"') {
        const q = s.indexOf('"', k + 1)
        if (q === -1) throw new Error(`no closing quote in ${tok.id}`)
        text = s.slice(k + 1, q)
        after = q + 1
        while (after < s.length && s[after] === ' ') after++
        const closer = o.close.find(cl => s.startsWith(cl, after))
        if (closer === undefined) throw new Error(`no closing ${o.close[0] ?? ''} after ${tok.id}`)
        after += closer.length
      } else {
        let best = -1
        let bestLen = 0
        for (const cl of o.close) {
          const at = s.indexOf(cl, k)
          if (at !== -1 && (best === -1 || at < best)) {
            best = at
            bestLen = cl.length
          }
        }
        if (best === -1) throw new Error(`no closing ${o.close[0] ?? ''} after ${tok.id}`)
        text = s.slice(k, best)
        after = best + bestLen
      }
      tok.label = cleanText(text)
      tok.shape = o.shape
      c.i = after
      break
    }
  }
  const cls = /^:::[\w-]+/.exec(c.rest)
  if (cls) c.i += cls[0].length
  return tok
}

const readLink = (c: Cursor): LinkTok | undefined => {
  c.ws()
  const rest = c.rest
  const open = OPEN_LABEL.exec(rest)
  if (open) {
    const kind = open[2] ?? '--'
    const after = rest.slice(open[0].length)
    const close =
      kind === '--' ? /-{2,}>|-{2,}[xo](?![\p{L}\p{N}_])|-{3,}/u.exec(after)
      : kind === '==' ? /={2,}>|={2,}[xo](?![\p{L}\p{N}_])|={3,}/u.exec(after)
      : /\.+->|\.+-[xo](?![\p{L}\p{N}_])|\.+-/u.exec(after)
    if (close && after.slice(0, close.index).trim() !== '') {
      const label = after.slice(0, close.index)
      const token = close[0]
      const right = /[>xo]$/.test(token) ? token.slice(-1) : ''
      const stem = token.replace(/[>xo]$/, '')
      const link = linkOf(open[1] ?? '', kind === '-.' ? '-' + stem : stem, right)
      link.label = cleanText(label)
      c.i += open[0].length + close.index + token.length
      return link
    }
  }
  const m = LINK.exec(rest) ?? LINK_LOOSE.exec(rest)
  if (!m) return undefined
  const link = linkOf(m[1] ?? '', m[2] ?? '', m[3] ?? '')
  c.i += m[0].length
  const pipe = PIPE.exec(c.rest)
  if (pipe) {
    link.label = cleanText(pipe[1] ?? '')
    c.i += pipe[0].length
  }
  return link
}

const IGNORED_FLOW = /^(classDef|class|style|click|linkStyle|accTitle|accDescr|direction)\b/

export const parseFlowchart = (source: string): Graph => {
  const lines = sourceLines(source)
  const g = new GraphBuilder()
  const head = lines[0] ?? ''
  const hm = /^(?:graph|flowchart)\b\s*([A-Za-z]{2})?\s*;?(.*)$/.exec(head)
  if (!hm) throw new Error('no graph or flowchart header')
  g.dir = dirOf(hm[1], 'TD')
  const statements: string[] = []
  if ((hm[2] ?? '').trim() !== '') statements.push(...splitStatements(hm[2] ?? ''))
  for (const line of lines.slice(1)) statements.push(...splitStatements(line))

  const stack: string[] = []
  const groupIds = new Set<string>()
  const groupMembers = new Map<string, string[]>()
  const pendingGroupEdges: { e: GEdge }[] = []
  let anon = 0

  const touch = (tok: NodeTok): string => {
    const group = stack[stack.length - 1]
    if (groupIds.has(tok.id) && tok.label === undefined) return tok.id // a subgraph referenced by an edge
    const n = g.node(tok.id, group)
    if (tok.label !== undefined) n.label = tok.label
    if (tok.shape !== undefined) n.shape = tok.shape
    if (group !== undefined && n.group === undefined) n.group = group
    if (group !== undefined) {
      const m = groupMembers.get(group) ?? []
      if (!m.includes(tok.id)) m.push(tok.id)
      groupMembers.set(group, m)
    }
    return tok.id
  }

  for (const st of statements) {
    if (IGNORED_FLOW.test(st)) continue
    if (st === 'end') {
      stack.pop()
      continue
    }
    const sub = /^subgraph\b\s*(.*)$/.exec(st)
    if (sub) {
      const rest = (sub[1] ?? '').trim()
      let id: string
      let title: string
      const withTitle = /^([^\s[]+)\s*\[(.*)\]$/.exec(rest)
      if (withTitle) {
        id = withTitle[1] ?? ''
        title = cleanText(withTitle[2] ?? '')
      } else if (rest === '') {
        id = `__sub${anon++}`
        title = ''
      } else {
        id = cleanText(rest)
        title = id
      }
      const parent = stack[stack.length - 1]
      g.group(parent === undefined ? { id, title } : { id, title, parent })
      groupIds.add(id)
      stack.push(id)
      continue
    }
    const c = new Cursor(st)
    const groups: string[][] = []
    const links: LinkTok[] = []
    for (;;) {
      const ids: string[] = []
      for (;;) {
        const tok = readNode(c)
        if (tok === undefined) throw new Error(`cannot read "${c.rest.slice(0, 24)}"`)
        ids.push(touch(tok))
        c.ws()
        if (c.s[c.i] === '&') {
          c.i++
          continue
        }
        break
      }
      groups.push(ids)
      if (c.done()) break
      const link = readLink(c)
      if (link === undefined) throw new Error(`cannot read "${c.rest.slice(0, 24)}"`)
      links.push(link)
    }
    if (groups.length !== links.length + 1) throw new Error(`a link has no end in "${st.slice(0, 24)}"`)
    links.forEach((link, k) => {
      for (const from of groups[k] ?? []) {
        for (const to of groups[k + 1] ?? []) {
          const e: GEdge = {
            from, to, style: link.style, headFrom: link.headFrom, headTo: link.headTo, minlen: link.minlen,
          }
          if (link.invisible) e.invisible = true
          if (link.label !== undefined && link.label !== '') e.label = link.label
          pendingGroupEdges.push({ e })
        }
      }
    })
  }
  // An edge to a subgraph goes to its first member.
  const memberOf = (id: string): string | undefined => {
    if (!groupIds.has(id) || g.has(id)) return id
    const seen = new Set<string>()
    let cur: string | undefined = id
    while (cur !== undefined && groupIds.has(cur) && !g.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = (groupMembers.get(cur) ?? [])[0] ?? g.groups.find(x => x.parent === cur)?.id
    }
    return cur !== undefined && g.has(cur) ? cur : undefined
  }
  for (const { e } of pendingGroupEdges) {
    const from = memberOf(e.from)
    const to = memberOf(e.to)
    if (from === undefined || to === undefined) continue
    g.edge({ ...e, from, to })
  }
  if (g.nodes.length === 0) throw new Error('no nodes')
  return g.build()
}

// ---------------------------------------------------------------- state

type Scope = { id: string }

export const parseState = (source: string): Graph => {
  const lines = sourceLines(source)
  const g = new GraphBuilder()
  if (!/^stateDiagram(-v2)?\b/.test(lines[0] ?? '')) throw new Error('no stateDiagram header')
  const stack: Scope[] = [{ id: '' }]
  const composites = new Set<string>()
  const scope = () => stack[stack.length - 1] ?? { id: '' }
  const groupOf = () => (scope().id === '' ? undefined : scope().id)
  const descriptions = new Map<string, string[]>()

  const stateNode = (raw: string, side: 'from' | 'to'): string => {
    const id = raw.replace(/:::[\w-]+$/, '')
    if (id === '[*]') {
      const s = scope().id
      if (side === 'from' && s !== '') return s // a composite's start is the composite itself
      const key = `${side === 'from' ? '__start' : '__end'}:${s}`
      const n = g.node(key, groupOf())
      n.shape = side === 'from' ? 'start' : 'end'
      n.label = ''
      return key
    }
    g.node(id, groupOf())
    return id
  }

  for (let i = 1; i < lines.length; i++) {
    let t = lines[i] ?? ''
    if (/^(classDef|class|style|scale|hide|accTitle|accDescr)\b/.test(t) || t === '--') continue
    const dm = /^direction\s+(\w+)/.exec(t)
    if (dm) {
      if (stack.length === 1) g.dir = dirOf(dm[1], 'TD')
      continue
    }
    if (/^note\b/.test(t)) {
      if (!/:/.test(t)) while (i < lines.length && !/^end\s*note$/.test(lines[i] ?? '')) i++
      continue
    }
    if (t === '}') {
      if (stack.length > 1) stack.pop()
      continue
    }
    t = t.replace(/:::[\w-]+/g, '')
    let m = /^state\s+"([^"]*)"\s+as\s+([\w.-]+)\s*(\{)?$/.exec(t)
    if (m) {
      const n = g.node(m[2] ?? '', groupOf())
      n.label = cleanText(m[1] ?? '')
      if (m[3] === '{') {
        composites.add(n.id)
        g.group({ id: n.id, title: '', ...(scope().id === '' ? {} : { parent: scope().id }) })
        stack.push({ id: n.id })
      }
      continue
    }
    m = /^state\s+([\w.-]+)\s+as\s+"([^"]*)"$/.exec(t)
    if (m) {
      g.node(m[1] ?? '', groupOf()).label = cleanText(m[2] ?? '')
      continue
    }
    m = /^state\s+([\w.-]+)\s*<<\s*(choice|fork|join)\s*>>$/.exec(t)
    if (m) {
      const n = g.node(m[1] ?? '', groupOf())
      n.shape = m[2] === 'choice' ? 'decision' : 'bar'
      if (m[2] !== 'choice') n.label = ''
      else n.label = ' '
      continue
    }
    m = /^state\s+([\w.-]+)\s*\{$/.exec(t)
    if (m) {
      const n = g.node(m[1] ?? '', groupOf())
      composites.add(n.id)
      g.group({ id: n.id, title: '', ...(scope().id === '' ? {} : { parent: scope().id }) })
      stack.push({ id: n.id })
      continue
    }
    m = /^state\s+([\w.-]+)$/.exec(t)
    if (m) {
      g.node(m[1] ?? '', groupOf())
      continue
    }
    m = /^(\S+?)\s*(-->|<--)\s*(\S+?)\s*(?::\s*(.*))?$/.exec(t)
    if (m) {
      const back = m[2] === '<--'
      const a = m[1] ?? ''
      const b = m[3] ?? ''
      const from = stateNode(back ? b : a, 'from')
      const to = stateNode(back ? a : b, 'to')
      const e: GEdge = { from, to, style: 'solid', headFrom: 'none', headTo: 'arrow', minlen: 1 }
      if (scope().id !== '' && from === scope().id && (back ? b : a) === '[*]') e.style = 'dotted'
      const label = cleanText(m[4] ?? '')
      if (label !== '') e.label = label
      g.edge(e)
      continue
    }
    m = /^([\w.-]+)\s*:\s*(.*)$/.exec(t)
    if (m) {
      g.node(m[1] ?? '', groupOf())
      const d = descriptions.get(m[1] ?? '') ?? []
      d.push(cleanText(m[2] ?? ''))
      descriptions.set(m[1] ?? '', d)
      continue
    }
    m = /^([\w.-]+)$/.exec(t)
    if (m) {
      g.node(m[1] ?? '', groupOf())
      continue
    }
    throw new Error(`cannot read "${t.slice(0, 24)}"`)
  }
  for (const [id, d] of descriptions) {
    const n = g.get(id)
    if (n !== undefined) n.label = d.join('\n')
  }
  for (const n of g.nodes) if (composites.has(n.id)) n.shape = 'round'
  if (g.nodes.length === 0) throw new Error('no states')
  return g.build()
}

// ---------------------------------------------------------------- class

const CLASS_REL =
  /^([\w.~`$-]+?)\s*(?:"([^"]*)"\s*)?(<\||\*|o(?=-|\.)|<)?(--|\.\.)(\|>|\*|o(?=[\s"])|>)?\s*(?:"([^"]*)"\s*)?([\w.~`$-]+)\s*(?::\s*(.*))?$/

const relMark = (tok: string | undefined): Mark =>
  tok === '<|' || tok === '|>' ? 'triangle'
  : tok === '*' ? 'diamond'
  : tok === 'o' ? 'diamondOpen'
  : tok === '<' || tok === '>' ? 'arrow'
  : 'none'

const generics = (s: string): string => s.replace(/~([^~]*)~/g, '<$1>')

const memberText = (raw: string): string =>
  generics(raw.trim())
    .replace(/\)[$*]/g, ')')
    .replace(/[$*]$/, '')
    .replace(/\s+/g, ' ')

export const parseClass = (source: string): Graph => {
  const lines = sourceLines(source)
  const g = new GraphBuilder()
  if (!/^classDiagram(-v2)?\b/.test(lines[0] ?? '')) throw new Error('no classDiagram header')
  const attrs = new Map<string, string[]>()
  const methods = new Map<string, string[]>()
  const ns: string[] = []
  const cls = (rawName: string): string => {
    const name = rawName.replace(/`/g, '')
    const id = name.replace(/~.*$/, '')
    const n = g.node(id, ns[ns.length - 1])
    n.shape = 'record'
    if (name.includes('~') && n.label === id) n.label = generics(name)
    if (!attrs.has(id)) attrs.set(id, [])
    if (!methods.has(id)) methods.set(id, [])
    return id
  }
  const addMember = (id: string, raw: string) => {
    const text = memberText(raw)
    if (text === '') return
    const ann = /^<<\s*(.+?)\s*>>$/.exec(text)
    if (ann) {
      const n = g.get(id)
      if (n) n.header = `«${ann[1] ?? ''}»`
      return
    }
    ;(text.includes('(') ? methods : attrs).get(id)?.push(text)
  }

  for (let i = 1; i < lines.length; i++) {
    const t = lines[i] ?? ''
    if (/^(classDef|cssClass|style|click|callback|link|note|accTitle|accDescr)\b/.test(t)) continue
    const dm = /^direction\s+(\w+)/.exec(t)
    if (dm) {
      g.dir = dirOf(dm[1], 'TD')
      continue
    }
    const nm = /^namespace\s+([\w.-]+)\s*\{$/.exec(t)
    if (nm) {
      const id = `ns:${nm[1] ?? ''}`
      g.group({ id, title: nm[1] ?? '', ...(ns.length ? { parent: ns[ns.length - 1] } : {}) })
      ns.push(id)
      continue
    }
    if (t === '}') {
      ns.pop()
      continue
    }
    let m = /^class\s+([\w.~`$-]+)\s*(?:\[\s*"?([^"\]]*)"?\s*\])?\s*(?::::[\w-]+)?\s*(\{)?\s*(.*?)\s*(\})?$/.exec(t)
    if (m) {
      const id = cls(m[1] ?? '')
      if (m[2] !== undefined && m[2] !== '') {
        const n = g.get(id)
        if (n) n.label = cleanText(m[2])
      }
      if (m[3] === '{') {
        if (m[5] === '}') {
          if ((m[4] ?? '') !== '') addMember(id, m[4] ?? '')
          continue
        }
        if ((m[4] ?? '') !== '') addMember(id, m[4] ?? '')
        i++
        for (; i < lines.length; i++) {
          const inner = lines[i] ?? ''
          if (inner === '}') break
          addMember(id, inner)
        }
      }
      continue
    }
    m = /^<<\s*(.+?)\s*>>\s*([\w.~`$-]+)$/.exec(t)
    if (m) {
      const n = g.get(cls(m[2] ?? ''))
      if (n) n.header = `«${m[1] ?? ''}»`
      continue
    }
    m = CLASS_REL.exec(t)
    if (m) {
      const a = cls(m[1] ?? '')
      const b = cls(m[7] ?? '')
      let headFrom = relMark(m[3])
      let headTo = relMark(m[5])
      let textFrom = m[2]
      let textTo = m[6]
      let from = a
      let to = b
      // Parents, wholes and targets go on top: the marked end leads.
      const strong = (k: Mark) => k === 'triangle' || k === 'diamond' || k === 'diamondOpen'
      if (strong(headTo) && !strong(headFrom)) {
        ;[from, to] = [to, from]
        ;[headFrom, headTo] = [headTo, headFrom]
        ;[textFrom, textTo] = [textTo, textFrom]
      }
      const e: GEdge = { from, to, style: m[4] === '..' ? 'dotted' : 'solid', headFrom, headTo, minlen: 1 }
      if (textFrom !== undefined && textFrom !== '') e.textFrom = textFrom
      if (textTo !== undefined && textTo !== '') e.textTo = textTo
      const label = cleanText(m[8] ?? '')
      if (label !== '') e.label = label
      g.edge(e)
      continue
    }
    m = /^([\w.~`$-]+)\s*:\s*(.*)$/.exec(t)
    if (m) {
      addMember(cls(m[1] ?? ''), m[2] ?? '')
      continue
    }
    m = /^([\w.~`$-]+)$/.exec(t)
    if (m) {
      cls(m[1] ?? '')
      continue
    }
    throw new Error(`cannot read "${t.slice(0, 24)}"`)
  }
  for (const n of g.nodes) {
    const a = attrs.get(n.id) ?? []
    const f = methods.get(n.id) ?? []
    n.sections = [a, f].filter(x => x.length > 0)
  }
  if (g.nodes.length === 0) throw new Error('no classes')
  return g.build()
}

// ---------------------------------------------------------------- ER

const ER_LEFT: Record<string, string> = { '||': '1', '|o': '0..1', '}|': '1..*', '}o': '0..*' }
const ER_RIGHT: Record<string, string> = { '||': '1', 'o|': '0..1', '|{': '1..*', 'o{': '0..*' }
const ER_WORDS: Record<string, string> = {
  'one or zero': '0..1', 'zero or one': '0..1', 'one or more': '1..*', 'one or many': '1..*',
  'many(1)': '1..*', '1+': '1..*', 'zero or more': '0..*', 'zero or many': '0..*', 'many(0)': '0..*',
  '0+': '0..*', 'only one': '1', '1': '1',
}

const ER_REL = /^([\w-]+|"[^"]+")\s*(\|\||\|o|\}\||\}o)(--|\.\.)(\|\||o\||\|\{|o\{)\s*([\w-]+|"[^"]+")\s*:\s*(.*)$/
const ER_REL_WORDS =
  /^([\w-]+)\s+(one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|only one|1)\s+(to|optionally to)\s+(one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|only one|1)\s+([\w-]+)\s*:\s*(.*)$/
const ER_ATTR = /^(\S+)\s+(\S+)((?:\s+(?:PK|FK|UK)\s*(?:,\s*(?:PK|FK|UK)\s*)*)?)(?:\s+"([^"]*)")?\s*$/

export const parseER = (source: string): Graph => {
  const lines = sourceLines(source)
  const g = new GraphBuilder()
  if (!/^erDiagram\b/.test(lines[0] ?? '')) throw new Error('no erDiagram header')
  const rows = new Map<string, string[][]>()
  const entity = (raw: string): string => {
    const id = raw.replace(/^"|"$/g, '')
    const n = g.node(id)
    n.shape = 'record'
    if (!rows.has(id)) rows.set(id, [])
    return id
  }
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i] ?? ''
    if (/^(classDef|class|style|accTitle|accDescr)\b/.test(t)) continue
    const dm = /^direction\s+(\w+)/.exec(t)
    if (dm) {
      g.dir = dirOf(dm[1], 'TD')
      continue
    }
    let m = /^([\w-]+|"[^"]+")\s*(?:\[\s*"?([^"\]]*)"?\s*\])?\s*\{\s*(.*?)\s*(\})?$/.exec(t)
    if (m) {
      const id = entity(m[1] ?? '')
      if (m[2] !== undefined && m[2] !== '') {
        const n = g.get(id)
        if (n) n.label = cleanText(m[2])
      }
      const list = rows.get(id) ?? []
      const addAttr = (line: string) => {
        const a = ER_ATTR.exec(line.trim())
        if (!a) {
          if (line.trim() !== '') list.push([line.trim(), '', '', ''])
          return
        }
        const keys = (a[3] ?? '').replace(/\s+/g, '').replace(/,/g, ',')
        list.push([a[1] ?? '', a[2] ?? '', keys, a[4] ?? ''])
      }
      if (m[4] === '}') {
        if ((m[3] ?? '') !== '') addAttr(m[3] ?? '')
      } else {
        if ((m[3] ?? '') !== '') addAttr(m[3] ?? '')
        i++
        for (; i < lines.length; i++) {
          const inner = lines[i] ?? ''
          if (inner === '}') break
          addAttr(inner)
        }
      }
      rows.set(id, list)
      continue
    }
    m = ER_REL.exec(t)
    let rel: { a: string; b: string; ca: string; cb: string; dotted: boolean; label: string } | undefined
    if (m) {
      rel = {
        a: m[1] ?? '', b: m[5] ?? '', ca: ER_LEFT[m[2] ?? ''] ?? '', cb: ER_RIGHT[m[4] ?? ''] ?? '',
        dotted: m[3] === '..', label: m[6] ?? '',
      }
    } else {
      m = ER_REL_WORDS.exec(t)
      if (m) {
        rel = {
          a: m[1] ?? '', b: m[5] ?? '', ca: ER_WORDS[m[2] ?? ''] ?? '', cb: ER_WORDS[m[4] ?? ''] ?? '',
          dotted: m[3] === 'optionally to', label: m[6] ?? '',
        }
      }
    }
    if (rel) {
      const from = entity(rel.a)
      const to = entity(rel.b)
      const e: GEdge = {
        from, to, style: rel.dotted ? 'dotted' : 'solid', headFrom: 'none', headTo: 'none', minlen: 1,
        textFrom: rel.ca, textTo: rel.cb,
      }
      const label = cleanText(rel.label)
      if (label !== '') e.label = label
      g.edge(e)
      continue
    }
    m = /^([\w-]+|"[^"]+")$/.exec(t)
    if (m) {
      entity(m[1] ?? '')
      continue
    }
    throw new Error(`cannot read "${t.slice(0, 24)}"`)
  }
  for (const n of g.nodes) {
    const list = rows.get(n.id) ?? []
    n.sections = list.length === 0 ? [] : [alignColumns(list)]
  }
  if (g.nodes.length === 0) throw new Error('no entities')
  return g.build()
}

/** Rows of cells as text in aligned columns (empty columns dropped). */
const alignColumns = (rows: string[][]): string[] => {
  const cols = Math.max(0, ...rows.map(r => r.length))
  const widths: number[] = []
  for (let c = 0; c < cols; c++) widths.push(Math.max(0, ...rows.map(r => textWidth(r[c] ?? ''))))
  return rows.map(r =>
    r
      .map((cell, c) => (widths[c] === 0 ? '' : padText(cell, widths[c] ?? 0)))
      .filter((_, c) => widths[c] !== 0)
      .join(' ')
      .trimEnd(),
  )
}

