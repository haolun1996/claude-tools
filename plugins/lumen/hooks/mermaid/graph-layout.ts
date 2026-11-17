// Layered layout of a Graph onto a Canvas.
//
// The layout works in two abstract axes: `main` runs along the diagram's
// direction (down for TD, right for LR) and `cross` runs across it. Nodes are
// ranked by longest path (cycles broken by turning back edges around), edges
// spanning several ranks get one dummy per rank in between, and an edge label
// sits in its own rank right after the edge's source. Ranks are ordered by
// barycenter sweeps, placed across by a weighted pull toward neighbours, and
// edges are routed orthogonally through the channels between ranks, one track
// per bundle (a fan-out from one port, or a fan-in to one port).

import { Canvas } from './graph-canvas'
import type { Ink, Pt } from './graph-canvas'
import type { Box, BoxInks } from './graph-box'
import { drawBox, growBox, growHeight, isGlyph, makeBox, portSlots, wrapText } from './graph-box'
import type { GEdge, Graph, LineStyle, Mark } from './graph-model'
import { width } from '../width'

export type LayoutOptions = {
  maxLabel: number
  maxEdgeLabel: number
  maxMember: number
  /** Columns between neighbours across a TD rank. */
  gap: number
  frames: boolean
  compact: boolean
}

export type Inks = {
  line: Ink
  label: Ink
  frame: Ink
  frameTitle: Ink
  node: (index: number) => BoxInks
}

type Side = 'start' | 'end'

type Port = { segs: Seg[]; at: number; text: number; key: string; order: number }

type LNode = {
  kind: 'real' | 'pass' | 'label'
  /** Real: node index. Dummy: edge index. */
  ref: number
  layer: number
  order: number
  chain: string[]
  box?: Box
  lines?: string[]
  style: LineStyle
  mainSize: number
  crossSize: number
  anchor: number
  pos: number
  ports: Record<Side, Port[]>
  up: Seg[]
  down: Seg[]
  mStart: number
  mEnd: number
  loops: GEdge[]
}

type Seg = {
  edge: number
  up: LNode
  low: LNode
  upMark: Mark
  lowMark: Mark
  upText: string
  lowText: string
  style: LineStyle
  upPort?: Port
  lowPort?: Port
  track: number
}

type Bundle = { segs: Seg[]; ups: Set<number>; lows: Set<number>; min: number; max: number; track: number }

type Frame = { id: string; title: string; x0: number; y0: number; x1: number; y1: number; members: Set<LNode>; titleAt?: number }

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)

/** Weighted isotonic regression (pool adjacent violators): the nondecreasing fit to ys. */
const pav = (ys: readonly number[], ws: readonly number[]): number[] => {
  const blocks: { sum: number; w: number; n: number }[] = []
  ys.forEach((y, i) => {
    const w = ws[i] ?? 1
    blocks.push({ sum: y * w, w, n: 1 })
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!
      const a = blocks[blocks.length - 2]!
      if (a.sum / a.w <= b.sum / b.w) break
      blocks.pop()
      a.sum += b.sum
      a.w += b.w
      a.n += b.n
    }
  })
  const out: number[] = []
  for (const b of blocks) for (let i = 0; i < b.n; i++) out.push(b.sum / b.w)
  return out
}

export type LayoutResult = { canvas: Canvas; crossings: number }

