import { expect, test } from 'claude-code/testing'

import { GANTT_RENDERERS, daysFromCivil, formatTime, parseDate } from '../hooks/mermaid/gantt'
import { PIE_RENDERERS } from '../hooks/mermaid/pie'
import { QUADRANT_RENDERERS } from '../hooks/mermaid/quadrant'
import { SEQUENCE_RENDERERS } from '../hooks/mermaid/sequence'
import type { DiagramContext, Line, Renderer } from '../hooks/mermaid/types'
import { seriesColors } from '../hooks/mermaid/types'
import { XYCHART_RENDERERS } from '../hooks/mermaid/xychart'
import { resolveTheme } from '../hooks/theme'
import { width as textWidth } from '../hooks/width'

const ALL: Record<string, Renderer> = {
  ...SEQUENCE_RENDERERS, ...XYCHART_RENDERERS, ...PIE_RENDERERS, ...GANTT_RENDERERS, ...QUADRANT_RENDERERS,
}

const THEME = resolveTheme('catppuccin-mocha').theme
const MONO = resolveTheme('mono')

const ctxOf = (width: number, extra: Partial<DiagramContext> = {}): DiagramContext => ({
  theme: THEME, width, isMono: false, pieStyle: 'round', ...extra,
})

const draw = (source: string, width = 80, extra: Partial<DiagramContext> = {}): Line[] => {
  const keyword = source.trim().split(/\s/)[0] ?? ''
  const render = ALL[keyword]
  if (render === undefined) throw new Error(`no renderer for ${keyword}`)
  const r = render(ctxOf(width, extra), source)
  if ('error' in r) throw new Error(r.error)
  return r.lines
}

const text = (lines: Line[]) => lines.map(l => l.map(r => r.text).join(''))
const lineWidth = (l: Line) => l.reduce((n, r) => n + textWidth(r.text), 0)

const SEQ = `sequenceDiagram
  title Login
  actor U as User
  participant W as Web App
  U->>W: Open login page
  W-->>U: Login form
  U->>A: Submit
  loop every minute
    A->>A: refresh token
  end
  alt ok
    A-->>W: 200
  else denied
    A--xW: 401
  end
  Note over W,A: cached
  Note right of A: replica`

const BAR = `xychart-beta
  title "Requests"
  x-axis [us, eu, asia]
  y-axis "count"
  bar [120, 143, 64]`

const PIE = `pie showData title Pets
  "Dogs" : 386
  "Cats" : 85
  "Rats" : 15`

const GANTT = `gantt
  title Release
  dateFormat YYYY-MM-DD
  section Build
  Freeze :done, f, 2024-03-04, 1d
  Fix    :crit, x, after f, 2d
  RC     :milestone, after x, 0d
  section Ship
  QA     :q, after x, 1.2d
  Notes  :n, after q, 1d`

const QUAD = `quadrantChart
  title Campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 Expand
  quadrant-2 Promote
  quadrant-3 Re-evaluate
  quadrant-4 Improve
  A: [0.3, 0.6]
  B: [0.3, 0.6]
  C: [0.8, 0.2]`

test('sequence: boxes top and bottom in one color each, arrows and dashes', () => {
  const lines = draw(SEQ, 80)
  const plain = text(lines)
  const all = plain.join('\n')
  expect(plain[0]).toBe('Login')
  expect(all).toContain('►')
  expect(all).toContain('◄')
  expect(all).toContain('╌')
  expect(all).toContain('×')
  expect(all.includes('▶') || all.includes('◀')).toBe(false)
  expect(all).toContain('Open login page')
  expect(all).toContain('loop')
  expect(all).toContain('[denied]')
  expect(all).toContain('cached')
  // User, Web App and the auto-created A, at the top and again at the bottom.
  const rows = plain.map((l, i) => [l, i] as const).filter(([l]) => l.includes('User') && l.includes('Web App'))
  expect(rows).toHaveLength(2)
  const colors = seriesColors(THEME)
  const colorOf = (row: number, label: string) => lines[row]?.find(r => r.text.includes(label))?.color
  for (const [, row] of rows) {
    expect(colorOf(row, 'User')).toBe(colors[0])
    expect(colorOf(row, 'Web App')).toBe(colors[1])
  }
  // Lifelines are dim.
  expect(lines.some(l => l.some(r => r.text.startsWith('│') && r.dim === true && r.color === colors[0]))).toBe(true)
})

test('sequence: long labels wrap to the width and every line fits', () => {
  const src = `sequenceDiagram
  Alice->>Bob: this is a rather long message that will not fit on one line at all, not even close
  Bob-->>Alice: ok`
  for (const w of [40, 60, 100]) {
    const lines = draw(src, w)
    for (const l of lines) expect(lineWidth(l)).toBeLessThanOrEqual(w)
  }
  const narrow = text(draw(src, 40)).join('\n')
  expect(narrow).toContain('rather long')
})

