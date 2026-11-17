// Mermaid graph diagrams as colored text art: flowcharts, state, class and
// ER diagrams. Each is parsed into one Graph and drawn by one layered layout;
// when the drawing is wider than the window, labels wrap tighter and spacing
// shrinks, and a left-to-right diagram finally turns top-down.

import type { DiagramContext, DiagramResult, Line, Renderer } from './types'
import { MAX_LINES, seriesColors } from './types'
import type { Graph } from './graph-model'
import type { Inks, LayoutOptions } from './graph-layout'
import { layoutGraph } from './graph-layout'
import type { BoxInks } from './graph-box'
import { parseClass, parseER, parseFlowchart, parseState } from './graph-parse'
import { lineWidth } from '../wrap'

const ATTEMPTS: LayoutOptions[] = [
  { maxLabel: 24, maxEdgeLabel: 20, maxMember: 40, gap: 3, frames: true, compact: false },
  { maxLabel: 18, maxEdgeLabel: 16, maxMember: 32, gap: 3, frames: true, compact: false },
  { maxLabel: 14, maxEdgeLabel: 12, maxMember: 26, gap: 2, frames: true, compact: false },
  { maxLabel: 12, maxEdgeLabel: 10, maxMember: 22, gap: 2, frames: false, compact: true },
  { maxLabel: 9, maxEdgeLabel: 8, maxMember: 18, gap: 1, frames: false, compact: true },
]

const inksOf = (ctx: DiagramContext, records: boolean): Inks => {
  const t = ctx.theme
  const mono = ctx.isMono
  const colors = mono ? [] : seriesColors(t)
  const ink = (color: string | undefined, extra: { bold?: boolean; dim?: boolean } = {}) =>
    mono || color === undefined ? { ...extra } : { color, ...extra }
  const line = mono || t.diagram === undefined ? { dim: true } : { color: t.diagram }
  const label = ink(t.diagramText)
  return {
    line,
    label,
    frame: mono || t.diagram === undefined ? { dim: true } : { color: t.diagram, dim: true },
    frameTitle: ink(t.diagramText, { bold: true }),
    node: (i: number): BoxInks => {
      const color = i < 0 || colors.length === 0 ? undefined : colors[i % colors.length]
      return {
        border: ink(color),
        title: ink(color, mono || records ? { bold: true } : {}),
        header: ink(color),
        member: label,
        glyph: ink(t.accent ?? t.diagram, mono ? { bold: true } : {}),
      }
    },
  }
}

/** Lays the graph out at the first spacing that fits the window. */
export const drawGraph = (ctx: DiagramContext, graph: Graph): DiagramResult => {
  const records = graph.nodes.some(n => n.shape === 'record')
  const inks = inksOf(ctx, records)
  // A diagram too wide one way may fit turned the other way.
  const turned = { TD: 'LR', BT: 'RL', LR: 'TD', RL: 'BT' } as const
  const dirs = [graph.dir, turned[graph.dir]]
  let tooTall = false
  for (const dir of dirs) {
    for (const opts of ATTEMPTS) {
      const { canvas } = layoutGraph({ ...graph, dir }, inks, opts)
      const lines: Line[] = canvas.toLines()
      const wide = lines.some(l => lineWidth(l) > ctx.width)
      if (!wide && lines.length <= MAX_LINES) return { lines }
      if (wide) continue
      // Fits across but too tall: only tighter rows can still help (narrower labels make it taller).
      tooTall = true
      if (!opts.compact) {
        const tight = layoutGraph({ ...graph, dir }, inks, { ...opts, compact: true }).canvas.toLines()
        if (tight.length <= MAX_LINES) return { lines: tight }
      }
      break
    }
  }
  return { error: tooTall ? `over ${MAX_LINES} lines` : 'wider than the window' }
}

const renderer = (parse: (source: string) => Graph): Renderer => (ctx, source) => drawGraph(ctx, parse(source))

export const GRAPH_RENDERERS: Record<string, Renderer> = {
  graph: renderer(parseFlowchart),
  flowchart: renderer(parseFlowchart),
  stateDiagram: renderer(parseState),
  'stateDiagram-v2': renderer(parseState),
  classDiagram: renderer(parseClass),
  erDiagram: renderer(parseER),
}
