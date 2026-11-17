import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, PluginOptions, Register, RenderElement } from 'claude-code'

import { drawBlocks } from './blocks'
import { bubble, formatDuration, formatTime, parseOffset, solid, widest } from './chat'
import { countLines, drawDiff, drawNewFile } from './diff'
import { hintText } from './hints'
import { renderFormula, startLatex } from './latex'
import type { Latex } from './latex'
import { displayMath, footnotes } from './prepare'
import { SETUP_PANE, drawSetup } from './setup'
import type { DiffDraw, Hunk } from './diff'
import type { Line, Run } from './inline'
import { parse } from './markdown'
import type { Block } from './markdown'
import { CODE_STYLES, HEADING_STYLES, LIST_MARKERS, TABLE_LAYOUTS, TABLE_STYLES, TASK_STYLES, styleOf } from './options'
import type { Style, Surface } from './options'
import { describe, dot, groupSummary, isReadOnlyCommand, rowLine, shortPath } from './rows'
import type { Status } from './rows'
import { watch } from './shellwatch'
import type { ShellChange } from './shellwatch'
import { THEME_NAMES } from './theme'
import { linesElement } from './view'
import { lineWidth, wrap } from './wrap'

const DEFAULT_COLUMNS = 80
const MIN_COLUMNS = 20
const CACHE_SIZE = 300
const DIFF_ROWS = 30
const NEW_FILE_ROWS = 10
const PROMPT_ORIGINS = new Set(['composer', 'bridge'])
const MARKDOWN_SIGNS = /(^|\n)\s*(#{1,6}\s|\||```|[-*+]\s|\d+[.)]\s|>\s)|\*\*|`[^`]+`/

const themeOverride = atom({ plugin: 'lumen', key: 'themeOverride' } as const, '', { shape: 'theme-1' })
const promptTimes = atom({ plugin: 'lumen', key: 'promptTimes' } as const, {}, { shape: 'times-1' })
const openFolds = atom({ plugin: 'lumen', key: 'openFolds' } as const, [], { shape: 'folds-1' })

/** What the module keeps between hooks: rebuilt on each load. */
type Ctx = {
  options: PluginOptions
  base: Style
  overridden?: { name: string; style: Style }
  cwd: string
  offsetMinutes: number
  loadedAt: number
  footerSeen: Map<string, number>
  commands: Map<string, string>
  readOnly: Set<string>
  shellChanges: Map<string, ShellChange[]>
  parsed: Map<string, Block[]>
  latex?: Latex
}

const HELP = (style: Style) => `lumen: themed replies

  /lumen theme            list the themes
  /lumen theme <name>     switch theme (saved as the "theme" setting)
  /lumen setup            pick the theme and styles from a pane
  /lumen help             this help

Theme now: ${style.themeName}
Themes: ${THEME_NAMES.join(', ')}

Styles, set in /config (lumen rows) or ~/.claude/settings.json:
  codeStyle     ${CODE_STYLES.join(', ')}   (now ${style.codeStyle})
  tableStyle    ${TABLE_STYLES.join(', ')}   (now ${style.tableStyle})
  tableLayout   ${TABLE_LAYOUTS.join(', ')}   (now ${style.tableLayout})
  headingStyle  ${HEADING_STYLES.join(', ')}   (now ${style.headingStyle})
  listMarker    ${LIST_MARKERS.join(', ')}   (now ${style.listMarker})
  taskStyle     ${TASK_STYLES.join(', ')}   (now ${style.taskStyle})
  promptStyle   now ${style.promptStyle} · replyStyle now ${style.replyStyle} · clock now ${style.clock}
  toolStyle     now ${style.toolStyle} · toolOutput now ${style.toolOutput} · diffStyle now ${style.diffStyle}
  <token>Color  any hex, rgb(), ansi256() or color name`

const colorRun = (text: string, color: string | undefined, extra: Omit<Run, 'text' | 'color'> = {}): Run =>
  color === undefined ? { text, ...extra } : { text, color, ...extra }

const columnsOf = (viewport: { columns?: number } | undefined) => Math.max(MIN_COLUMNS, viewport?.columns ?? DEFAULT_COLUMNS)

const parseCached = (ctx: Ctx, text: string): Block[] => {
  const hit = ctx.parsed.get(text)
  if (hit !== undefined) return hit
  const math = displayMath(text)
  const noted = ctx.base.footnotes ? footnotes(math) : { text: math, notes: [] }
  const blocks = parse(noted.text)
  if (noted.notes.length > 0) {
    blocks.push({ kind: 'rule' }, ...noted.notes.map(n => ({ kind: 'paragraph' as const, text: `${n.mark} ${n.text}` })))
  }
  ctx.parsed.set(text, blocks)
  if (ctx.parsed.size > CACHE_SIZE) ctx.parsed.delete(ctx.parsed.keys().next().value as string)
  return blocks
}

const styleFor = (ctx: Ctx, override: string): Style => {
  if (override === '') return ctx.base
  if (ctx.overridden?.name !== override) ctx.overridden = { name: override, style: styleOf(ctx.options, override) }
  return ctx.overridden.style
}

/** The style in force, or undefined where lumen does not draw this surface. */
const active = async ($: EngineInterface, ctx: Ctx, surface: string): Promise<Style | undefined> => {
  const style = styleFor(ctx, await read($, themeOverride))
  return style.enabled && style.surfaces.has(surface as Surface) ? style : undefined
}

const toggleFold = ($: EngineInterface, id: string) => () =>
  update($, openFolds, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-200)))