test('sequence: a broken block or unknown line is an error', () => {
  expect(() => SEQUENCE_RENDERERS.sequenceDiagram?.(ctxOf(80), 'sequenceDiagram\n  loop x\n  A->>B: hi')).toThrow()
  expect(() => SEQUENCE_RENDERERS.sequenceDiagram?.(ctxOf(80), 'sequenceDiagram\n  what is this')).toThrow()
})

test('xychart: one bar series prints values and colors the tallest bar', () => {
  const lines = draw(BAR, 60)
  const plain = text(lines)
  const all = plain.join('\n')
  expect(plain[0]).toBe('Requests')
  for (const v of ['120', '143', '64']) expect(all).toContain(v)
  expect(all).toContain('us')
  expect(all).toContain('asia')
  expect(/[▁▂▃▄▅▆▇]/.test(all)).toBe(true)
  const colors = seriesColors(THEME)
  const barColors = new Set(lines.flatMap(l => l.filter(r => r.text.includes('█')).map(r => r.color)))
  expect(barColors.has(colors[0])).toBe(true)
  expect(barColors.has(colors[1])).toBe(true)
  // The tallest (143) is the accent; gridlines dim in the rule color; tick numbers in the number color.
  expect(lines.some(l => l.some(r => r.text.includes('┈') && r.color === THEME.rule && r.dim === true))).toBe(true)
  expect(lines.some(l => l.some(r => r.text.trim() === '150' && r.color === THEME.number))).toBe(true)
  for (const l of lines) expect(lineWidth(l)).toBeLessThanOrEqual(60)
})

test('xychart: several series get their own colors and a legend; lines in braille', () => {
  const src = `xychart-beta
  x-axis [a, b, c, d]
  bar "before" [3, 5, 2, 4]
  bar "after" [2, 3, 1, 2]
  line "goal" [2, 2, 2, 2]`
  const lines = draw(src, 70)
  const all = text(lines).join('\n')
  expect(all).toContain('before')
  expect(all).toContain('after')
  expect(all).toContain('goal')
  expect(/[⠁-⣿]/.test(all)).toBe(true)
  const colors = seriesColors(THEME)
  const used = new Set(lines.flatMap(l => l.filter(r => /[█▁-▇]/.test(r.text)).map(r => r.color)))
  expect(used.has(colors[0])).toBe(true)
  expect(used.has(colors[1])).toBe(true)
})

test('xychart: horizontal bars and number ranges', () => {
  const h = text(draw(`xychart-beta horizontal
  x-axis [lumen, prism]
  bar [320, 1250]`, 60)).join('\n')
  expect(h).toContain('lumen │')
  expect(h).toContain('1250')
  const r = text(draw(`xychart-beta
  x-axis "week" 1 --> 4
  y-axis "load" 0 --> 100
  line [10, 40, 30, 90]`, 60)).join('\n')
  expect(r).toContain('week')
  expect(r).toContain('100')
})

test('pie: a round pie with the legend largest first', () => {
  const lines = draw(PIE, 80)
  const plain = text(lines)
  expect(plain[0]).toBe('Pets')
  const all = plain.join('\n')
  expect(all.indexOf('Dogs')).toBeLessThan(all.indexOf('Cats'))
  expect(all.indexOf('Cats')).toBeLessThan(all.indexOf('Rats'))
  expect(all).toContain('79.4%')
  expect(all).toContain('(386)')
  const colors = seriesColors(THEME)
  const used = new Set(lines.flatMap(l => l.filter(r => /[█▀▄]/.test(r.text)).map(r => r.color)))
  for (const c of colors.slice(0, 3)) expect(used.has(c)).toBe(true)
  // A circle: more rows than one, wider than tall.
  const circleRows = plain.filter(l => /[█▀▄]{4,}/.test(l))
  expect(circleRows.length).toBeGreaterThan(5)
})

test('pie: bars when narrow, in mono, or asked for', () => {
  for (const ctx of [{ width: 34 }, { width: 80, pieStyle: 'bars' as const }]) {
    const plain = text(draw(PIE, ctx.width, ctx))
    expect(plain[2]?.startsWith('Dogs')).toBe(true)
    expect(plain[3]?.startsWith('Cats')).toBe(true)
  }
  const mono = PIE_RENDERERS.pie?.({ theme: MONO.theme, width: 80, isMono: true, pieStyle: 'round' }, PIE)
  expect(mono !== undefined && 'lines' in mono).toBe(true)
  if (mono !== undefined && 'lines' in mono) {
    expect(mono.lines.every(l => l.every(r => r.color === undefined))).toBe(true)
    expect(text(mono.lines)[2]?.startsWith('Dogs')).toBe(true)
  }
})

