import { expect, test } from 'claude-code/testing'

import { diffTexts, drawDiff } from '../hooks/diff'
import { formatDuration, formatTime } from '../hooks/chat'
import { styleOf } from '../hooks/options'
import { groupSummary, isReadOnlyCommand } from '../hooks/rows'
import { planOf } from '../hooks/shellwatch'

const text = (lines: { text: string }[][]) => lines.map(l => l.map(r => r.text).join(''))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const start = (on: (event: any, hook: (...args: any[]) => unknown) => void) => {
  on('command.register', () => ({ value: { command: 'lumen' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '+0800\n', stderr: '' } }))
}

test('a reply in the default bubble carries the ● Claude label', async ($, on) => {
  start(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'lumen', component: 'AssistantMessage', requestId: 'm1', props: { text: 'Hi **there**', isFirstOfReply: true }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('● Claude')
  expect(texts.some(t => t.startsWith('╭'))).toBe(true)
  await ui.unmount()
})

test('your prompt draws in a bubble under You ●; a task notification is left alone', async ($, on) => {
  start(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mine = await $.ui.mount({ plugin: 'lumen', component: 'UserMessage', requestId: 'u1', props: { text: 'fix the build', origin: { kind: 'composer' }, isExpanded: true }, surface: 'terminal' })
  const texts = (await mine.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('You ●')
  expect(texts.some(t => t.includes('fix the build'))).toBe(true)
  await mine.unmount()

  const note = await $.ui.mount({ plugin: 'lumen', component: 'UserMessage', requestId: 'u2', props: { text: 'done', origin: { kind: 'task-notification' }, isExpanded: true }, surface: 'terminal' })
  expect((await note.find({ type: 'Text' }))?.text).toBe('engine')
  await note.unmount()
})

test('a Bash call is one row: dot, Ran and the command', async ($, on) => {
  start(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'lumen', component: 'ToolUse', requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: { command: 'npm test' }, isRunning: false, isErrored: false, isInterrupted: false },
    surface: 'terminal',
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('● Ran npm test')
  await ui.unmount()
})

test('an Edit result draws as a diff card with counts', async ($, on) => {
  start(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'lumen', component: 'ToolResult', requestId: 't2',
    props: {
      tool_use_id: 't2', tool: 'Edit', isErrored: false,
      output: { filePath: '/repo/src/a.ts', structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-const a = 1', '+const a = 2'] }] },
    },
    surface: 'terminal',
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.includes('Edited src/a.ts +1 −1'))).toBe(true)
  expect(texts.some(t => t.includes('3 − const a = 1'))).toBe(true)
  expect(texts.some(t => t.includes('3 + const a = 2'))).toBe(true)
  await ui.unmount()
})

test('a line diff groups changes into hunks with context', () => {
  const hunks = diffTexts('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nc\nD\ne\nf\ng\nh\n')
  expect(hunks).toEqual([{ oldStart: 1, oldLines: 7, newStart: 1, newLines: 7, lines: [' a', ' b', ' c', '-d', '+D', ' e', ' f', ' g'] }])
})

test('the four diff styles', () => {
  const style = styleOf({})
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x = 1', '+x = 2'] }]
  const title = [{ text: 'f.ts' }]
  expect(text(drawDiff(style, title, hunks, 30, Infinity, 'card').lines)[0]).toStartWith('╭─ f.ts ')
  expect(text(drawDiff(style, title, hunks, 30, Infinity, 'marks').lines)).toEqual(['f.ts', '1 − x = 1', '1 + x = 2'])
  expect(text(drawDiff(style, title, hunks, 30, Infinity, 'bar').lines)[1]).toStartWith('▌1 − x = 1')
  // full tints the line across the width.
  expect(text(drawDiff(style, title, hunks, 30, Infinity, 'full').lines)[1]).toHaveLength(30)
})

test('group summaries, read-only commands and shell plans', () => {
  expect(groupSummary(['Bash', 'Bash', 'Read', 'Grep'])).toBe('Ran 2 commands, read 1 file, searched 1 time')
  expect(isReadOnlyCommand('git status && ls -la | grep x')).toBe(true)
  expect(isReadOnlyCommand('npm test')).toBe(false)
  expect(isReadOnlyCommand('cat a > b')).toBe(false)
  expect(planOf("rm a.txt && mv b c/ ; sed -i 's/x/y/' d.ts > /dev/null; echo hi >> log.txt")).toEqual({
    deletes: ['a.txt'], moves: [{ sources: ['b'], dest: 'c/' }], writes: ['log.txt', 'd.ts'],
  })
})

test('durations and times', () => {
  expect(formatDuration(380_000)).toBe('6m 20s')
  expect(formatDuration(42_000)).toBe('42s')
  const at = Date.UTC(2026, 10, 16, 6, 5)
  expect(formatTime(at, at, 480, '24h')).toBe('14:05')
  expect(formatTime(at, at, 480, '12h')).toBe('2:05 PM')
  expect(formatTime(at, at + 86_400_000 * 2, 480, '24h')).toBe('Nov 16 14:05')
})
