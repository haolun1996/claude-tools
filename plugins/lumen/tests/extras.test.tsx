import { expect, test } from 'claude-code/testing'

import { drawBlocks } from '../hooks/blocks'
import { inline } from '../hooks/inline'
import { isBlockedPath, isOpenableLink, pathHref } from '../hooks/links'
import { parse } from '../hooks/markdown'
import { styleOf } from '../hooks/options'
import { displayMath, footnotes, mathText } from '../hooks/prepare'

const text = (lines: { text: string }[][]) => lines.map(l => l.map(r => r.text).join(''))
const base = { cwd: '/repo', home: '/Users/me' }

test('footnotes become superscript marks with their notes pulled out', () => {
  const out = footnotes('Fast[^a] and safe[^b].\n\n[^a]: Measured.\n[^b]: Audited\n  twice.\n\n```\n[^a] in code\n```')
  expect(out.text).toBe('Fast¹ and safe².\n\n\n```\n[^a] in code\n```')
  expect(out.notes).toEqual([{ mark: '¹', text: 'Measured.' }, { mark: '²', text: 'Audited twice.' }])
})

test('display math turns into math blocks; inline math into symbols', () => {
  expect(displayMath('a\n$$x^2$$\nb')).toBe('a\n```math\nx^2\n```\nb')
  expect(displayMath('$$\n\\frac{1}{2}\n$$')).toBe('```math\n\\frac{1}{2}\n```')
  expect(mathText('\\rho \\cdot v \\le c')).toBe('ρ · v ≤ c')
  const style = styleOf({})
  expect(inline(style, 'costs $5 and $\\alpha$').map(r => r.text)).toEqual(['costs $', '5', ' and ', 'α'])
})

test('paths link to their file; programs never do', () => {
  expect(pathHref(base, '~/src/app.ts')).toBe('file:///Users/me/src/app.ts')
  expect(pathHref(base, './a b.md')).toBe('file:///repo/./a%20b.md')
  expect(pathHref(base, '/config')).toBeUndefined()
  expect(pathHref(base, '/tmp/run.sh')).toBeUndefined()
  expect(pathHref(base, '/Applications/X.app/Contents/a.txt')).toBeUndefined()
  expect(isBlockedPath('C:\\Users\\me\\setup.EXE')).toBe(true)
  expect(isOpenableLink('vscode://file/repo/a.ts:12')).toBe(true)
  expect(isOpenableLink('vscode://file/repo/a.ps1')).toBe(false)
  expect(isOpenableLink('vscode://extension/x')).toBe(false)
})

test('a file link with other text shows its target and does not open', () => {
  const style = { ...styleOf({}), links: base }
  const runs = inline(style, '[the docs](file:///tmp/setup.command)')
  expect(runs.map(r => r.text).join('')).toBe('the docs (file:///tmp/setup.command)')
  expect(runs.some(r => r.href !== undefined)).toBe(false)
  const path = inline(style, 'see ~/notes/a.md')
  expect(path.find(r => r.text === '~/notes/a.md')?.href).toBe('file:///Users/me/notes/a.md')
})

test('back-to-back tables sit side by side when they fit', () => {
  const md = '| A |\n|---|\n| 1 |\n\n| B |\n|---|\n| 2 |'
  const wide = text(drawBlocks(styleOf({}), parse(md), 60))
  expect(wide[0]).toBe('┌───┐   ┌───┐')
  const narrow = text(drawBlocks(styleOf({}), parse(md), 10))
  expect(narrow[0]).toBe('┌───┐')
})

test('a status table colors its cells and adds a count line', () => {
  const style = styleOf({ statusMatrix: 'summary' })
  const lines = drawBlocks(style, parse('| Job | Status |\n|---|---|\n| build | ✓ passed |\n| test | ✗ failed |'), 60)
  const failed = lines.flat().find(r => r.text.includes('failed'))
  expect(failed?.color).toBe(style.theme.diffRemoved)
  expect(text(lines).at(-1)).toContain('1')
})

test('a figure draws; a bad one stays code with a note', () => {
  const ok = text(drawBlocks(styleOf({}), parse('```figure\n{accent:──►} {ok:done}\n```'), 40))
  expect(ok).toEqual(['──► done'])
  const bad = text(drawBlocks(styleOf({}), parse('```figure\n{Warn:x}\n```'), 40))
  expect(bad[0]).toStartWith('figure kept as code: ')
})

test('the hints note is added to the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', outputStyle: null, surfaces: ['terminal'], tools: [], traits: [], sections: [] } as never)
  expect(composed.sections.map(s => s.id)).toEqual(['intro', 'lumen:hints'])
})