/** A fold's lines and, when rows are hidden, a button that opens or closes the rest. */
const folded = async ($: EngineInterface, el: ElementTable, id: string, draw: (limit: number) => DiffDraw, limit: number): Promise<RenderElement> => {
  const { Box, Button } = el
  const isOpen = (await read($, openFolds)).includes(id)
  const short = draw(limit)
  const shown = isOpen ? draw(Infinity) : short
  const canFold = short.hidden > 0
  return (
    <Box flexDirection="column">
      {linesElement(el, shown.lines)}
      {canFold ? (
        <Button key={`fold-${id}`} onPress={toggleFold($, id)}>
          {isOpen ? 'show less' : `+${short.hidden} more lines`}
        </Button>
      ) : null}
    </Box>
  )
}

const pathTitle = (ctx: Ctx, style: Style, verb: string, path: string, extra: Run[] = []): Run[] => [
  { text: `${verb} `, bold: true },
  colorRun(shortPath(ctx.cwd, path), style.theme.path),
  ...extra,
]

const counts = (style: Style, hunks: readonly Hunk[]): Run[] => {
  const added = hunks.reduce((n, h) => n + h.lines.filter(l => l.startsWith('+')).length, 0)
  const removed = hunks.reduce((n, h) => n + h.lines.filter(l => l.startsWith('-')).length, 0)
  return [{ text: ' ' }, colorRun(`+${added}`, style.theme.diffAdded), { text: ' ' }, colorRun(`−${removed}`, style.theme.diffRemoved)]
}

const changeCard = async ($: EngineInterface, ctx: Ctx, el: ElementTable, style: Style, id: string, change: ShellChange, width: number): Promise<RenderElement> => {
  const t = style.theme
  switch (change.kind) {
    case 'renamed':
      return linesElement(el, [[{ text: 'Renamed ', bold: true }, colorRun(shortPath(ctx.cwd, change.from), t.path), { text: ' → ' }, colorRun(shortPath(ctx.cwd, change.to), t.path)]])
    case 'deleted': {
      const n = countLines(change.content)
      const hunk: Hunk = { oldStart: 1, oldLines: n, newStart: 0, newLines: 0, lines: change.content.replace(/\n$/, '').split('\n').map(l => `-${l}`) }
      const title = pathTitle(ctx, style, 'Deleted', change.path, [{ text: ` (${n} line${n === 1 ? '' : 's'})`, dim: true }])
      return folded($, el, id, limit => (limit === 0 ? { lines: [title], hidden: n } : drawDiff(style, title, [hunk], width, limit)), 0)
    }
    case 'created': {
      const n = countLines(change.content)
      const hunk: Hunk = { oldStart: 0, oldLines: 0, newStart: 1, newLines: n, lines: change.content.replace(/\n$/, '').split('\n').map(l => `+${l}`) }
      return folded($, el, id, limit => drawDiff(style, pathTitle(ctx, style, 'Created', change.path, [{ text: ` (${n} lines)`, dim: true }]), [hunk], width, limit), NEW_FILE_ROWS)
    }
    case 'modified':
      return folded($, el, id, limit => drawDiff(style, pathTitle(ctx, style, 'Edited', change.path, counts(style, change.hunks)), change.hunks, width, limit), DIFF_ROWS)
  }
}

