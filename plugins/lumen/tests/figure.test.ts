import { expect, test } from 'claude-code/testing'

import { drawFigure, signalColors } from '../hooks/figure'
import { THEME_NAMES, resolveTheme } from '../hooks/theme'

const { theme } = resolveTheme('catppuccin-mocha')

const draw = (source: string, width = 80, isMono = false) => drawFigure(theme, isMono, source, width)
const errorOf = (source: string, width = 80) => {
  const r = draw(source, width)
  return 'error' in r ? r.error : 'drew'
}
const linesOf = (source: string, isMono = false) => {
  const r = draw(source, 80, isMono)
  if ('error' in r) throw new Error(r.error)
  return r.lines
}

test('lines draw as written; roles color their runs, the rest takes diagramText', () => {
  const lines = linesOf('Provider  {accent:████}{warn:✗} timeout\n\n{dim:side} {strong:key} {ok:done} {note:10 s}')
  expect(lines).toHaveLength(3)
  expect(lines.map(l => l.map(r => r.text).join(''))).toEqual(['Provider  ████✗ timeout', '', 'side key done 10 s'])
  const first = lines[0] ?? []
  expect(first[0]).toEqual({ text: 'Provider  ', color: theme.diagramText })
  expect(first[1]).toEqual({ text: '████', color: theme.diagram })
  const signals = signalColors(theme)
  expect(first[2]).toEqual({ text: '✗', color: signals.warn })
  const third = lines[2] ?? []
  expect(third.find(r => r.text === 'side')?.color).toBe(theme.codeComment)
  expect(third.find(r => r.text === 'key')).toEqual({ text: 'key', color: theme.strong, bold: true })
  expect(third.find(r => r.text === 'done')?.color).toBe(signals.ok)
  expect(third.find(r => r.text === '10 s')?.color).toBe(signals.note)
})

test('a trailing newline is not a line; literal braces stay text', () => {
  expect(linesOf('a\n')).toHaveLength(1)
  expect(linesOf('{ x }  {1:2}  }').map(l => l.map(r => r.text).join(''))).toEqual(['{ x }  {1:2}  }'])
})

test('▶ and ◀ draw as ► and ◄', () => {
  expect(linesOf('a ▶ b ◀ c')[0]?.map(r => r.text).join('')).toBe('a ► b ◄ c')
})

test('warn, ok and note are the reddest, greenest, most amber colors: distinct, never the diagram color', () => {
  for (const name of THEME_NAMES) {
    if (name === 'mono' || name === 'random') continue
    const th = resolveTheme(name).theme
    const s = signalColors(th)
    expect([name, s.warn !== undefined && s.ok !== undefined && s.note !== undefined]).toEqual([name, true])
    expect(new Set([s.warn, s.ok, s.note]).size).toBe(3)
    expect([s.warn, s.ok, s.note]).not.toContain(th.diagram)
  }
  expect(signalColors(theme)).toEqual({ warn: theme.diffRemoved, ok: theme.diffAdded, note: theme.alertWarning })
})

test('non-hex colors are ignored when picking', () => {
  expect(signalColors({ diagram: '#ff0000', diffRemoved: 'red', diffAdded: '#00ff00', alertWarning: 'ansi256(3)', number: '#ffaa00' })).toEqual({ ok: '#00ff00', note: '#ffaa00' })
})

test('mono: no colors, warn bold, dim dim, strong bold', () => {
  const mono = resolveTheme('mono')
  const r = drawFigure(mono.theme, true, '{warn:x} {dim:y} {strong:z} {ok:w}', 80)
  if ('error' in r) throw new Error(r.error)
  const runs = r.lines[0] ?? []
  expect(runs.every(x => x.color === undefined)).toBe(true)
  expect(runs.find(x => x.text === 'x')?.bold).toBe(true)
  expect(runs.find(x => x.text === 'y')?.dim).toBe(true)
  expect(runs.find(x => x.text === 'z')?.bold).toBe(true)
  expect(runs.find(x => x.text === 'w')?.bold).toBeUndefined()
})

test('frames are not checked', () => {
  expect(errorOf('┌──────┐\n│ box   \n└───┘')).toBe('drew')
})

test('refuses more than 80 lines', () => {
  expect(errorOf(Array.from({ length: 81 }, () => 'x').join('\n'))).toMatch(/81 lines, more than 80/)
  expect(errorOf(Array.from({ length: 80 }, () => 'x').join('\n'))).toBe('drew')
})

test('refuses a line wider than the window or than 100 columns', () => {
  expect(errorOf('ok\n' + 'x'.repeat(61), 60)).toBe('figure line 2: 61 columns, wider than the window (60)')
  expect(errorOf('x'.repeat(101), 200)).toBe('figure line 1: 101 columns, wider than 100')
  expect(errorOf('x'.repeat(100), 200)).toBe('drew')
  // Markup takes no columns.
  expect(errorOf(`{accent:${'x'.repeat(60)}}`, 60)).toBe('drew')
})

test('refuses glyphs that may draw as emoji', () => {
  expect(errorOf('a\nb\nc\nrisk ⚠ here')).toBe('figure line 4: "⚠" may draw as an emoji, use a text glyph')
  for (const ch of ['✔', '❤', '☀', '✅', '🚀', '⭐']) expect(errorOf(`x ${ch}`)).toMatch(/may draw as an emoji/)
  expect(errorOf('✓ ✗ ● ○ ★ → ← ↑ ↓ ↔ █ ▏ ─ │ ► ◄ ▲ ▼ ■ □')).toBe('drew')
  expect(errorOf('ok ✔️')).toMatch(/emoji/)
})

test('refuses two-column glyphs', () => {
  expect(errorOf('名前')).toBe('figure line 1: "名" takes two columns, use a one-column glyph')
})

test('refuses a tab and control characters', () => {
  expect(errorOf('a\tb')).toBe('figure line 1: a tab, use spaces')
  expect(errorOf('a\u0007b')).toBe('figure line 1: control character U+0007')
  expect(errorOf('a\u009bb')).toBe('figure line 1: control character U+009B')
})

test('refuses direction marks and zero-width characters', () => {
  expect(errorOf('a​b')).toMatch(/U\+200B \(zero-width space\) draws no column/)
  expect(errorOf('a‍b')).toMatch(/zero-width joiner/)
  expect(errorOf('a­b')).toMatch(/soft hyphen/)
  expect(errorOf('a‎b')).toMatch(/left-to-right mark/)
  expect(errorOf('a‏b')).toMatch(/right-to-left mark/)
  expect(errorOf('a‮b')).toMatch(/direction override/)
  expect(errorOf('a﻿b')).toMatch(/byte order mark/)
  expect(errorOf('é')).toMatch(/combining mark/)
})

test('refuses broken role markup', () => {
  expect(errorOf('{Warn:x}')).toBe('figure line 1: role "{Warn:" is in the wrong case, write {warn:')
  expect(errorOf('{OK:x}')).toMatch(/wrong case/)
  expect(errorOf('{wran:x}')).toMatch(/unknown role "\{wran:"/)
  expect(errorOf('{ok:a {warn:b} c}')).toMatch(/\{warn: is nested inside \{ok:/)
  expect(errorOf('a {ok:b')).toBe('figure line 1: {ok: is left open, close it with }')
  expect(errorOf('{ok:a\nb}')).toMatch(/^figure line 1: \{ok: is left open/)
})
