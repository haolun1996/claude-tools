import { expect, test } from 'claude-code/testing'

import { drawBlocks } from '../hooks/blocks'
import { parse } from '../hooks/markdown'
import { styleOf } from '../hooks/options'

const plain = (text: string, width: number, options: Record<string, string | boolean> = {}) =>
  drawBlocks(styleOf(options), parse(text), width).map(l => l.map(r => r.text).join(''))

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const REPLY = (text: string) => ({
  plugin: 'lumen',
  component: 'AssistantMessage',
  requestId: 'm1',
  props: { text, isFirstOfReply: true },
}) as const

test('a reply is redrawn on the terminal, with its bullet', { options: { replyStyle: 'off' } }, async ($, on) => {
  on('command.register', () => ({ value: { command: 'lumen' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...REPLY('Hello **world** and `code`'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: '●' }))?.text).toBe('●')
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Hello world and code')
  // Each styled part is its own run.
  expect(texts).toContain('world')
  expect(texts).toContain('code')
  await ui.unmount()
})

test('other surfaces keep the engine drawing by default', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...REPLY('Hello'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  await ui.unmount()
})

test('turned off, lumen leaves replies to the engine', { options: { enabled: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...REPLY('Hello'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  await ui.unmount()
})

test('/lumen theme saves the theme setting, and refuses an unknown one', async ($, on) => {
  const sets: unknown[] = []
  on('command.register', () => ({ value: { command: 'lumen' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('config.set', (_, e) => (sets.push({ key: e.key, value: e.value }), { value: e.value }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ok = await $.command.run({ ...RUN, command: 'lumen', args: 'theme nord' })
  expect(ok.text).toBe('Theme set to nord.')
  expect(sets).toEqual([{ key: 'lumen.theme', value: 'nord' }])

  const bad = await $.command.run({ ...RUN, command: 'lumen', args: 'theme nope' })
  expect(bad.text).toStartWith('No theme named "nope"')
})

test('headings, lists, tasks, quotes and alerts', () => {
  const out = plain('# Title\n\n## Sub\n\n- a\n  - b\n1. one\n\n- [x] done\n- [ ] todo\n\n> quoted\n\n> [!NOTE]\n> careful', 30)
  expect(out).toEqual([
    '╭───────╮', '│ Title │', '╰───────╯', '',
    'Sub', '━━━', '',
    '• a', '  ◦ b', '',
    '1. one', '',
    '[✓] done', '[ ] todo', '',
    '▎ quoted', '',
    '╭─ Note ─────────────────────╮', '│ careful                    │', '╰────────────────────────────╯',
  ])
})

test('the four code styles', () => {
  const src = '```bash\nls -la\n```'
  expect(plain(src, 30, { codeStyle: 'plain' })).toEqual(['  ls -la'])
  expect(plain(src, 30, { codeStyle: 'framed' })[0]).toBe(`╭${'─'.repeat(22)}╮`)
  expect(plain(src, 30, { codeStyle: 'filled' })).toEqual([' '.repeat(22), ` ls -la${' '.repeat(15)}`, ' '.repeat(22)])
  expect(plain(src, 30, { codeStyle: 'card' })).toHaveLength(5)
  // mono has no fill: filled draws the frame instead.
  expect(plain(src, 30, { codeStyle: 'filled', theme: 'mono' })[0]).toStartWith('╭')
})

test('a table keeps short columns whole and wraps the long one', () => {
  const out = plain('| Name | Time |\n|---|---:|\n| a long name here | 120 ms |', 24)
  expect(out).toEqual([
    '┌─────────────┬────────┐',
    '│ Name        │   Time │',
    '╞═════════════╪════════╡',
    '│ a long name │ 120 ms │',
    '│ here        │        │',
    '└─────────────┴────────┘',
  ])
})

test('stacked tables draw each row as a card', () => {
  const out = plain('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 30, { tableLayout: 'stacked' })
  expect(out).toEqual(['A  1', 'B  2', '─'.repeat(30), 'A  3', 'B  4'])
})

test('a code fence still streaming stays code', () => {
  expect(plain('```js\nconst a = 1', 30)).toEqual(['  const a = 1'])
})

test('emoji count two columns, so every table row ends at the same border', () => {
  const src = '| Feature | Status |\n|---|---|\n| Themes | ✅ Built (Phase 1) |\n| Bubbles | ⏳ Phase 2 |\n| Check | ✔️ ok |\n| Family | 👨‍👩‍👧 x |'
  const out = drawBlocks(styleOf({}), parse(src), 60)
  const ends = new Set(out.map(l => l.map(r => r.text).join('')).map(s => {
    // Display width of the drawn line, emoji as two.
    let n = 0
    const chars = [...s]
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i] as string
      if (chars[i - 1] === '‍') continue
      if (ch === '‍' || ch === '️') continue
      n += /\p{Emoji_Presentation}/u.test(ch) || chars[i + 1] === '️' ? 2 : 1
    }
    return n
  }))
  expect([...ends]).toHaveLength(1)
})
