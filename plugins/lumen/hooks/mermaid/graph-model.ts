// The graph every box-and-arrow diagram is read into before it is laid out:
// flowcharts, state, class and ER diagrams all become nodes, edges and groups.

export type Dir = 'TD' | 'BT' | 'LR' | 'RL'

export type Shape =
  | 'rect' | 'round' | 'stadium' | 'circle' | 'decision' | 'hexagon' | 'sub'
  | 'start' | 'end' | 'bar' | 'record'

/** What an edge end draws where it meets its node. */
export type Mark = 'none' | 'arrow' | 'cross' | 'circle' | 'triangle' | 'diamond' | 'diamondOpen'

export type LineStyle = 'solid' | 'dotted' | 'thick'

export type GNode = {
  id: string
  /** The text in the box; `\n` breaks lines. */
  label: string
  shape: Shape
  /** A line above the title, such as «interface». */
  header?: string
  /** Record boxes (class, entity): compartments under the title, one string per row. */
  sections?: string[][]
  /** The innermost group the node belongs to. */
  group?: string
}

export type GEdge = {
  from: string
  to: string
  style: LineStyle
  /** Shapes the layout but is not drawn (`~~~`). */
  invisible?: boolean
  headFrom: Mark
  headTo: Mark
  label?: string
  /** Short text written next to each end (cardinalities). */
  textFrom?: string
  textTo?: string
  /** Rank distance the edge asks for (longer arrows ask for more). */
  minlen: number
}

export type GGroup = { id: string; title: string; parent?: string }

export type Graph = { dir: Dir; nodes: GNode[]; edges: GEdge[]; groups: GGroup[] }

export class GraphBuilder {
  dir: Dir = 'TD'
  private readonly byId = new Map<string, GNode>()
  readonly nodes: GNode[] = []
  readonly edges: GEdge[] = []
  readonly groups: GGroup[] = []

  has(id: string): boolean {
    return this.byId.has(id)
  }

  get(id: string): GNode | undefined {
    return this.byId.get(id)
  }

  /** The node with this id, made on first mention (in `group` when given). */
  node(id: string, group?: string): GNode {
    let n = this.byId.get(id)
    if (n === undefined) {
      n = { id, label: id, shape: 'rect' }
      if (group !== undefined) n.group = group
      this.byId.set(id, n)
      this.nodes.push(n)
    }
    return n
  }

  edge(e: GEdge): void {
    this.edges.push(e)
  }

  group(g: GGroup): void {
    if (!this.groups.some(x => x.id === g.id)) this.groups.push(g)
  }

  build(): Graph {
    return { dir: this.dir, nodes: this.nodes, edges: this.edges, groups: this.groups }
  }
}

/** Direction keyword to a direction; TB is TD. */
export const dirOf = (word: string | undefined, fallback: Dir): Dir => {
  switch ((word ?? '').toUpperCase()) {
    case 'TB':
    case 'TD':
      return 'TD'
    case 'BT':
      return 'BT'
    case 'LR':
      return 'LR'
    case 'RL':
      return 'RL'
    default:
      return fallback
  }
}

const ENTITIES: Record<string, string> = {
  quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'", '#39': "'",
}

/** Label text as it reads: quotes dropped, `<br>` as a line break, entity codes decoded, markdown marks dropped. */
export const cleanText = (raw: string): string => {
  let s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1)
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n')
  s = s.replace(/<\/?(?:b|i|u|em|strong|small|code|span)[^>]*>/gi, '')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  s = s.replace(/[#&](#?\w+);/g, (whole, name: string) => {
    if (/^#?\d+$/.test(name)) {
      const code = Number(name.replace('#', ''))
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name] ?? whole
  })
  return s
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .trim()
}

/** Source lines with comments, directives and front matter taken out. */
export const sourceLines = (source: string): string[] => {
  const raw = source.split('\n')
  const out: string[] = []
  let i = 0
  // Front matter: a leading `---` block.
  while (i < raw.length && (raw[i] ?? '').trim() === '') i++
  if ((raw[i] ?? '').trim() === '---') {
    i++
    while (i < raw.length && (raw[i] ?? '').trim() !== '---') i++
    i++
  }
  for (; i < raw.length; i++) {
    const t = (raw[i] ?? '').trim()
    if (t === '' || t.startsWith('%%')) continue
    out.push(t)
  }
  return out
}