export const layoutGraph = (graph: Graph, inks: Inks, opts: LayoutOptions): LayoutResult => {
  const lr = graph.dir === 'LR' || graph.dir === 'RL'
  const flip = graph.dir === 'BT' || graph.dir === 'RL'
  const index = new Map<string, number>()
  graph.nodes.forEach((n, i) => index.set(n.id, i))

  // Group chains, outermost first.
  const parentOf = new Map<string, string | undefined>()
  for (const g of graph.groups) parentOf.set(g.id, g.parent)
  const chainOf = (group: string | undefined): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    let cur = group
    while (cur !== undefined && parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      out.unshift(cur)
      cur = parentOf.get(cur)
    }
    return out
  }
  const useFrames = opts.frames && graph.groups.length > 0

  const reals: LNode[] = graph.nodes.map((n, i) => ({
    kind: 'real', ref: i, layer: 0, order: 0, chain: useFrames ? chainOf(n.group) : [], style: 'solid',
    mainSize: 1, crossSize: 1, anchor: 0, pos: 0, ports: { start: [], end: [] }, up: [], down: [],
    mStart: 0, mEnd: 0, loops: [],
  }))

  // ---- edges, self loops, cycle breaking
  type LEdge = { e: number; a: number; b: number; minlen: number }
  const ledges: LEdge[] = []
  graph.edges.forEach((e, i) => {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined) return
    if (a === b) {
      if (!e.invisible) reals[a]!.loops.push(e)
      return
    }
    ledges.push({ e: i, a, b, minlen: e.minlen })
  })
  const out: number[][] = graph.nodes.map(() => [])
  ledges.forEach((le, i) => out[le.a]!.push(i))
  const state = graph.nodes.map(() => 0)
  const reversed = new Set<number>()
  for (let root = 0; root < graph.nodes.length; root++) {
    if (state[root] !== 0) continue
    const stack: { n: number; k: number }[] = [{ n: root, k: 0 }]
    state[root] = 1
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      const edges = out[top.n]!
      if (top.k >= edges.length) {
        state[top.n] = 2
        stack.pop()
        continue
      }
      const li = edges[top.k++]!
      const b = ledges[li]!.b
      if (state[b] === 1) reversed.add(li)
      else if (state[b] === 0) {
        state[b] = 1
        stack.push({ n: b, k: 0 })
      }
    }
  }
  // DAG: src -> dst
  const dag = ledges.map((le, i) => (reversed.has(i) ? { ...le, a: le.b, b: le.a } : le))

  // ---- ranks: longest path, every edge two ranks long (labels sit in between)
  const N = graph.nodes.length
  const indeg = new Array<number>(N).fill(0)
  const dout: number[][] = graph.nodes.map(() => [])
  const din: number[][] = graph.nodes.map(() => [])
  dag.forEach((d, i) => {
    indeg[d.b]!++
    dout[d.a]!.push(i)
    din[d.b]!.push(i)
  })
  const topo: number[] = []
  const queue: number[] = []
  for (let i = 0; i < N; i++) if (indeg[i] === 0) queue.push(i)
  while (queue.length > 0) {
    const n = queue.shift()!
    topo.push(n)
    for (const di of dout[n]!) {
      const b = dag[di]!.b
      indeg[b]!--
      if (indeg[b] === 0) queue.push(b)
    }
  }
  const rank = new Array<number>(N).fill(0)
  for (const n of topo) for (const di of dout[n]!) {
    const d = dag[di]!
    rank[d.b] = Math.max(rank[d.b]!, rank[n]! + 2 * d.minlen)
  }
  // Sources move down next to their nearest child.
  for (let t = topo.length - 1; t >= 0; t--) {
    const n = topo[t]!
    if (din[n]!.length > 0 || dout[n]!.length === 0) continue
    rank[n] = Math.min(...dout[n]!.map(di => rank[dag[di]!.b]! - 2 * dag[di]!.minlen))
  }
  const maxRank = Math.max(0, ...rank)
  if (flip) for (let i = 0; i < N; i++) rank[i] = maxRank - rank[i]!

  // ---- layers (real ranks and label ranks)
  type Drawn = { e: number; upper: number; lower: number; fromUpper: boolean; labelRank: number }
  const drawn: Drawn[] = []
  const kept = new Set<number>(rank)
  for (const le of ledges) {
    const e = graph.edges[le.e]!
    if (e.invisible) continue
    const ra = rank[le.a]!
    const rb = rank[le.b]!
    const fromUpper = ra < rb
    const upper = fromUpper ? le.a : le.b
    const lower = fromUpper ? le.b : le.a
    const labelRank = e.label !== undefined ? (fromUpper ? ra + 1 : ra - 1) : -1
    if (labelRank >= 0) kept.add(labelRank)
    drawn.push({ e: le.e, upper, lower, fromUpper, labelRank })
  }
  const ranks = [...kept].sort((a, b) => a - b)
  const layerOf = new Map<number, number>()
  ranks.forEach((r, i) => layerOf.set(r, i))
  const layers: LNode[][] = ranks.map(() => [])
  reals.forEach((n, i) => {
    n.layer = layerOf.get(rank[i]!)!
    layers[n.layer]!.push(n)
  })

  const segs: Seg[] = []
  const lcaChain = (a: string[], b: string[]): string[] => {
    const outc: string[] = []
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) outc.push(a[i]!)
    return outc
  }
  for (const d of drawn) {
    const e = graph.edges[d.e]!
    const u = reals[d.upper]!
    const v = reals[d.lower]!
    const chain: LNode[] = [u]
    const ru = rank[d.upper]!
    const rv = rank[d.lower]!
    for (const r of ranks) {
      if (r <= ru || r >= rv) continue
      const isLabel = r === d.labelRank
      const dn: LNode = {
        kind: isLabel ? 'label' : 'pass', ref: d.e, layer: layerOf.get(r)!, order: 0, chain: lcaChain(u.chain, v.chain),
        style: e.style, mainSize: 1, crossSize: 1, anchor: 0, pos: 0, ports: { start: [], end: [] }, up: [], down: [],
        mStart: 0, mEnd: 0, loops: [],
      }
      if (isLabel) dn.lines = wrapText(e.label ?? '', opts.maxEdgeLabel)
      layers[dn.layer]!.push(dn)
      chain.push(dn)
    }
    chain.push(v)
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]!
      const b = chain[i + 1]!
      const first = i === 0
      const lastSeg = i + 2 === chain.length
      const s: Seg = {
        edge: d.e, up: a, low: b, style: e.style, track: -1,
        upMark: first ? (d.fromUpper ? e.headFrom : e.headTo) : 'none',
        lowMark: lastSeg ? (d.fromUpper ? e.headTo : e.headFrom) : 'none',
        upText: first ? ((d.fromUpper ? e.textFrom : e.textTo) ?? '') : '',
        lowText: lastSeg ? ((d.fromUpper ? e.textTo : e.textFrom) ?? '') : '',
      }
      a.down.push(s)
      b.up.push(s)
      segs.push(s)
    }
  }

  // ---- ordering
  const L = layers.length
  {
    // Initial order: depth-first from the roots, in source order.
    let seq = 0
    const seen = new Set<LNode>()
    const visit = (n: LNode) => {
      const st: LNode[] = [n]
      while (st.length > 0) {
        const x = st.pop()!
        if (seen.has(x)) continue
        seen.add(x)
        x.order = seq++
        for (let i = x.down.length - 1; i >= 0; i--) st.push(x.down[i]!.low)
      }
    }
    for (const n of reals) if (n.up.length === 0) visit(n)
    for (const n of reals) visit(n)
    for (const layer of layers) for (const n of layer) if (!seen.has(n)) n.order = seq++
  }
  const sortLayer = (items: LNode[], key: (n: LNode) => number, depth = 0): LNode[] => {
    type Cluster = { key: number; items: LNode[]; group?: string }
    const clusters: Cluster[] = []
    const byGroup = new Map<string, Cluster>()
    for (const n of items) {
      const g = n.chain[depth]
      if (g === undefined) {
        clusters.push({ key: key(n), items: [n] })
        continue
      }
      let c = byGroup.get(g)
      if (c === undefined) {
        c = { key: 0, items: [], group: g }
        byGroup.set(g, c)
        clusters.push(c)
      }
      c.items.push(n)
    }
    for (const c of clusters) if (c.group !== undefined) c.key = mean(c.items.map(key))
    const sorted = clusters.map((c, i) => ({ c, i })).sort((a, b) => a.c.key - b.c.key || a.i - b.i)
    return sorted.flatMap(({ c }) => (c.group === undefined ? c.items : sortLayer(c.items, key, depth + 1)))
  }
  const renumber = (layer: LNode[]) => layer.forEach((n, i) => (n.order = i))
  for (let l = 0; l < L; l++) {
    layers[l] = sortLayer([...layers[l]!].sort((a, b) => a.order - b.order), n => n.order)
    renumber(layers[l]!)
  }
  const crossingsAt = (l: number): number => {
    const ss: Seg[] = []
    for (const n of layers[l]!) ss.push(...n.down)
    let c = 0
    for (let i = 0; i < ss.length; i++) {
      for (let j = i + 1; j < ss.length; j++) {
        const a = ss[i]!
        const b = ss[j]!
        if ((a.up.order - b.up.order) * (a.low.order - b.low.order) < 0) c++
      }
    }
    return c
  }
  const crossings = () => {
    let c = 0
    for (let l = 0; l + 1 < L; l++) c += crossingsAt(l)
    return c
  }
  let best = crossings()
  let bestOrder = layers.map(layer => [...layer])
  // Big graphs get fewer sweeps so a reply never stalls on one diagram.
  const heavy = segs.length > 160
  for (let iter = 0; iter < (heavy ? 4 : 16) && best > 0; iter++) {
    const down = iter % 2 === 0
    const range = down ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1)
    for (const l of range) {
      const bary = (n: LNode): number => {
        const nb = down ? n.up.map(s => s.up.order) : n.down.map(s => s.low.order)
        return nb.length === 0 ? n.order : mean(nb)
      }
      layers[l] = sortLayer(layers[l]!, bary)
      renumber(layers[l]!)
    }
    // Swap neighbours while that removes crossings.
    for (let l = 0; l < L && !heavy; l++) {
      const layer = layers[l]!
      let improved = true
      for (let round = 0; improved && round < 4; round++) {
        improved = false
        for (let i = 0; i + 1 < layer.length; i++) {
          const a = layer[i]!
          const b = layer[i + 1]!
          if (a.chain.join('/') !== b.chain.join('/')) continue
          const before = (l > 0 ? crossingsAt(l - 1) : 0) + (l + 1 < L ? crossingsAt(l) : 0)
          a.order = i + 1
          b.order = i
          const after = (l > 0 ? crossingsAt(l - 1) : 0) + (l + 1 < L ? crossingsAt(l) : 0)
          if (after < before) {
            layer[i] = b
            layer[i + 1] = a
            improved = true
          } else {
            a.order = i
            b.order = i + 1
          }
        }
      }
    }
    const c = crossings()
    if (c < best) {
      best = c
      bestOrder = layers.map(layer => [...layer])
    }
  }
  for (let l = 0; l < L; l++) {
    layers[l] = bestOrder[l]!
    renumber(layers[l]!)
  }

  // ---- ports and sizes
  const markKey = (m: Mark) => m
  const buildPorts = (n: LNode, side: Side) => {
    const list = side === 'end' ? n.down : n.up
    const ports: Port[] = []
    for (const s of list) {
      const mark = side === 'end' ? s.upMark : s.lowMark
      const text = side === 'end' ? s.upText : s.lowText
      const own = n.kind === 'real' && text !== ''
      const key = `${markKey(mark)}|${own ? `e${s.edge}` : ''}`
      let p = ports.find(x => x.key === key)
      if (p === undefined) {
        p = { segs: [], at: 0, text: 0, key, order: 0 }
        ports.push(p)
      }
      p.segs.push(s)
      p.text = Math.max(p.text, width(text))
    }
    if (n.kind !== 'real' || (n.box !== undefined && isGlyph(n.box.shape))) {
      // One port only: dummies and glyphs have a single cell to meet.
      if (ports.length > 1) {
        const merged: Port = { segs: ports.flatMap(p => p.segs), at: 0, text: Math.max(...ports.map(p => p.text)), key: 'all', order: 0 }
        ports.length = 0
        ports.push(merged)
      }
    }
    for (const p of ports) for (const s of p.segs) {
      if (side === 'end') s.upPort = p
      else s.lowPort = p
    }
    n.ports[side] = ports
  }
  const gapFor = (text: number) => (lr ? 2 : Math.max(2, text === 0 ? 2 : text + 3))
  const textRoom = (text: number) => (text === 0 ? 0 : text + 1)
  const fits = (slots: number[], ports: Port[], bound: number): boolean => {
    let prev = -Infinity
    let gap = 0
    for (const p of ports) {
      const at = slots.find(a => a >= prev + gap && (lr || a + textRoom(p.text) <= bound))
      if (at === undefined) return false
      prev = at
      gap = gapFor(p.text)
    }
    return true
  }

  for (const n of reals) {
    const node = graph.nodes[n.ref]!
    const box = makeBox(node, opts.maxLabel, opts.maxMember, lr)
    n.box = box
  }
  for (const layer of layers) for (const n of layer) {
    buildPorts(n, 'start')
    buildPorts(n, 'end')
  }
  for (const n of reals) {
    const box = n.box!
    for (let guard = 0; guard < 80; guard++) {
      const slots = portSlots(box, lr)
      if (fits(slots, n.ports.start, box.w - 1) && fits(slots, n.ports.end, box.w - 1)) break
      if (isGlyph(box.shape)) break
      growBox(box, lr)
    }
    let loopLabel = ''
    if (n.loops.length > 0) {
      loopLabel = n.loops.map(e => e.label ?? '').filter(s => s !== '').join(', ')
      if (!lr) while (box.h < 4) growHeight(box)
      else while (box.w < 5) box.w++
    }
    const lw = loopLabel === '' ? 0 : width(loopLabel) + 1
    if (lr) {
      n.mainSize = Math.max(box.w, n.loops.length > 0 ? 5 + lw : 0)
      n.crossSize = box.h + (n.loops.length > 0 ? 2 : 0)
      n.anchor = Math.floor(box.h / 2)
    } else {
      n.mainSize = box.h
      n.crossSize = box.w + (n.loops.length > 0 ? 2 + lw : 0)
      n.anchor = Math.floor(box.w / 2)
    }
  }
  for (const layer of layers) for (const n of layer) {
    if (n.kind === 'label') {
      const lines = n.lines ?? ['']
      const w = Math.max(1, ...lines.map(l => width(l)))
      if (lr) {
        n.mainSize = w + 2
        n.crossSize = lines.length
        n.anchor = 0
      } else {
        n.mainSize = lines.length
        n.crossSize = w
        n.anchor = Math.floor((w - 1) / 2)
      }
    }
  }

  // ---- cross positions
  const crossGap = lr ? 1 : opts.gap
  const boundaryExtra = lr ? 3 : 2
  const sep = (a: LNode, b: LNode): number => {
    let base = crossGap
    if (a.kind === 'pass' && b.kind === 'pass') base = 1
    else if (!lr && (a.kind === 'pass' || b.kind === 'pass')) base = Math.max(1, crossGap - 1)
    if (!useFrames) return base
    const shared = lcaChain(a.chain, b.chain).length
    const boundaries = a.chain.length - shared + (b.chain.length - shared)
    return base + boundaryExtra * boundaries
  }
  const weightOf = (n: LNode) => (n.kind === 'pass' ? 3 : n.kind === 'label' ? 2 : 1)
  const placeLayer = (layer: LNode[], desired: (n: LNode) => number | undefined) => {
    const offs: number[] = []
    let acc = 0
    layer.forEach((n, i) => {
      offs.push(acc)
      const next = layer[i + 1]
      acc += n.crossSize + (next ? sep(n, next) : 0)
    })
    const ys: number[] = []
    const ws: number[] = []
    layer.forEach((n, i) => {
      const d = desired(n)
      ys.push((d ?? n.pos + n.anchor) - n.anchor - offs[i]!)
      ws.push(d === undefined ? 0.05 : weightOf(n))
    })
    const fit = pav(ys, ws)
    layer.forEach((n, i) => (n.pos = Math.round(fit[i]!) + offs[i]!))
  }
  {
    const widths = layers.map(layer => layer.reduce((a, n, i) => a + n.crossSize + (layer[i + 1] ? sep(n, layer[i + 1]!) : 0), 0))
    const widest = Math.max(0, ...widths)
    layers.forEach((layer, l) => {
      let acc = Math.floor((widest - widths[l]!) / 2)
      layer.forEach((n, i) => {
        n.pos = acc
        const next = layer[i + 1]
        acc += n.crossSize + (next ? sep(n, next) : 0)
      })
    })
  }
  const anchorOf = (n: LNode) => n.pos + n.anchor
  for (let round = 0; round < 6; round++) {
    for (let l = 1; l < L; l++) {
      placeLayer(layers[l]!, n => (n.up.length === 0 ? undefined : mean(n.up.map(s => anchorOf(s.up)))))
    }
    for (let l = L - 2; l >= 0; l--) {
      placeLayer(layers[l]!, n => (n.down.length === 0 ? undefined : mean(n.down.map(s => anchorOf(s.low)))))
    }
  }
  for (let l = 0; l < L; l++) {
    placeLayer(layers[l]!, n => {
      const nb = [...n.up.map(s => anchorOf(s.up)), ...n.down.map(s => anchorOf(s.low))]
      return nb.length === 0 ? undefined : mean(nb)
    })
  }

  // ---- port positions
  const slotsOf = (n: LNode): number[] => (n.kind === 'real' ? portSlots(n.box!, lr) : [n.anchor])
  const boundOf = (n: LNode): number => (n.kind === 'real' && !lr ? n.box!.w - 1 : Infinity)
  const placePorts = (n: LNode, side: Side) => {
    const ports = n.ports[side]
    if (ports.length === 0) return
    const slots = slotsOf(n)
    const bound = boundOf(n)
    for (const p of ports) {
      const far = p.segs.map(s => anchorOf(side === 'end' ? s.low : s.up))
      p.order = mean(far)
    }
    ports.sort((a, b) => a.order - b.order)
    const ideals = ports.map(p => (p.segs.length === 1 || ports.length > 1 ? p.order - n.pos : n.anchor))
    if (ports.length === 1 && ports[0]!.segs.length > 1) ideals[0] = n.anchor
    for (let i = 1; i < ideals.length; i++) ideals[i] = Math.max(ideals[i]!, ideals[i - 1]!)
    // Latest slot each port may take and still leave room for the ports after it.
    const ok = (p: Port, a: number) => lr || a + textRoom(p.text) <= bound
    const latest: number[] = new Array<number>(ports.length).fill(Infinity)
    for (let i = ports.length - 1; i >= 0; i--) {
      const p = ports[i]!
      const cap = i === ports.length - 1 ? Infinity : latest[i + 1]! - gapFor(p.text)
      const c = slots.filter(a => a <= cap && ok(p, a))
      latest[i] = c.length > 0 ? c[c.length - 1]! : cap
    }
    const res: number[] = []
    for (let i = 0; i < ports.length; i++) {
      const p = ports[i]!
      const min = i > 0 ? res[i - 1]! + gapFor(ports[i - 1]!.text) : -Infinity
      const cands = slots.filter(a => a >= min && a <= latest[i]! && ok(p, a))
      if (cands.length === 0) {
        const any = slots.filter(a => a >= min)
        res.push(any[0] ?? Math.max(min, slots[0] ?? 0))
        continue
      }
      const ideal = ideals[i]!
      let bestA = cands[0]!
      for (const a of cands) if (Math.abs(a - ideal) < Math.abs(bestA - ideal)) bestA = a
      res.push(bestA)
    }
    ports.forEach((p, i) => (p.at = res[i]!))
  }
  for (const layer of layers) for (const n of layer) {
    placePorts(n, 'start')
    placePorts(n, 'end')
  }
  // Dummies slide (within their gaps) under the line that feeds them, then over the one they feed.
  const slide = (n: LNode, i: number, layer: LNode[], x: number): boolean => {
    const target = x - n.anchor
    const prev = layer[i - 1]
    const next = layer[i + 1]
    const lo = prev ? prev.pos + prev.crossSize + sep(prev, n) : -Infinity
    const hi = next ? next.pos - sep(n, next) - n.crossSize : Infinity
    if (target < lo || target > hi) return false
    n.pos = target
    return true
  }
  for (let l = 0; l < L; l++) {
    const layer = layers[l]!
    layer.forEach((n, i) => {
      const s = n.up[0]
      if (n.kind !== 'real' && s) slide(n, i, layer, s.up.pos + s.upPort!.at)
    })
  }
  for (let l = L - 1; l >= 0; l--) {
    const layer = layers[l]!
    layer.forEach((n, i) => {
      const s = n.down[0]
      const u = n.up[0]
      if (n.kind === 'real' || !s) return
      if (u && u.up.pos + u.upPort!.at === n.pos + n.anchor) return
      slide(n, i, layer, s.low.pos + s.lowPort!.at)
    })
  }
  // Straighten single edges whose ends can meet in one column.
  const rangeOf = (n: LNode, side: Side, p: Port): [number, number] => {
    if (n.kind !== 'real' || p.segs.length > 1) return [n.pos + p.at, n.pos + p.at]
    const ports = n.ports[side]
    const i = ports.indexOf(p)
    const slots = slotsOf(n)
    const prev = ports[i - 1]
    const next = ports[i + 1]
    let lo = slots[0] ?? p.at
    let hi = slots[slots.length - 1] ?? p.at
    if (!lr) hi = Math.min(hi, boundOf(n) - textRoom(p.text))
    if (prev) lo = Math.max(lo, prev.at + gapFor(prev.text))
    if (next) hi = Math.min(hi, next.at - gapFor(p.text))
    return [n.pos + lo, n.pos + hi]
  }
  // Whole edges first: every dummy of an edge and both ports in one column.
  const slideRange = (n: LNode): [number, number] => {
    const layer = layers[n.layer]!
    const i = layer.indexOf(n)
    const prev = layer[i - 1]
    const next = layer[i + 1]
    const lo = prev ? prev.pos + prev.crossSize + sep(prev, n) : -Infinity
    const hi = next ? next.pos - sep(n, next) - n.crossSize : Infinity
    return [lo + n.anchor, hi + n.anchor]
  }
  {
    const chains = new Map<number, Seg[]>()
    for (const s of segs) {
      const c = chains.get(s.edge) ?? []
      c.push(s)
      chains.set(s.edge, c)
    }
    for (const chain of chains.values()) {
      if (chain.length < 2) continue
      const first = chain[0]!
      const lastSeg = chain[chain.length - 1]!
      const straight = chain.every(s => s.up.pos + s.upPort!.at === s.low.pos + s.lowPort!.at)
      if (straight) continue
      let [lo, hi] = rangeOf(first.up, 'end', first.upPort!)
      const [llo, lhi] = rangeOf(lastSeg.low, 'start', lastSeg.lowPort!)
      lo = Math.max(lo, llo)
      hi = Math.min(hi, lhi)
      for (const s of chain.slice(1)) {
        const [a, b] = slideRange(s.up)
        lo = Math.max(lo, a)
        hi = Math.min(hi, b)
      }
      if (lo > hi) continue
      const from = first.up.pos + first.upPort!.at
      const okAt = (x: number) =>
        slotsOf(first.up).includes(x - first.up.pos) && slotsOf(lastSeg.low).includes(x - lastSeg.low.pos)
      let x: number | undefined
      for (let d = 0; d <= hi - lo && x === undefined; d++) {
        for (const c of [from - d, from + d]) if (x === undefined && c >= lo && c <= hi && okAt(c)) x = c
      }
      if (x === undefined) continue
      first.upPort!.at = x - first.up.pos
      lastSeg.lowPort!.at = x - lastSeg.low.pos
      for (const s of chain.slice(1)) s.up.pos = x - s.up.anchor
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const s of segs) {
      const up = s.upPort!
      const low = s.lowPort!
      const a = s.up.pos + up.at
      const b = s.low.pos + low.at
      if (a === b) continue
      const [ulo, uhi] = rangeOf(s.up, 'end', up)
      const [llo, lhi] = rangeOf(s.low, 'start', low)
      const lo = Math.max(ulo, llo)
      const hi = Math.min(uhi, lhi)
      if (lo > hi) continue
      const target = Math.max(lo, Math.min(hi, Math.round((a + b) / 2)))
      const okU = slotsOf(s.up).includes(target - s.up.pos)
      const okL = slotsOf(s.low).includes(target - s.low.pos)
      if (!okU || !okL) continue
      up.at = target - s.up.pos
      low.at = target - s.low.pos
    }
  }

  // ---- tracks
  const xUp = (s: Seg) => s.up.pos + s.upPort!.at
  const xLow = (s: Seg) => s.low.pos + s.lowPort!.at
  const tracksIn: number[] = new Array<number>(Math.max(0, L - 1)).fill(0)
  for (let l = 0; l + 1 < L; l++) {
    const ss: Seg[] = []
    for (const n of layers[l]!) ss.push(...n.down)
    const bundles = new Map<Port, Bundle>()
    for (const s of ss) {
      const key = s.upPort!.segs.length >= 2 ? s.upPort! : s.lowPort!
      let b = bundles.get(key)
      if (b === undefined) {
        b = { segs: [], ups: new Set(), lows: new Set(), min: Infinity, max: -Infinity, track: -1 }
        bundles.set(key, b)
      }
      b.segs.push(s)
      b.ups.add(xUp(s))
      b.lows.add(xLow(s))
      b.min = Math.min(b.min, xUp(s), xLow(s))
      b.max = Math.max(b.max, xUp(s), xLow(s))
    }
    const need = [...bundles.values()].filter(b => b.max > b.min)
    // b must sit above c when b leaves the upper rank in a column where c enters the lower one.
    const above = new Map<Bundle, Set<Bundle>>()
    for (const b of need) above.set(b, new Set())
    for (const b of need) for (const c of need) {
      if (b === c) continue
      for (const x of b.ups) if (c.lows.has(x) && !b.lows.has(x)) above.get(c)!.add(b)
    }
    const placed: Bundle[] = []
    const remaining = new Set(need)
    while (remaining.size > 0) {
      let pick: Bundle | undefined
      for (const b of remaining) {
        const blockers = [...above.get(b)!].filter(x => remaining.has(x)).length
        if (blockers === 0 && (pick === undefined || b.min < pick.min)) pick = b
      }
      if (pick === undefined) {
        for (const b of remaining) if (pick === undefined || b.min < pick.min) pick = b
      }
      const b = pick!
      remaining.delete(b)
      let t = 0
      for (const a of above.get(b)!) if (a.track >= 0) t = Math.max(t, a.track + 1)
      for (;;) {
        const clash = placed.some(o => o.track === t && o.min <= b.max + 1 && b.min <= o.max + 1)
        if (!clash) break
        t++
      }
      b.track = t
      placed.push(b)
    }
    for (const b of placed) for (const s of b.segs) s.track = b.track
    tracksIn[l] = placed.reduce((m, b) => Math.max(m, b.track + 1), 0)
  }

  // ---- frames: which groups, their first and last layers
  type GroupInfo = { id: string; title: string; depth: number; height: number; first: number; last: number; members: Set<LNode> }
  const groups = new Map<string, GroupInfo>()
  if (useFrames) {
    for (const layer of layers) for (const n of layer) {
      n.chain.forEach((g, depth) => {
        let info = groups.get(g)
        if (info === undefined) {
          const title = graph.groups.find(x => x.id === g)?.title ?? ''
          info = { id: g, title, depth, height: 1, first: n.layer, last: n.layer, members: new Set() }
          groups.set(g, info)
        }
        info.members.add(n)
        info.first = Math.min(info.first, n.layer)
        info.last = Math.max(info.last, n.layer)
      })
    }
    // Heights, innermost first.
    const byDepth = [...groups.values()].sort((a, b) => b.depth - a.depth)
    for (const g of byDepth) {
      const parent = parentOf.get(g.id)
      const p = parent !== undefined ? groups.get(parent) : undefined
      if (p) p.height = Math.max(p.height, g.height + 1)
    }
  }
  const startingAt = (l: number) => [...groups.values()].filter(g => g.first === l).sort((a, b) => a.depth - b.depth)
  const endingAt = (l: number) => [...groups.values()].filter(g => g.last === l).sort((a, b) => b.depth - a.depth)

  // ---- main coordinates
  const frameMain = new Map<string, { start: number; end: number }>()
  const layerStart: number[] = []
  const layerEnd: number[] = []
  const trackBase: number[] = []
  let cursor = 0
  {
    const first = startingAt(0)
    first.forEach((g, j) => frameMain.set(g.id, { start: j, end: 0 }))
    if (first.length > 0) cursor = first.length + 1
  }
  for (let l = 0; l < L; l++) {
    const size = Math.max(1, ...layers[l]!.map(n => n.mainSize))
    layerStart[l] = cursor
    layerEnd[l] = cursor + size - 1
    cursor += size
    if (l + 1 >= L) break
    const ss: Seg[] = []
    for (const n of layers[l]!) ss.push(...n.down)
    const realUp = ss.some(s => s.up.kind === 'real')
    const realLow = ss.some(s => s.low.kind === 'real')
    const upDecor = ss.some(s => s.up.kind === 'real' && (s.upMark !== 'none' || s.upText !== ''))
    const k = tracksIn[l]!
    const ends = endingAt(l)
    const starts = startingAt(l + 1)
    let zoneU: number
    let zoneL: number
    if (lr) {
      zoneU = realUp ? Math.max(1, ...ss.filter(s => s.up.kind === 'real').map(s => (s.upText === '' ? 0 : width(s.upText) + 1))) : 0
      zoneL = realLow ? Math.max(1, ...ss.filter(s => s.low.kind === 'real').map(s => (s.lowText === '' ? 0 : width(s.lowText) + 1))) : 0
    } else {
      zoneU = realUp && (!opts.compact || upDecor || k > 0) ? 1 : 0
      zoneL = realLow ? 1 : 0
    }
    if (ends.length > 0) zoneU = Math.max(zoneU, 1)
    if (starts.length > 0) zoneL = Math.max(zoneL, 1)
    const gU = lr ? 1 : 0
    const gL = lr && k > 0 ? 1 : 0
    let size2 = zoneU + ends.length + gU + k + gL + starts.length + zoneL
    const min = lr ? 2 : realUp && realLow && !opts.compact ? 2 : 1
    let pad = 0
    if (size2 < min) {
      pad = min - size2
      size2 = min
    }
    const chStart = cursor
    ends.forEach((g, i) => {
      const fm = frameMain.get(g.id)
      if (fm) fm.end = chStart + zoneU + i
    })
    trackBase[l] = chStart + zoneU + ends.length + gU
    starts.forEach((g, j) => frameMain.set(g.id, { start: chStart + zoneU + ends.length + gU + k + gL + pad + j, end: 0 }))
    cursor += size2
  }
  {
    const ends = endingAt(L - 1)
    ends.forEach((g, i) => {
      const fm = frameMain.get(g.id)
      if (fm) fm.end = cursor + 1 + i
    })
    if (ends.length > 0) cursor += ends.length + 1
  }
  for (let l = 0; l < L; l++) {
    const size = layerEnd[l]! - layerStart[l]! + 1
    for (const n of layers[l]!) {
      if (n.kind === 'real') {
        const boxMain = lr ? n.box!.w : n.box!.h
        n.mStart = layerStart[l]!
        n.mEnd = n.mStart + boxMain - 1
      } else {
        n.mStart = layerStart[l]!
        n.mEnd = layerEnd[l]!
      }
    }
  }

  // ---- frames: cross extents, then a shift so nothing sits left of / above zero
  const frames: Frame[] = []
  let minCross = Infinity
  for (const layer of layers) for (const n of layer) minCross = Math.min(minCross, n.pos)
  const frameCross = new Map<string, [number, number]>()
  for (const g of groups.values()) {
    const ms = [...g.members]
    const padC = 2 * g.height
    const lo = Math.min(...ms.map(n => n.pos)) - padC
    const hi = Math.max(...ms.map(n => n.pos + n.crossSize - 1)) + padC
    frameCross.set(g.id, [lo, hi])
    minCross = Math.min(minCross, lo)
  }
  const shift = Number.isFinite(minCross) ? -minCross : 0
  for (const layer of layers) for (const n of layer) n.pos += shift
  const toPt = (m: number, c: number): Pt => (lr ? { x: m, y: c } : { x: c, y: m })

  // Frames that would cut through a node outside them are left out.
  const footprint = (n: LNode) => {
    const a = toPt(n.mStart, n.pos)
    const b = toPt(n.kind === 'real' ? n.mStart + n.mainSize - 1 : n.mEnd, n.pos + n.crossSize - 1)
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
  }
  const all = layers.flat()
  for (const g of [...groups.values()].sort((a, b) => a.depth - b.depth)) {
    const fm = frameMain.get(g.id)
    const fc = frameCross.get(g.id)
    if (!fm || !fc) continue
    const a = toPt(fm.start, fc[0] + shift)
    const b = toPt(fm.end, fc[1] + shift)
    const f: Frame = { id: g.id, title: g.title, x0: a.x, y0: a.y, x1: b.x, y1: b.y, members: g.members }
    const hits = all.some(n => {
      if (g.members.has(n) || n.kind === 'pass') return false
      const r = footprint(n)
      return r.x0 <= f.x1 && f.x0 <= r.x1 && r.y0 <= f.y1 && f.y0 <= r.y1
    })
    const overlaps = frames.some(o => {
      const inter = o.x0 <= f.x1 && f.x0 <= o.x1 && o.y0 <= f.y1 && f.y0 <= o.y1
      const inside = f.x0 > o.x0 && f.x1 < o.x1 && f.y0 > o.y0 && f.y1 < o.y1
      return inter && !inside
    })
    if (!hits && !overlaps) frames.push(f)
  }

  // ---- draw
  const cv = new Canvas()
  let color = 0
  for (const n of reals) {
    const box = n.box!
    const p = toPt(n.mStart, n.pos)
    const colored = !isGlyph(box.shape) && box.shape !== 'bar'
    drawBox(cv, box, p.x, p.y, inks.node(colored ? color++ : -1))
  }
  for (const layer of layers) for (const n of layer) {
    if (n.kind === 'real') continue
    const c = n.pos + n.anchor
    cv.path([toPt(n.mStart, c), toPt(n.mEnd, c)], n.style, inks.line)
    if (n.kind === 'label') {
      const lines = n.lines ?? []
      const size = n.mEnd - n.mStart + 1
      if (lr) {
        lines.forEach((line, i) => {
          const w = width(line)
          const x = n.mStart + Math.floor((size - w) / 2)
          if (i === 0) cv.text(x - 1, n.pos, ' ' + line + ' ', inks.label)
          else cv.text(x, n.pos + i, line, inks.label)
        })
      } else {
        const top = n.mStart + Math.floor((size - lines.length) / 2)
        const w = n.crossSize
        lines.forEach((line, i) => {
          const lw = width(line)
          cv.text(n.pos + Math.floor((w - lw) / 2), top + i, line, inks.label)
        })
      }
    }
  }
  const glyph = (mark: Mark, positive: boolean): string => {
    switch (mark) {
      case 'arrow':
        return lr ? (positive ? '►' : '◄') : positive ? '▼' : '▲'
      case 'triangle':
        return lr ? (positive ? '▷' : '◁') : positive ? '▽' : '△'
      case 'diamond':
        return '◆'
      case 'diamondOpen':
        return '◇'
      case 'circle':
        return '○'
      case 'cross':
        return '×'
      default:
        return ''
    }
  }
  const marks: { at: Pt; ch: string }[] = []
  const texts: { x: number; y: number; text: string }[] = []
  for (const s of segs) {
    const xu = xUp(s)
    const xl = xLow(s)
    // An end with a mark stops at the mark, so the border under it stays plain.
    const a = s.up.mEnd + (s.up.kind === 'real' && s.upMark !== 'none' ? 1 : 0)
    const b = s.low.mStart - (s.low.kind === 'real' && s.lowMark !== 'none' ? 1 : 0)
    const pts: Pt[] =
      xu === xl || s.track < 0
        ? [toPt(a, xu), toPt(b, xu)]
        : [toPt(a, xu), toPt(trackBase[s.up.layer]! + s.track, xu), toPt(trackBase[s.up.layer]! + s.track, xl), toPt(b, xl)]
    if (xu !== xl && s.track < 0) {
      // No track was given (should not happen): bend halfway.
      const mid = Math.floor((a + b) / 2)
      pts.splice(0, pts.length, toPt(a, xu), toPt(mid, xu), toPt(mid, xl), toPt(b, xl))
    }
    cv.path(pts, s.style, inks.line)
    if (s.up.kind === 'real') {
      const z = s.up.mEnd + 1
      if (s.upMark !== 'none') marks.push({ at: toPt(z, xu), ch: glyph(s.upMark, false) })
      if (s.upText !== '') {
        if (lr) texts.push({ x: z + 1, y: xu - 1, text: s.upText })
        else texts.push({ x: xu + 2, y: z, text: s.upText })
      }
    }
    if (s.low.kind === 'real') {
      const z = s.low.mStart - 1
      if (s.lowMark !== 'none') marks.push({ at: toPt(z, xl), ch: glyph(s.lowMark, true) })
      if (s.lowText !== '') {
        if (lr) texts.push({ x: z - width(s.lowText), y: xl - 1, text: s.lowText })
        else texts.push({ x: xl + 2, y: z, text: s.lowText })
      }
    }
  }
  for (const m of marks) cv.mark(m.at.x, m.at.y, m.ch, inks.line)
  for (const t of texts) {
    let x = t.x
    // Keep a cardinality off the line it belongs to.
    if (!cv.isFree(x, t.y) && cv.isFree(x + 1, t.y)) x++
    cv.text(x, t.y, t.text, inks.label)
  }
  // Self loops.
  for (const n of reals) {
    if (n.loops.length === 0) continue
    const box = n.box!
    const p = toPt(n.mStart, n.pos)
    const e = n.loops[0]!
    const label = n.loops.map(x => x.label ?? '').filter(s => s !== '').join(', ')
    const head = glyph(e.headTo, false)
    if (!lr) {
      const xr = p.x + box.w - 1
      const end = head === '' ? xr : xr + 1
      cv.path([{ x: xr, y: p.y + 1 }, { x: xr + 2, y: p.y + 1 }, { x: xr + 2, y: p.y + 2 }, { x: end, y: p.y + 2 }], e.style, inks.line)
      if (head !== '') cv.mark(xr + 1, p.y + 2, e.headTo === 'arrow' ? '◄' : head, inks.line)
      if (label !== '') cv.text(xr + 4, p.y + 1, label, inks.label)
    } else {
      const yb = p.y + box.h - 1
      const c1 = p.x + 1
      const c2 = p.x + 3
      cv.path([{ x: c1, y: yb }, { x: c1, y: yb + 2 }, { x: c2, y: yb + 2 }, { x: c2, y: head === '' ? yb : yb + 1 }], e.style, inks.line)
      if (head !== '') cv.mark(c2, yb + 1, e.headTo === 'arrow' ? '▲' : head, inks.line)
      if (label !== '') cv.text(c2 + 2, yb + 2, label, inks.label)
    }
  }
  // Frames go in last, in the cells nothing else took; a title goes on the top line
  // beside any edge crossing it, and the frame widens to the right to make room.
  const contains = (o: Frame, f: Frame) => f.x0 > o.x0 && f.x1 < o.x1 && f.y0 > o.y0 && f.y1 < o.y1
  for (const f of [...frames].reverse()) {
    if (f.title === '') continue
    const text = ` ${f.title} `
    const len = width(text)
    const free = (x: number) => cv.isFree(x, f.y0)
    for (let x = f.x0 + 2; x < f.x0 + 2 + 60; x++) {
      let ok = true
      for (let i = -1; i <= len && ok; i++) ok = free(x + i) || (i === -1 && x - 1 === f.x0)
      if (!ok) continue
      const x1 = Math.max(f.x1, x + len + 1)
      if (x1 > f.x1) {
        const grown: Frame = { ...f, x1 }
        let clear = true
        for (let y = f.y0; y <= f.y1 && clear; y++) for (let cx = f.x1; cx <= x1 && clear; cx++) if (cv.isSolid(cx, y)) clear = false
        if (clear) clear = !frames.some(o => o !== f && (contains(o, f) ? !contains(o, grown) : !contains(f, o) && o.x0 <= x1 && f.x0 <= o.x1 && o.y0 <= f.y1 && f.y0 <= o.y1))
        if (!clear) break
        f.x1 = x1
      }
      f.titleAt = x
      break
    }
  }
  for (const f of frames) {
    if (f.titleAt !== undefined) cv.text(f.titleAt, f.y0, ` ${f.title} `, inks.frameTitle)
    for (let x = f.x0 + 1; x < f.x1; x++) {
      cv.frame(x, f.y0, '┄', inks.frame)
      cv.frame(x, f.y1, '┄', inks.frame)
    }
    for (let y = f.y0 + 1; y < f.y1; y++) {
      cv.frame(f.x0, y, '┆', inks.frame)
      cv.frame(f.x1, y, '┆', inks.frame)
    }
    cv.frame(f.x0, f.y0, '╭', inks.frame)
    cv.frame(f.x1, f.y0, '╮', inks.frame)
    cv.frame(f.x0, f.y1, '╰', inks.frame)
    cv.frame(f.x1, f.y1, '╯', inks.frame)
  }
  return { canvas: cv, crossings: best }
}

