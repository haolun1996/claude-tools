// Dispatches a mermaid block to its renderer by its first keyword, and refuses
// a result that is too wide or too tall (the caller then keeps the code).

import type { DiagramContext, DiagramResult, Renderer } from './types'
import { MAX_LINES } from './types'
import { lineWidth } from '../wrap'
import { GANTT_RENDERERS } from './gantt'
import { GITGRAPH_RENDERERS } from './gitgraph'
import { GRAPH_RENDERERS } from './graph'
import { JOURNEY_RENDERERS } from './journey'
import { KANBAN_RENDERERS } from './kanban'
import { MINDMAP_RENDERERS } from './mindmap'
import { PIE_RENDERERS } from './pie'
import { QUADRANT_RENDERERS } from './quadrant'
import { SEQUENCE_RENDERERS } from './sequence'
import { XYCHART_RENDERERS } from './xychart'

// keyword -> renderer.
const RENDERERS: Record<string, Renderer> = {
  ...GRAPH_RENDERERS,
  ...SEQUENCE_RENDERERS,
  ...XYCHART_RENDERERS,
  ...PIE_RENDERERS,
  ...GANTT_RENDERERS,
  ...QUADRANT_RENDERERS,
  ...MINDMAP_RENDERERS,
  ...JOURNEY_RENDERERS,
  ...KANBAN_RENDERERS,
  ...GITGRAPH_RENDERERS,
}

export const registerRenderer = (keywords: readonly string[], render: Renderer) => {
  for (const k of keywords) RENDERERS[k] = render
}

const keywordOf = (source: string): string => {
  const first = source
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !l.startsWith('%%') && l !== '---')
  return (first ?? '').split(/[\s{]/)[0] ?? ''
}

export const drawMermaid = (ctx: DiagramContext, source: string): DiagramResult => {
  if (source.length > 8000) return { error: 'over 8,000 characters' }
  const keyword = keywordOf(source)
  const render = RENDERERS[keyword]
  if (render === undefined) return { error: `"${keyword}" diagrams are not drawn` }
  let result: DiagramResult
  try {
    result = render(ctx, source)
  } catch (err) {
    return { error: `it does not parse (${err instanceof Error ? err.message : String(err)})` }
  }
  if ('error' in result) return result
  if (result.lines.length > MAX_LINES) return { error: `over ${MAX_LINES} lines` }
  if (result.lines.some(l => lineWidth(l) > ctx.width)) return { error: 'wider than the window' }
  return result
}
