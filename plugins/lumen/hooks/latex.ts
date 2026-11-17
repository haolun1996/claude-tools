// Display math typeset as pictures by RaTeX's renderer (`ratex-render`, a
// separate program the person installs), in terminals that draw images:
// kitty and Ghostty outside tmux, or where CLAUDE_CODE_FORCE_TERMINAL_IMAGES
// says so. Anywhere else formulas stay text.

import type { EngineInterface } from 'claude-code'

export type Formula = { png: string; columns: number; rows: number }

export type Latex = {
  /** Whether formulas can be drawn as pictures this session. */
  isOn: boolean
  dir: string
  color: string
  cache: Map<string, Formula | null>
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Width and height from a PNG's IHDR, read straight from its base64. */
export const pngSize = (base64: string): { width: number; height: number } | undefined => {
  const bytes: number[] = []
  const head = base64.slice(0, 44)
  for (let i = 0; i + 3 < head.length; i += 4) {
    const n = (B64.indexOf(head[i] ?? 'A') << 18) | (B64.indexOf(head[i + 1] ?? 'A') << 12) | (B64.indexOf(head[i + 2] ?? 'A') << 6) | B64.indexOf(head[i + 3] ?? 'A')
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  if (bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return undefined
  const at = (o: number) => (((bytes[o] ?? 0) << 24) | ((bytes[o + 1] ?? 0) << 16) | ((bytes[o + 2] ?? 0) << 8) | (bytes[o + 3] ?? 0)) >>> 0
  return { width: at(16), height: at(20) }
}

/** The cells a picture takes: rows from its height (about 36 px a row at dpr 2), columns keeping its shape on 1:2 cells. */
export const cellsOf = (size: { width: number; height: number }, maxColumns: number): { columns: number; rows: number } => {
  let rows = Math.max(1, Math.min(8, Math.round(size.height / 36)))
  let columns = Math.max(1, Math.round((size.width / size.height) * rows * 2))
  if (columns > maxColumns) {
    rows = Math.max(1, Math.floor((rows * maxColumns) / columns))
    columns = Math.max(1, Math.round((size.width / size.height) * rows * 2))
  }
  return { columns, rows }
}

/** Whether this terminal draws pictures, judged from the environment. */
export async function canDrawImages($: EngineInterface): Promise<boolean> {
  const none = () => undefined
  if ((await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES').catch(none)) === '1') return true
  if ((await $.env.get('TMUX').catch(none)) !== undefined) return false
  const program = ((await $.env.get('TERM_PROGRAM').catch(none)) ?? '').toLowerCase()
  const term = ((await $.env.get('TERM').catch(none)) ?? '').toLowerCase()
  const kitty = await $.env.get('KITTY_WINDOW_ID').catch(none)
  return program === 'ghostty' || term.includes('kitty') || term.includes('ghostty') || kitty !== undefined
}

/** Renders one formula to a PNG through ratex-render; null when it cannot. */
export async function renderFormula($: EngineInterface, latex: Latex, tex: string, maxColumns: number): Promise<Formula | null> {
  const key = `${maxColumns}:${tex}`
  const hit = latex.cache.get(key)
  if (hit !== undefined) return hit
  const out = `${latex.dir}/${latex.cache.size}`
  const ran = await $.process
    .run(['ratex-render', '--output-dir', out, '--color', latex.color, '--background-color', 'transparent', '--dpr', '2', '--padding', '4'], { stdin: `${tex.replace(/\n/g, ' ')}\n`, timeoutMs: 5000 })
    .catch(() => undefined)
  let result: Formula | null = null
  if (ran !== undefined && ran.exitCode === 0) {
    const files = await $.fs.list(out).catch(() => [])
    const png = files.find(f => f.name.endsWith('.png'))
    if (png !== undefined) {
      const read = await $.fs.read(`${out}/${png.name}`, { as: 'bytes' }).catch(() => undefined)
      const size = read === undefined ? undefined : pngSize(read.base64)
      if (read !== undefined && size !== undefined) result = { png: read.base64, ...cellsOf(size, maxColumns) }
    }
  }
  latex.cache.set(key, result)
  if (latex.cache.size > 300) latex.cache.delete(latex.cache.keys().next().value as string)
  return result
}

/** Sets LaTeX up for the session: a scratch folder, and one test formula that must come back. */
export async function startLatex($: EngineInterface, color: string): Promise<Latex> {
  const off: Latex = { isOn: false, dir: '', color, cache: new Map() }
  if (!(await canDrawImages($))) return off
  const dir = await $.process.run(['mktemp', '-d'], { timeoutMs: 2000 }).catch(() => undefined)
  if (dir === undefined || dir.exitCode !== 0) return off
  const latex: Latex = { isOn: true, dir: dir.stdout.trim(), color, cache: new Map() }
  const test = await renderFormula($, latex, 'x^2', 40)
  return test === null ? off : latex
}