const mathOf = (blocks: readonly Block[]): string[] =>
  blocks.flatMap(b =>
    b.kind === 'code' && !b.isOpen && (b.lang === 'math' || b.lang === 'latex' || b.lang === 'tex')
      ? [b.text.trim()]
      : b.kind === 'list'
        ? b.items.flatMap(i => mathOf(i.blocks))
        : b.kind === 'quote' || b.kind === 'alert'
          ? mathOf(b.blocks)
          : [],
  )

/** The style with this text's display formulas typeset, where LaTeX is on. */
async function withFormulas($: EngineInterface, ctx: Ctx, style: Style, text: string, columns: number): Promise<Style> {
  const latex = ctx.latex
  if (latex === undefined || !latex.isOn || !style.latex) return style
  const wanted = mathOf(parseCached(ctx, text))
  if (wanted.length === 0) return style
  const formulas = new Map<string, { png: string; columns: number; rows: number }>()
  for (const tex of wanted) {
    const f = await renderFormula($, latex, tex, columns)
    if (f !== null) formulas.set(tex, f)
  }
  return formulas.size > 0 ? { ...style, formulas } : style
}

/** A reply block in the style's frame; undefined when it holds nothing to draw. */
const drawReply = (ctx: Ctx, el: ElementTable, style: Style, text: string, isFirst: boolean, columns: number): RenderElement | undefined => {
  const blocks = parseCached(ctx, text)
  if (blocks.length === 0) return undefined
  const t = style.theme
  const { Box, Text } = el
  const narration = style.toolStyle === 'tree-bold' && blocks.length === 1 && blocks[0]?.kind === 'paragraph'

  if (style.replyStyle === 'off') {
    let lines = drawBlocks(style, blocks, columns - 4)
    if (narration) lines = lines.map(l => l.map(r => ({ ...r, bold: true })))
    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text {...(t.accent !== undefined ? { color: t.accent } : {})}>{isFirst ? '●' : ' '}</Text>
        </Box>
        {linesElement(el, lines)}
      </Box>
    )
  }

  const inner = columns - 6
  const lines = drawBlocks(style, blocks, inner)
  const hug = Math.min(inner, widest(lines, 10))
  const label: Line[] = isFirst && style.bubbleLabels !== 'off'
    ? [[colorRun(style.bubbleLabels === 'large' ? '⬤  Claude' : '● Claude', t.replyBorder ?? 'claude', { bold: true })]]
    : []
  const look = style.replyStyle === 'solid' && t.replyFill === undefined ? 'framed' : style.replyStyle
  const framed =
    look === 'solid'
      ? solid(lines, hug, t.replyFill as string)
      : bubble(lines, hug, t.replyBorder ?? 'claude', look === 'bubble' ? t.replyFill : undefined)
  return linesElement(el, [...label, ...framed])
}

/** One tool row placed as the tool style says. */
const rowElement = (el: ElementTable, style: Style, line: Line, columns: number): RenderElement => {
  const { Box } = el
  if (style.toolStyle === 'chat') {
    const cap = Math.max(20, Math.floor(columns * 0.6))
    const shown = lineWidth(line) > cap ? wrap(line, cap) : [line]
    return (
      <Box flexDirection="column" alignItems="flex-end" width={columns}>
        {linesElement(el, shown.map(l => l.map(r => ({ ...r, dim: true }))))}
      </Box>
    )
  }
  if (style.toolStyle === 'classic') return linesElement(el, [line])
  return linesElement(el, [[{ text: '  ⎿ ', dim: true }, ...line.map(r => ({ ...r, dim: true }))]])
}

