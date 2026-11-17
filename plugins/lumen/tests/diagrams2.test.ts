import { expect, test } from 'claude-code/testing'

import { GITGRAPH_RENDERERS } from '../hooks/mermaid/gitgraph'
import { JOURNEY_RENDERERS } from '../hooks/mermaid/journey'
import { KANBAN_RENDERERS } from '../hooks/mermaid/kanban'
import { MINDMAP_RENDERERS } from '../hooks/mermaid/mindmap'
import type { DiagramContext, Line, Renderer } from '../hooks/mermaid/types'
import { resolveTheme } from '../hooks/theme'
import { lineWidth } from '../hooks/wrap'

const ctxOf = (width: number, theme = 'catppuccin-mocha'): DiagramContext => {
  const r = resolveTheme(theme)
  return { theme: r.theme, width, isMono: r.isMono, pieStyle: 'bars' }
}

const linesOf = (render: Renderer | undefined, source: string, width: number, theme?: string): Line[] => {
  if (render === undefined) throw new Error('no renderer')
  const res = render(ctxOf(width, theme), source)
  if ('error' in res) throw new Error(res.error)
  for (const l of res.lines) expect(lineWidth(l)).toBeLessThanOrEqual(width)
  expect(res.lines.length).toBeLessThanOrEqual(80)
  return res.lines
}

const plain = (lines: Line[]) => lines.map(l => l.map(r => r.text).join(''))
const runWith = (lines: Line[], text: string) => lines.flat().find(r => r.text.includes(text))
const errorOf = (render: Renderer | undefined, source: string, width = 80) => {
  const res = render?.(ctxOf(width), source)
  return res !== undefined && 'error' in res ? res.error : undefined
}

// ---------------------------------------------------------------- mindmap

const MINDMAP = `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
        Uses
            Creative techniques
            Strategic planning
    Tools
      id1[Pen and paper]
      id2{{Mermaid}}:::big`

test('mindmap: a tree to the right, each top-level branch in its own color', () => {
  const lines = linesOf(MINDMAP_RENDERERS.mindmap, MINDMAP, 100)
  const text = plain(lines)
  expect(text[0]).toBe('mindmap ─┬─ Origins ─┬─ Long history')
  expect(text).toContain('         │           └─ Popularisation ─── British popular psychology author Tony Buzan')
  expect(text.some(l => l.includes('├─ Research ─┬─ On effectiveness and features'))).toBe(true)
  expect(text.some(l => l.includes('└─ Tools ─┬─ Pen and paper'))).toBe(true)
  expect(text.some(l => l.includes('└─ Mermaid'))).toBe(true)
  expect(text.join('\n')).not.toContain('icon')
  const t = ctxOf(100).theme
  expect(runWith(lines, 'mindmap')?.color).toBe(t.accent)
  expect(runWith(lines, 'mindmap')?.bold).toBe(true)
  const colors = ['Origins', 'Research', 'Tools'].map(n => runWith(lines, n)?.color)
  expect(new Set(colors).size).toBe(3)
  // A branch's whole subtree shares its color.
  expect(runWith(lines, 'Strategic planning')?.color).toBe(runWith(lines, 'Research')?.color)
})

test('mindmap: too wide becomes an indented outline that wraps', () => {
  const lines = linesOf(MINDMAP_RENDERERS.mindmap, MINDMAP, 30)
  const text = plain(lines)
  expect(text[0]).toBe('mindmap')
  expect(text[1]).toBe('├─ Origins')
  expect(text).toContain('│  ├─ Long history')
  expect(text).toContain('│     └─ British popular')
  expect(text).toContain('└─ Tools')
  expect(runWith(lines, 'Origins')?.color).not.toBe(runWith(lines, 'Tools')?.color)
})

test('mindmap: node shapes give their text', () => {
  const text = plain(linesOf(MINDMAP_RENDERERS.mindmap, 'mindmap\n  a[Square]\n    b(Round)\n    c((Circle))\n    d))Bang((\n    e)Cloud(\n    f{{Hex}}\n    Bare words (here)', 100))
  expect(text[0]).toBe('Square ─┬─ Round')
  for (const word of ['Circle', 'Bang', 'Cloud', 'Hex', 'Bare words (here)']) expect(text.some(l => l.endsWith(word))).toBe(true)
})

