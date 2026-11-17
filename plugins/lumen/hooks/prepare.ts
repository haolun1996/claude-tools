// Text passes before parsing: footnotes ([^1] marks and their definitions),
// display math ($$ … $$ on lines of their own, turned into ```math blocks).
// Fenced code is left alone by both.

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

export const superscript = (n: number) => String(n).split('').map(d => SUPERSCRIPT[Number(d)] ?? d).join('')

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Calls `fn` on each run of lines outside fenced code, keeping fences as they are. */
const outsideFences = (text: string, fn: (lines: string[]) => string[]): string => {
  const out: string[] = []
  let chunk: string[] = []
  let fence: string | undefined
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line)
    if (fence === undefined && m) {
      out.push(...fn(chunk))
      chunk = []
      fence = m[1]?.[0]
      out.push(line)
      continue
    }
    if (fence !== undefined) {
      out.push(line)
      if (m && m[1]?.[0] === fence && line.trim().replace(/[`~]/g, '') === '') fence = undefined
      continue
    }
    chunk.push(line)
  }
  if (fence === undefined) out.push(...fn(chunk))
  else out.push(...chunk)
  return out.join('\n')
}

export type Footnotes = { text: string; notes: { mark: string; text: string }[] }

const DEFINITION = /^\[\^([^\]\s]+)\]:\s?(.*)$/

/** Turns [^id] marks into superscript numbers, in order of first use, and pulls out their notes. */
export const footnotes = (text: string): Footnotes => {
  if (!text.includes('[^')) return { text, notes: [] }
  const defs = new Map<string, string>()
  let body = outsideFences(text, lines => {
    const kept: string[] = []
    let last: string | undefined
    for (const line of lines) {
      const d = DEFINITION.exec(line)
      if (d) {
        last = d[1] as string
        defs.set(last, d[2] ?? '')
        continue
      }
      if (last !== undefined && /^\s{2,}\S/.test(line)) {
        defs.set(last, `${defs.get(last) ?? ''} ${line.trim()}`)
        continue
      }
      last = undefined
      kept.push(line)
    }
    return kept
  })
  if (defs.size === 0) return { text, notes: [] }
  const order: string[] = []
  body = outsideFences(body, lines =>
    lines.map(line =>
      line.replace(/\[\^([^\]\s]+)\]/g, (whole, id: string) => {
        if (!defs.has(id)) return whole
        if (!order.includes(id)) order.push(id)
        return superscript(order.indexOf(id) + 1)
      }),
    ),
  )
  return { text: body, notes: order.map((id, n) => ({ mark: superscript(n + 1), text: defs.get(id) ?? '' })) }
}

/** `$$ … $$` on lines of their own (one line or several) becomes a ```math block. */
export const displayMath = (text: string): string => {
  if (!text.includes('$$')) return text
  return outsideFences(text, lines => {
    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line)
      if (one) {
        out.push('```math', (one[1] ?? '').trim(), '```')
        continue
      }
      if (line.trim() === '$$') {
        const end = lines.findIndex((l, j) => j > i && l.trim() === '$$')
        if (end !== -1) {
          out.push('```math', ...lines.slice(i + 1, end), '```')
          i = end
          continue
        }
      }
      out.push(line)
    }
    return out
  })
}

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  infty: '∞', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇', sqrt: '√', to: '→', rightarrow: '→',
  leftarrow: '←', Rightarrow: '⇒', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃',
  ldots: '…', cdots: '⋯', circ: '∘', deg: '°',
}

/** Inline math as text: commands such as \rho and \cdot shown as their symbols, braces dropped. */
export const mathText = (tex: string): string =>
  tex
    .replace(/\\([A-Za-z]+)/g, (whole, name: string) => SYMBOLS[name] ?? whole)
    .replace(/\\[,;: ]/g, ' ')
    .replace(/[{}]/g, '')
    .trim()

/** The `$…$` spans of a line that are math, not amounts like `$5`. */
export const INLINE_MATH = /^\$(?![\s\d])((?:[^$\\\n]|\\.)+?)(?<!\s)\$(?!\d)/