const drawPrompt = async ($: EngineInterface, ctx: Ctx, el: ElementTable, style: Style, text: string, columns: number): Promise<RenderElement> => {
  const t = style.theme
  const { Box } = el
  const sentAt = style.clock === 'off' ? undefined : (await read($, promptTimes))[text]
  const time = sentAt !== undefined && style.clock !== 'off' ? formatTime(sentAt, Date.now(), ctx.offsetMinutes, style.clock) : undefined
  const runs: Run[] = [colorRun(text, t.promptText ?? t.heading)]

  if (style.promptStyle === 'bar' || style.promptStyle === 'chevron') {
    const isBar = style.promptStyle === 'bar'
    const lead = (n: number): Run => (isBar ? colorRun('▌ ', t.promptBorder) : colorRun(n === 0 ? '❯ ' : '  ', t.accent, { bold: true }))
    const drawn: Line[] = wrap(runs, columns - 2).map((l, n) => [lead(n), ...l])
    if (time !== undefined) drawn[0] = [...(drawn[0] ?? []), { text: `  ${time}`, dim: true }]
    return linesElement(el, drawn)
  }

  if (style.promptStyle === 'wide') {
    const inner = columns - 4
    const lines = bubble(wrap(runs, inner), inner, t.promptBorder, undefined)
    return linesElement(el, time !== undefined ? [[{ text: time, dim: true }], ...lines] : lines)
  }

  // bubble / framed: on the right, as wide as the longest line, at most three quarters.
  const maxInner = Math.max(10, Math.floor(columns * 0.75) - 4)
  const wrapped = wrap(runs, maxInner)
  const inner = Math.min(maxInner, widest(wrapped))
  const fill = style.promptStyle === 'bubble' ? t.promptFill : undefined
  const lines = bubble(wrapped, inner, t.promptBorder, fill)
  const label: Run[] = style.bubbleLabels === 'off' ? [] : [colorRun(style.bubbleLabels === 'large' ? 'You ⬤ ' : 'You ●', t.promptBorder, { bold: true })]
  const head: Line = [...(time !== undefined ? [{ text: `${time}  `, dim: true }] : []), ...label]
  return (
    <Box flexDirection="column" alignItems="flex-end" width={columns}>
      {linesElement(el, head.length > 0 ? [head, ...lines] : lines)}
    </Box>
  )
}

