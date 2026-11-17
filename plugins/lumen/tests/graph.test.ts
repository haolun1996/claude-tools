import { expect, test } from 'claude-code/testing'

import { GRAPH_RENDERERS } from '../hooks/mermaid/graph'
import { layoutGraph } from '../hooks/mermaid/graph-layout'
import { parseClass, parseER, parseFlowchart, parseState } from '../hooks/mermaid/graph-parse'
import type { DiagramContext, Line } from '../hooks/mermaid/types'
import { resolveTheme } from '../hooks/theme'
import { lineWidth } from '../hooks/wrap'

const ctxOf = (width: number, theme = 'catppuccin-mocha'): DiagramContext => {
  const r = resolveTheme(theme)
  return { theme: r.theme, width, isMono: r.isMono, pieStyle: 'round' }
}

const keywordOf = (src: string) => src.trim().split(/[\s{]/)[0] ?? ''

const draw = (src: string, width = 100, theme?: string): Line[] => {
  const render = GRAPH_RENDERERS[keywordOf(src)]
  if (render === undefined) throw new Error('no renderer')
  const res = render(ctxOf(width, theme), src)
  if ('error' in res) throw new Error(res.error)
  for (const l of res.lines) expect(lineWidth(l)).toBeLessThanOrEqual(width)
  expect(res.lines.length).toBeLessThanOrEqual(80)
  return res.lines
}

const plain = (lines: Line[]) => lines.map(l => l.map(r => r.text).join(''))
const text = (lines: Line[]) => plain(lines).join('\n')
const errorOf = (src: string, width = 80): string | undefined => {
  const render = GRAPH_RENDERERS[keywordOf(src)]
  try {
    const res = render?.(ctxOf(width), src)
    return res !== undefined && 'error' in res ? res.error : undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const INKS = {
  line: {}, label: {}, frame: {}, frameTitle: {},
  node: () => ({ border: {}, title: {}, header: {}, member: {}, glyph: {} }),
}
const OPTS = { maxLabel: 24, maxEdgeLabel: 20, maxMember: 40, gap: 3, frames: true, compact: false }

const FLOW = `flowchart TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C[Ship it]
  B -->|No| D[Debug]
  D --> E[Write a test]
  E --> B
  C --> F([Done])`

test('every graph keyword has a renderer', () => {
  for (const k of ['graph', 'flowchart', 'stateDiagram', 'stateDiagram-v2', 'classDiagram', 'erDiagram']) {
    expect(typeof GRAPH_RENDERERS[k]).toBe('function')
  }
})

test('a TD flowchart draws boxes, a decision, labels and downward arrows', () => {
  const t = text(draw(FLOW))
  for (const label of ['Start', 'Is it working?', 'Ship it', 'Debug', 'Write a test', 'Done', 'Yes', 'No']) {
    expect(t).toContain(label)
  }
  expect(t).toContain('◇')
  expect(t).toContain('╭')
  expect(t).toContain('▼')
  // The cycle E --> B comes back up into the decision.
  expect(t).toContain('▲')
  expect(t).not.toContain('▶')
  expect(t).not.toContain('◀')
})

test('the layout keeps edges out of boxes and labels', () => {
  const samples = [
    FLOW,
    `graph LR
  A[Client] --> B(Load balancer)
  B --> C[Server 1] & D[Server 2]
  C --> E[(Database)]
  D --> E
  E -.-> F[Backup]
  C ==> G{{Cache}}
  F --> A`,
  ]
  for (const src of samples) {
    const { canvas } = layoutGraph(parseFlowchart(src), INKS, OPTS)
    expect(canvas.collisions).toBe(0)
  }
})

test('an arrowhead sits right above the box it points into', () => {
  const rows = plain(draw('graph TD\n  A[One] --> B[Two]'))
  const arrowRow = rows.findIndex(r => r.includes('▼'))
  expect(arrowRow).toBeGreaterThan(0)
  const col = rows[arrowRow]!.indexOf('▼')
  expect(rows[arrowRow + 1]![col]).toBe('─')
  expect(rows[arrowRow - 1]![col]).toBe('│')
  // A straight edge leaves the upper box through a junction in its border.
  expect(rows.some(r => r.includes('┬'))).toBe(true)
})

test('LR flowcharts point right and keep labels on the line', () => {
  const t = text(draw('graph LR\n  A[Build] -->|ok| B[Deploy] --> C[Verify]'))
  expect(t).toContain('►')
  expect(t).toMatch(/─ ok ─+►/)
  expect(t).toContain('Build')
  expect(t).toContain('Verify')
})

test('BT and RL put the arrows the other way', () => {
  expect(text(draw('graph BT\n  A[Leaf] --> B[Root]'))).toContain('▲')
  expect(text(draw('graph RL\n  A[Leaf] --> B[Root]'))).toContain('◄')
})

test('each node gets its own color, edges the diagram color', () => {
  const theme = resolveTheme('catppuccin-mocha').theme
  const lines = draw('graph LR\n  A[Alpha] --> B[Beta] --> C[Gamma]')
  const colorOf = (label: string) => lines.flat().find(r => r.text.includes(label))?.color
  const colors = new Set([colorOf('Alpha'), colorOf('Beta'), colorOf('Gamma')])
  expect(colors.size).toBe(3)
  const arrow = lines.flat().find(r => r.text.includes('►'))
  expect(arrow?.color).toBe(theme.diagram)
})

test('mono drops colors and bolds node text', () => {
  const lines = draw('graph TD\n  A[Alpha] --> B[Beta]', 80, 'mono')
  expect(lines.flat().every(r => r.color === undefined)).toBe(true)
  expect(lines.flat().find(r => r.text.includes('Alpha'))?.bold).toBe(true)
})

test('edge kinds: open, dotted, thick, cross, circle, both ways and text labels', () => {
  const t = text(draw(`graph LR
  A --- B
  B --x C
  C --o D
  D <--> E
  E == thick ==> F
  F -. dotted .-> G`, 120))
  expect(t).toContain('×')
  expect(t).toContain('○')
  expect(t).toContain('◄─►')
  expect(t).toContain('━')
  expect(t).toContain('┄')
  expect(t).toContain('thick')
  expect(t).toContain('dotted')
})

test('chains, & groups and shapes parse', () => {
  const g = parseFlowchart(`graph TD
  A & B --> C --> D(Round) & E((Circle))
  F>Flag] --> G[[Sub]]
  H{{Hex}} --> I([Stadium])
  classDef hot fill:#f00
  class A hot
  style B fill:#0f0
  click A "https://example.com"
  linkStyle 0 stroke:#f00
  %% a comment`)
  expect(g.nodes.map(n => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
  expect(g.edges.length).toBe(6)
  expect(g.nodes.find(n => n.id === 'E')?.shape).toBe('circle')
  expect(g.nodes.find(n => n.id === 'H')?.shape).toBe('hexagon')
  expect(g.nodes.find(n => n.id === 'I')?.shape).toBe('stadium')
})

test('a link glued to the next node still parses', () => {
  const g = parseFlowchart('graph TD\nc1-->a2\na-.->b\nx==>y')
  expect(g.edges.map(e => `${e.from}>${e.to}:${e.style}`)).toEqual(['c1>a2:solid', 'a>b:dotted', 'x>y:thick'])
})

test('subgraphs draw a titled outline', () => {
  const t = text(draw(`flowchart LR
  subgraph frontend [Front end]
    ui[Web UI] --> client[API client]
  end
  subgraph backend [Back end]
    api[REST API] --> db[(Postgres)]
  end
  client --> api`, 120))
  expect(t).toContain('Front end')
  expect(t).toContain('Back end')
  expect(t).toContain('┆')
})

test('long labels wrap to fit a narrow window', () => {
  const src = `graph TD
  A[A rather long label that has to wrap somewhere] --> B[Another fairly long label for the second box]
  A --> C[Third box with a long label too]`
  const lines = draw(src, 50)
  expect(text(lines)).toContain('wrap')
})

test('a fan-out too wide across turns sideways to fit', () => {
  const src = 'graph TD\n  R[Root] --> A[Alpha] & B[Beta] & C[Gamma] & D[Delta] & E[Epsilon] & F[Zeta] & G[Eta] & H[Theta]'
  const t = text(draw(src, 60))
  expect(t).toContain('►')
  expect(t).toContain('Theta')
})

test('too wide for any spacing is an error, not an overflow', () => {
  expect(errorOf('graph LR\n  A[Alpha] --> B[Beta] --> C[Gamma]', 6)).toBeDefined()
})

test('unparseable flowcharts are errors', () => {
  expect(errorOf('graph TD\n  A --> ')).toBeDefined()
  expect(errorOf('graph TD\n  A[unclosed --> B')).toBeDefined()
})

test('self loops draw beside their box', () => {
  const t = text(draw('stateDiagram-v2\n  [*] --> Busy\n  Busy --> Busy : tick\n  Busy --> [*]'))
  expect(t).toContain('tick')
  expect(t).toContain('◄')
})

test('state diagrams: start and end dots, labels, named states, choice', () => {
  const src = `stateDiagram-v2
  state "Waiting for input" as Wait
  state check <<choice>>
  [*] --> Wait
  Wait --> check : submit
  check --> Done : valid
  check --> Wait : invalid
  Done --> [*]
  note right of Wait : a note`
  const t = text(draw(src))
  expect(t).toContain('●')
  expect(t).toContain('◉')
  expect(t).toContain('Waiting for input')
  expect(t).toContain('submit')
  expect(t).toContain('invalid')
  expect(t).toContain('◇')
  expect(t).not.toContain('a note')
})

test('state diagrams honour direction LR', () => {
  const t = text(draw('stateDiagram-v2\n  direction LR\n  [*] --> A\n  A --> B : go\n  B --> [*]'))
  expect(t).toContain('►')
})

test('composite states are flattened', () => {
  const g = parseState(`stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> Idle
    Idle --> Running : start
    Running --> [*]
  }
  Active --> [*]`)
  expect(g.nodes.some(n => n.id === 'Idle')).toBe(true)
  expect(g.edges.some(e => e.from === 'Active' && e.to === 'Idle')).toBe(true)
  const t = text(draw(`stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> Idle
    Idle --> Running : start
  }`))
  expect(t).toContain('Running')
  expect(t).toContain('start')
})

const CLASSES = `classDiagram
  class Animal {
    <<abstract>>
    +String name
    +int age
    +makeSound() void
  }
  class Dog {
    +fetch() void
  }
  Cat : +bool indoor
  Cat : +purr() void
  Animal <|-- Dog
  Animal <|-- Cat
  Dog "1" *-- "4" Leg : has
  Cat ..> Food : eats
  Dog o-- Toy
  Shape <|.. Circle`

test('class diagrams draw compartments and relation ends', () => {
  const lines = draw(CLASSES, 120)
  const t = text(lines)
  for (const s of ['Animal', '«abstract»', '+String name', '+makeSound() void', '+fetch() void', '+bool indoor', 'has', 'eats']) {
    expect(t).toContain(s)
  }
  expect(t).toContain('├')
  expect(t).toContain('△')
  expect(t).toContain('◆')
  expect(t).toContain('◇')
  expect(t).toContain('┆')
  expect(t).toMatch(/ 1/)
  expect(t).toMatch(/ 4/)
  // The parent sits above its children.
  const rows = plain(lines)
  const row = (s: string) => rows.findIndex(r => r.includes(s))
  expect(row('Animal')).toBeLessThan(row('Dog'))
})

test('class relations read either way round', () => {
  const g = parseClass('classDiagram\n  Duck --|> Animal\n  Car --* Engine\n  A <.. B\n  X "1" --> "*" Y : owns')
  expect(g.edges[0]).toMatchObject({ from: 'Animal', to: 'Duck', headFrom: 'triangle' })
  expect(g.edges[1]).toMatchObject({ from: 'Engine', to: 'Car', headFrom: 'diamond' })
  expect(g.edges[2]).toMatchObject({ from: 'A', to: 'B', headFrom: 'arrow', style: 'dotted' })
  expect(g.edges[3]).toMatchObject({ textFrom: '1', textTo: '*', label: 'owns' })
})

const ER = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT }|..|{ LINE_ITEM : "ordered in"
  CUSTOMER {
    string id PK
    string name
    string email UK "login"
  }
  ORDER {
    int id PK
    string customer_id FK
  }`

test('ER diagrams draw entities with attributes and cardinalities', () => {
  const t = text(draw(ER, 100))
  for (const s of ['CUSTOMER', 'ORDER', 'LINE_ITEM', 'PRODUCT', 'places', 'contains', 'ordered in', 'PK', 'FK', 'UK', 'email']) {
    expect(t).toContain(s)
  }
  expect(t).toContain('0..*')
  expect(t).toContain('1..*')
  expect(t).toMatch(/│ 1/)
  // Non-identifying relationships are dotted.
  expect(t).toContain('┆')
})

test('ER relationships parse cardinalities from both ends', () => {
  const g = parseER('erDiagram\n  A |o--o{ B : has\n  C }|..|| D : uses\n  E only one to zero or more F : owns')
  expect(g.edges[0]).toMatchObject({ textFrom: '0..1', textTo: '0..*', style: 'solid' })
  expect(g.edges[1]).toMatchObject({ textFrom: '1..*', textTo: '1', style: 'dotted' })
  expect(g.edges[2]).toMatchObject({ textFrom: '1', textTo: '0..*' })
})

test('ER in LR keeps the cardinalities above the line', () => {
  const t = text(draw('erDiagram\n  direction LR\n  AUTHOR }|..|{ BOOK : writes', 100))
  expect(t).toContain('1..*')
  expect(t).toContain('writes')
})

test('wide characters keep boxes aligned', () => {
  const rows = plain(draw('graph LR\n  A[开始] --> B[完成 ✅]'))
  const top = rows.find(r => r.includes('╭'))!
  const mid = rows.find(r => r.includes('开始'))!
  expect(lineWidth([{ text: top }])).toBeGreaterThanOrEqual(lineWidth([{ text: mid }]))
})