test('mindmap: mono keeps no colors; an empty map is an error', () => {
  const lines = linesOf(MINDMAP_RENDERERS.mindmap, MINDMAP, 100, 'mono')
  expect(lines.flat().every(r => r.color === undefined)).toBe(true)
  expect(runWith(lines, 'mindmap')?.bold).toBe(true)
  expect(errorOf(MINDMAP_RENDERERS.mindmap, 'mindmap\n')).toBeDefined()
})

// ---------------------------------------------------------------- journey

const JOURNEY = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 4: Me`

test('journey: sections over tasks and a mood line by score', () => {
  const lines = linesOf(JOURNEY_RENDERERS.journey, JOURNEY, 100)
  const text = plain(lines)
  expect(text[0]).toBe('My working day')
  const header = text.find(l => l.includes('Go to work')) ?? ''
  expect(header).toContain('Go home')
  expect(header).toContain('───')
  const at = (score: number) => text.find(l => l.startsWith(`${score} ┤`)) ?? ''
  expect((at(5).match(/●/g) ?? []).length).toBe(2)
  expect((at(4).match(/●/g) ?? []).length).toBe(1)
  expect((at(3).match(/●/g) ?? []).length).toBe(1)
  expect((at(1).match(/●/g) ?? []).length).toBe(1)
  expect(at(2)).not.toContain('●')
  const t = ctxOf(100).theme
  // Dots read row by row from score 5 down: tea and downstairs, sit down, upstairs, work.
  const dots = lines.flat().filter(r => r.text === '●').map(r => r.color)
  expect(dots).toEqual([t.diffAdded, t.diffAdded, t.diffAdded, t.alertWarning, t.diffRemoved])
  expect(text.some(l => l.includes('Cat'))).toBe(true)
  // A dot sits under its task's name.
  const names = text.find(l => l.includes('Make tea')) ?? ''
  const tea = names.indexOf('Make tea')
  expect(at(5).indexOf('●')).toBeGreaterThanOrEqual(tea)
  expect(at(5).indexOf('●')).toBeLessThan(tea + 8)
})

test('journey: too many tasks for the width become rows with score bars', () => {
  const text = plain(linesOf(JOURNEY_RENDERERS.journey, JOURNEY, 40))
  expect(text).toContain('Go to work')
  expect(text.some(l => l.startsWith('  Make tea') && l.includes('█████ 5') && l.endsWith('Me'))).toBe(true)
  expect(text.some(l => l.includes('█░░░░ 1') && l.endsWith('Me, Cat'))).toBe(true)
})

test('journey: a task without a score does not parse', () => {
  expect(errorOf(JOURNEY_RENDERERS.journey, 'journey\n  title x\n  Task: high: Me')).toBeDefined()
  expect(errorOf(JOURNEY_RENDERERS.journey, 'journey\n  title only')).toBeDefined()
})

// ---------------------------------------------------------------- kanban

const KANBAN = `kanban
  Todo
    [Create Documentation]
    docs[Create Blog about the new diagram]
  [In progress]
    id6[Create renderer so that it works in all cases]
  id10[Ready for test]
    id4[Create parsing tests]@{ ticket: MC-2038, assigned: 'K.Sveidqvist', priority: 'High' }
    id66[last item]@{ priority: 'Very Low', assigned: "knsv" }`

test('kanban: columns side by side with counts, cards boxed with their metadata', () => {
  const lines = linesOf(KANBAN_RENDERERS.kanban, KANBAN, 100)
  const text = plain(lines)
  expect(text[0]).toMatch(/^Todo \(2\) ─+ {2}In progress \(1\) ─+ {2}Ready for test \(2\) ─+$/)
  expect(text[1]).toMatch(/^╭─+╮ {2}╭─+╮ {2}╭─+╮$/)
  expect(text.some(l => l.includes('│ Create parsing tests'))).toBe(true)
  expect(text.some(l => l.includes('MC-2038 · @K.Sveidqvist'))).toBe(true)
  expect(text.some(l => l.includes('▼▼ Very Low'))).toBe(true)
  const t = ctxOf(100).theme
  expect(runWith(lines, '▲ High')?.color).toBe(t.diffRemoved)
  expect(runWith(lines, 'Very Low')?.color).not.toBe(t.diffRemoved)
  // Each column's boxes in its own color.
  expect(runWith(lines, 'Todo')?.color).not.toBe(runWith(lines, 'In progress')?.color)
})

test('kanban: too narrow, the columns stack', () => {
  const text = plain(linesOf(KANBAN_RENDERERS.kanban, KANBAN, 30))
  expect(text[0]).toMatch(/^Todo \(2\) ─+$/)
  expect(text.some(l => /^In progress \(1\)/.test(l))).toBe(true)
  expect(text.some(l => /^Ready for test \(2\)/.test(l))).toBe(true)
  expect(text.filter(l => l.startsWith('╭')).length).toBe(5)
})

test('kanban: a card before any column is an error; mono keeps priority bold', () => {
  expect(errorOf(KANBAN_RENDERERS.kanban, 'kanban\n')).toBeDefined()
  const lines = linesOf(KANBAN_RENDERERS.kanban, KANBAN, 100, 'mono')
  expect(lines.flat().every(r => r.color === undefined)).toBe(true)
  expect(runWith(lines, '▲ High')?.bold).toBe(true)
})

// ---------------------------------------------------------------- gitGraph

const GIT = `gitGraph
   commit id: "init"
   commit id: "readme" tag: "v0.1"
   branch develop
   checkout develop
   commit id: "api"
   branch feature
   checkout feature
   commit id: "form" type: HIGHLIGHT
   checkout main
   commit id: "hotfix" type: REVERSE
   checkout develop
   merge feature id: "m1"
   checkout main
   merge develop tag: "v1.0"
   branch release
   switch release
   cherry-pick id: "api"`

test('gitGraph: lanes, forks, merges, glyphs, tags and cherry-picks', () => {
  const lines = linesOf(GITGRAPH_RENDERERS.gitGraph, GIT, 60)
  const text = plain(lines)
  expect(text).toEqual([
    '●        init (main)',
    '●        readme [v0.1]',
    '├─╮',
    '│ ●      api (develop)',
    '│ ├─╮',
    '│ │ ■    form (feature)',
    '✕ │ │    hotfix reverse',
    '│ ├─╯',
    '│ ◉      m1 merge feature',
    '├─╯',
    '◉        merge develop [v1.0]',
    '╰─────╮',
    '      ◎  cherry-pick: api (release)',
  ])
  const t = ctxOf(60).theme
  expect(runWith(lines, '(develop)')?.color).not.toBe(runWith(lines, '(main)')?.color)
  expect(runWith(lines, '[v1.0]')?.color).toBe(t.number)
  expect(text.join('')).not.toMatch(/[▶◀]/)
})

test('gitGraph: a lane that goes on after a merge keeps its line', () => {
  const text = plain(linesOf(GITGRAPH_RENDERERS.gitGraph, 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev\n  checkout dev\n  commit', 60))
  expect(text).toEqual(['●    c1 (main)', '├─╮', '│ ●  c2 (dev)', '├─┤', '◉ │  merge dev', '  ●  c4'])
})

test('gitGraph: bad commands are errors, long labels are cut to the width', () => {
  expect(errorOf(GITGRAPH_RENDERERS.gitGraph, 'gitGraph\n  checkout nope')).toBeDefined()
  expect(errorOf(GITGRAPH_RENDERERS.gitGraph, 'gitGraph\n  commit\n  merge main')).toBeDefined()
  expect(errorOf(GITGRAPH_RENDERERS.gitGraph, 'gitGraph\n  commit\n  frobnicate')).toBeDefined()
  const text = plain(linesOf(GITGRAPH_RENDERERS.gitGraph, 'gitGraph\n  commit id: "a-very-long-commit-identifier-here" msg: "and a message"', 20))
  expect(text[0]).toBe('●  a-very-long-comm…')
})