const drawToolResult = async ($: EngineInterface, ctx: Ctx, el: ElementTable, style: Style, tool: string, id: string, output: Record<string, unknown> | undefined, width: number): Promise<RenderElement | 'engine' | 'hide' | { above: true; cards: RenderElement[] }> => {
  if ((tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') && output !== undefined) {
    const path = typeof output.filePath === 'string' ? output.filePath : ''
    if (tool === 'Write' && output.type === 'create' && typeof output.content === 'string') {
      const content = output.content
      const n = countLines(content)
      return folded($, el, id, limit => drawNewFile(style, pathTitle(ctx, style, 'Created', path, [{ text: ` (${n} lines)`, dim: true }]), content, width, limit), NEW_FILE_ROWS)
    }
    const hunks = Array.isArray(output.structuredPatch) ? (output.structuredPatch as Hunk[]) : []
    if (hunks.length === 0) return 'engine'
    return folded($, el, id, limit => drawDiff(style, pathTitle(ctx, style, tool === 'Write' ? 'Wrote' : 'Edited', path, counts(style, hunks)), hunks, width, limit), DIFF_ROWS)
  }

  const quietTool = tool === 'Bash' ? isReadOnlyCommand(ctx.commands.get(id) ?? 'x') : ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'].includes(tool)
  const hideOutput = style.toolOutput === 'rows' || (style.toolOutput === 'quiet' && (ctx.readOnly.has(id) || quietTool))
  const changes = ctx.shellChanges.get(id) ?? []
  if (changes.length === 0) return hideOutput ? 'hide' : 'engine'
  const cards = await Promise.all(changes.map((c, n) => changeCard($, ctx, el, style, `${id}-${n}`, c, width)))
  return hideOutput ? cards[0] !== undefined && cards.length === 1 ? cards[0] : <el.Box flexDirection="column">{cards}</el.Box> : { above: true, cards }
}

export const register: Register = (on, options) => {
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), lumen: { markdown: async () => undefined } }))

  const ctx: Ctx = {
    options,
    base: styleOf(options),
    cwd: '',
    offsetMinutes: 0,
    loadedAt: Date.now(),
    footerSeen: new Map(),
    commands: new Map(),
    readOnly: new Set(),
    shellChanges: new Map(),
    parsed: new Map(),
  }

  on('session.start', async ($, e, next) => {
    ctx.cwd = await $.session.cwd().catch(() => '')
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    const overSsh = (await $.env.get('SSH_CONNECTION').catch(() => undefined)) !== undefined || (await $.env.get('SSH_TTY').catch(() => undefined)) !== undefined
    if (!overSsh && ctx.cwd !== '') ctx.base = { ...ctx.base, links: { cwd: ctx.cwd, home } }
    if (ctx.base.latex) ctx.latex = await startLatex($, ctx.base.theme.diagramText ?? ctx.base.theme.codeText ?? '#808080').catch(() => undefined)
    const tz = await $.process.run(['date', '+%z'], { timeoutMs: 2000 }).catch(() => undefined)
    if (tz !== undefined && tz.exitCode === 0) ctx.offsetMinutes = parseOffset(tz.stdout)
    await $.command.register({ name: 'lumen', description: 'lumen themes and styles: /lumen theme <name>, /lumen help' })
    return next(e)
  })

  on('command.run', { command: 'lumen' }, async ($, e) => {
    const [verb = '', name] = e.args.trim().split(/\s+/)
    const style = styleFor(ctx, await read($, themeOverride))
    if (verb === 'setup') {
      await $.ui.open({ id: SETUP_PANE, title: 'lumen setup', focus: true })
      return { text: 'lumen setup opened: press a choice to save it.' }
    }
    if (verb !== 'theme') return { text: HELP(style) }
    if (name === undefined) {
      return { text: `Theme now: ${style.themeName}\n\n${THEME_NAMES.map(n => `  ${n}`).join('\n')}\n\nSwitch with /lumen theme <name>.` }
    }
    if (!THEME_NAMES.includes(name)) {
      return { text: `No theme named "${name}". Themes: ${THEME_NAMES.join(', ')}` }
    }
    const saved = await $.config.set({ key: 'lumen.theme', value: name }).catch((err: unknown) => ({ deny: String(err) }))
    if ('deny' in saved && saved.deny) {
      await update($, themeOverride, () => name)
      return { text: `Theme set to ${name} for this session (the setting could not be saved: ${saved.deny}).` }
    }
    await update($, themeOverride, () => '')
    return { text: `Theme set to ${name}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    const key = e.text.trim()
    if (key !== '') {
      const sent = Date.now()
      await update($, promptTimes, times => Object.fromEntries(Object.entries({ ...times, [key]: sent }).sort((a, b) => b[1] - a[1]).slice(0, 200))).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined || style.promptStyle === 'off' || !e.props.isExpanded) return next(e)
    if (!PROMPT_ORIGINS.has(e.props.origin.kind) || e.props.from !== undefined) return next(e)
    const text = e.props.text.trim()
    if (text === '') return next(e)
    return drawPrompt($, ctx, $.ui.resolve(e), style, text, columnsOf(e.viewport) - 2)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined) return next(e)
    const columns = columnsOf(e.viewport)
    const drawing = e.surface === 'terminal' ? await withFormulas($, ctx, style, e.props.text, columns - 8) : style
    return drawReply(ctx, $.ui.resolve(e), drawing, e.props.text, e.props.isFirstOfReply, columns) ?? next(e)
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined || !style.commandOutput || e.props.isErrored || !MARKDOWN_SIGNS.test(e.props.text)) return next(e)
    return linesElement($.ui.resolve(e), drawBlocks(style, parseCached(ctx, e.props.text), columnsOf(e.viewport) - 4))
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined || e.surface !== 'terminal') return next(e)
    const t = style.theme
    if (!ctx.footerSeen.has(e.requestId)) ctx.footerSeen.set(e.requestId, Date.now())
    const seen = ctx.footerSeen.get(e.requestId) ?? Date.now()
    // A footer first drawn right after a reload is an old one: its time is unknown.
    const time = style.clock !== 'off' && seen - ctx.loadedAt > 3000 ? ` · ${formatTime(seen, Date.now(), ctx.offsetMinutes, style.clock)}` : ''
    return linesElement($.ui.resolve(e), [[
      colorRun('✻ ', t.accent),
      { text: `${e.props.word} for `, dim: true },
      colorRun(formatDuration(e.props.durationMs), t.number),
      ...(time !== '' ? [{ text: time, dim: true }] : []),
    ]])
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash') {
      const ran = await next(e)
      if (ran.isReadOnly) ctx.readOnly.add(e.tool_use_id)
      return ran
    }
    ctx.commands.set(e.tool_use_id, e.command)
    if (ctx.commands.size > 500) ctx.commands.delete(ctx.commands.keys().next().value as string)
    const watching = await watch($, ctx.cwd, e.command).catch(() => undefined)
    const ran = await next(e)
    if (ran.isReadOnly) ctx.readOnly.add(e.tool_use_id)
    if (watching !== undefined) {
      const changes = await watching.finish().catch(() => [])
      if (changes.length > 0) ctx.shellChanges.set(e.tool_use_id, changes)
      if (ctx.shellChanges.size > 200) ctx.shellChanges.delete(ctx.shellChanges.keys().next().value as string)
    }
    return ran
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined || !style.toolRows || e.props.isExpanded) return next(e)
    if (e.props.tool === 'Bash') {
      const command = (e.props.input as { command?: unknown } | null)?.command
      if (typeof command === 'string') ctx.commands.set(e.props.tool_use_id, command)
    }
    const status: Status = e.props.isInterrupted ? 'interrupted' : e.props.isErrored ? 'failed' : e.props.isRunning ? 'running' : 'done'
    const { verb, target } = describe(style, ctx.cwd, e.props.tool, e.props.input)
    return rowElement($.ui.resolve(e), style, rowLine(style, status, verb, target), columnsOf(e.viewport) - 2)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined || !style.toolRows || e.props.isExpanded) return next(e)
    const calls = e.props.calls
    if (calls.length === 0) return next(e)
    const failed = calls.filter(c => c.isErrored).length
    const status: Status = calls.some(c => c.isRunning) ? 'running' : failed > 0 ? 'failed' : 'done'
    const last = calls[calls.length - 1]
    const lastText = last === undefined ? '' : describe(style, ctx.cwd, last.tool, last.input).target.map(r => r.text).join('')
    const line: Line = [
      dot(style, status),
      { text: ` ${groupSummary(calls.map(c => c.tool))}` },
      ...(lastText !== '' ? [{ text: ` · last: ${lastText.length > 60 ? `${lastText.slice(0, 59)}…` : lastText}`, dim: true }] : []),
      ...(failed > 0 ? [colorRun(` · ${failed} failed`, style.theme.codeFlag)] : []),
    ]
    return rowElement($.ui.resolve(e), style, line, columnsOf(e.viewport) - 2)
  })

  on('ui.render', { component: 'Pane', requestId: SETUP_PANE }, async ($, e) => {
    const style = styleFor(ctx, await read($, themeOverride))
    const replyChoice = typeof ctx.options.replyStyle === 'string' ? ctx.options.replyStyle : 'auto'
    return drawSetup($, $.ui.resolve(e), style, e.props.bodyColumns, replyChoice)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!ctx.base.enabled || !ctx.base.diagramHints || !ctx.base.mermaid) return composed
    const latexOn = ctx.latex?.isOn === true && ctx.base.latex
    return { ...composed, sections: [...composed.sections, { id: 'lumen:hints', text: hintText(latexOn), scope: 'session' as const }] }
  })

  on('lumen.markdown', async ($, e, next) => {
    const style = styleFor(ctx, await read($, themeOverride))
    if (!style.enabled) return next(e)
    const blocks = parseCached(ctx, e.text)
    if (blocks.length === 0) return next(e)
    const el = $.ui.resolve({ surface: e.surface, component: 'AssistantMessage' })
    return { value: linesElement(el, drawBlocks(style, blocks, Math.max(MIN_COLUMNS, e.columns))) }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const style = await active($, ctx, e.surface)
    if (style === undefined || !style.toolRows || e.props.isExpanded || e.props.isErrored) return next(e)
    const el = $.ui.resolve(e)
    const drawn = await drawToolResult($, ctx, el, style, e.props.tool, e.props.tool_use_id, e.props.output as Record<string, unknown> | undefined, columnsOf(e.viewport) - 6)
    if (drawn === 'engine') return next(e)
    if (drawn === 'hide') return <el.Box />
    if (typeof drawn === 'object' && drawn !== null && 'above' in drawn) {
      return (
        <el.Box flexDirection="column">
          {await next(e)}
          {drawn.cards}
        </el.Box>
      )
    }
    return drawn
  })
}