test('gantt: sections, shared axis, crit red, done dim, milestone', () => {
  const lines = draw(GANTT, 80)
  const plain = text(lines)
  const all = plain.join('\n')
  expect(plain[0]).toBe('Release')
  expect(all).toContain('Build')
  expect(all).toContain('Ship')
  expect(all).toContain('◆')
  expect(all).toContain('Mar 04')
  const fix = lines.find(l => l.some(r => r.text.includes('Fix')))
  expect(fix?.some(r => r.text.includes('█') && r.color === THEME.alertCaution)).toBe(true)
  const freeze = lines.find(l => l.some(r => r.text.includes('Freeze')))
  expect(freeze?.some(r => r.text.includes('█') && r.dim === true)).toBe(true)
  // 1.2 days ends on an eighth; the task after it starts on a half cell.
  const qa = plain.find(l => l.includes('QA')) ?? ''
  expect(/█[▏▎▍▌▋▊▉]/.test(qa)).toBe(true)
  const notes = plain.find(l => l.includes('Notes')) ?? ''
  expect(notes).toContain('▐█')
  for (const l of lines) expect(lineWidth(l)).toBeLessThanOrEqual(80)
})

test('gantt: times of day, and dates read without a clock', () => {
  const all = text(draw(`gantt
  dateFormat HH:mm
  axisFormat %H:%M
  Drain   :a, 22:00, 15m
  Migrate :crit, b, after a, 40m
  Deploy  :after b, 30m`, 70)).join('\n')
  expect(all).toContain('22:00')
  expect(all).toContain('Migrate')
  expect(daysFromCivil(1970, 1, 1)).toBe(0)
  expect(daysFromCivil(2024, 3, 1) - daysFromCivil(2024, 2, 28)).toBe(2)
  expect(parseDate('2024-03-04', 'YYYY-MM-DD')).toBe(daysFromCivil(2024, 3, 4) * 1440)
  expect(parseDate('22:15', 'HH:mm')).toBe(22 * 60 + 15)
  expect(parseDate('nope', 'YYYY-MM-DD')).toBeUndefined()
  expect(formatTime(daysFromCivil(2024, 3, 4) * 1440 + 90, '%Y-%m-%d %H:%M %a %b')).toBe('2024-03-04 01:30 Mon Mar')
})

test('quadrant: names in corners, points numbered, clashes moved apart, legend', () => {
  const lines = draw(QUAD, 70)
  const plain = text(lines)
  const all = plain.join('\n')
  for (const name of ['Expand', 'Promote', 'Re-evaluate', 'Improve', 'Low Reach', 'High Reach']) expect(all).toContain(name)
  const grid = plain.filter(l => l.includes('│'))
  const top = grid[0] ?? ''
  expect(top.indexOf('Promote')).toBeLessThan(top.indexOf('Expand'))
  // A and B share a spot: both drawn, in different cells.
  const spots = (n: string) => grid.flatMap((l, r) => [...l].map((ch, x) => (ch === n ? `${x}:${r}` : '')).filter(s => s !== ''))
  expect(spots('1')).toHaveLength(1)
  expect(spots('2')).toHaveLength(1)
  expect(spots('1')[0]).not.toBe(spots('2')[0])
  expect(all).toContain('1 A (0.3, 0.6)')
  expect(all).toContain('3 C (0.8, 0.2)')
})

test('mono: no colors anywhere, and still drawn', () => {
  for (const src of [SEQ, BAR, PIE, GANTT, QUAD]) {
    const keyword = src.split(/\s/)[0] ?? ''
    const r = ALL[keyword]?.({ theme: MONO.theme, width: 80, isMono: true, pieStyle: 'round' }, src)
    expect(r !== undefined && 'lines' in r).toBe(true)
    if (r !== undefined && 'lines' in r) {
      expect(r.lines.length).toBeGreaterThan(3)
      expect(r.lines.every(l => l.every(x => x.color === undefined && x.bg === undefined))).toBe(true)
    }
  }
})

test('every chart fits the width it is given', () => {
  for (const src of [SEQ, BAR, PIE, GANTT, QUAD]) {
    for (const w of [40, 50, 60, 80, 100, 120]) {
      const keyword = src.split(/\s/)[0] ?? ''
      const r = ALL[keyword]?.(ctxOf(w), src)
      if (r === undefined || 'error' in r) continue
      for (const l of r.lines) expect(lineWidth(l)).toBeLessThanOrEqual(w)
    }
  }
})

test('bad input is an error, not a drawing', () => {
  const bad = (r: Renderer | undefined, src: string) => {
    let failed = false
    try {
      const out = r?.(ctxOf(80), src)
      failed = out === undefined || 'error' in out
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  }
  bad(XYCHART_RENDERERS['xychart-beta'], 'xychart-beta\n  x-axis [a, b]')
  bad(XYCHART_RENDERERS['xychart-beta'], 'xychart-beta\n  bar [1, two]')
  bad(PIE_RENDERERS.pie, 'pie\n  "a" : x')
  bad(GANTT_RENDERERS.gantt, 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, after nothing, 1d')
  bad(QUADRANT_RENDERERS.quadrantChart, 'quadrantChart\n  A: [x, y]')
})
