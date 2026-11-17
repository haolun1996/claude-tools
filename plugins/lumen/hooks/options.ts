import { TOKENS, parseColor, resolveTheme } from './theme'
import type { Fills, Theme } from './theme'
import type { LinkBase } from './links'
import type { SpecialOptions } from './tables/types'

export const CODE_STYLES = ['plain', 'framed', 'filled', 'card'] as const
export const TABLE_STYLES = ['box', 'rules', 'grid', 'minimal'] as const
export const TABLE_LAYOUTS = ['classic', 'auto', 'compact', 'stacked'] as const
export const HEADING_STYLES = ['banner', 'bold', 'underline', 'uppercase'] as const
export const LIST_MARKERS = ['dots', 'dash'] as const
export const TASK_STYLES = ['checks', 'ticks', 'box', 'progress'] as const
export const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
export const PROMPT_STYLES = ['bubble', 'framed', 'wide', 'bar', 'chevron', 'off'] as const
export const REPLY_STYLES = ['auto', 'bubble', 'solid', 'framed', 'off'] as const
export const BUBBLE_LABELS = ['large', 'small', 'off'] as const
export const CLOCKS = ['off', '24h', '12h'] as const
export const TOOL_STYLES = ['chat', 'tree-dim', 'tree-bold', 'classic'] as const
export const TOOL_OUTPUTS = ['full', 'quiet', 'rows'] as const
export const DIFF_STYLES = ['card', 'full', 'marks', 'bar'] as const
export const PIE_STYLES = ['round', 'bars'] as const

export const SPECIAL_CHOICES = {
  statusMatrix: ['off', 'color', 'summary', 'group'],
  testMatrix: ['off', 'report'],
  benchTable: ['off', 'color', 'trend'],
  schemaTable: ['off', 'types', 'keys', 'full'],
  compareTable: ['off', 'rank', 'pick', 'full'],
  apiTable: ['off', 'verbs', 'auth', 'full'],
  kvTable: ['off', 'sources', 'overrides', 'full'],
} as const satisfies { [K in keyof SpecialOptions]: readonly SpecialOptions[K][] }

export type CodeStyle = (typeof CODE_STYLES)[number]
export type TableStyle = (typeof TABLE_STYLES)[number]
export type TableLayout = (typeof TABLE_LAYOUTS)[number]
export type HeadingStyle = (typeof HEADING_STYLES)[number]
export type ListMarker = (typeof LIST_MARKERS)[number]
export type TaskStyle = (typeof TASK_STYLES)[number]
export type Surface = (typeof SURFACES)[number]
export type PromptStyle = (typeof PROMPT_STYLES)[number]
export type ReplyStyle = Exclude<(typeof REPLY_STYLES)[number], 'auto'>
export type BubbleLabels = (typeof BUBBLE_LABELS)[number]
export type Clock = (typeof CLOCKS)[number]
export type ToolStyle = (typeof TOOL_STYLES)[number]
export type ToolOutput = (typeof TOOL_OUTPUTS)[number]
export type DiffStyle = (typeof DIFF_STYLES)[number]

export type Style = {
  enabled: boolean
  surfaces: ReadonlySet<Surface>
  themeName: string
  theme: Theme
  isMono: boolean
  /** The theme's background, for fills drawn against it; absent in mono. */
  bg?: string
  fills: Fills
  codeStyle: CodeStyle
  tableStyle: TableStyle
  tableLayout: TableLayout
  headingStyle: HeadingStyle
  listMarker: ListMarker
  taskStyle: TaskStyle
  highlightNumbers: boolean
  highlightPaths: boolean
  // Phase 2: the chat
  promptStyle: PromptStyle
  replyStyle: ReplyStyle
  bubbleLabels: BubbleLabels
  clock: Clock
  toolRows: boolean
  toolStyle: ToolStyle
  toolOutput: ToolOutput
  diffStyle: DiffStyle
  commandOutput: boolean
  // Phase 3: diagrams
  mermaid: boolean
  mermaidAscii: boolean
  pieStyle: (typeof PIE_STYLES)[number]
  // Phase 4: extras
  special: SpecialOptions
  latex: boolean
  footnotes: boolean
  clickablePaths: boolean
  diagramHints: boolean
  /** Where paths resolve from, once the session says; absent keeps paths as text (and over SSH). */
  links?: LinkBase
  /** Typeset display formulas by their TeX, for this drawing. */
  formulas?: ReadonlyMap<string, { png: string; columns: number; rows: number }>
}

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

const surfacesOf = (value: unknown): ReadonlySet<Surface> => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || text === 'all') return new Set(SURFACES)
  const named = text
    .split(',')
    .map(s => s.trim())
    .filter((s): s is Surface => (SURFACES as readonly string[]).includes(s))
  return new Set(named.length > 0 ? named : ['terminal'])
}

/** The style the options describe, a theme name overriding the option's when given. */
export const styleOf = (options: Readonly<Record<string, unknown>>, themeOverride?: string): Style => {
  const requested = themeOverride ?? (typeof options.theme === 'string' ? options.theme : 'catppuccin-mocha')
  const resolved = resolveTheme(requested)
  const theme: Theme = { ...resolved.theme }
  for (const token of TOKENS) {
    const color = parseColor(options[`${token}Color`])
    if (color !== undefined) theme[token] = color
  }
  const promptStyle = oneOf(PROMPT_STYLES, options.promptStyle, 'bubble')
  const replyChoice = oneOf(REPLY_STYLES, options.replyStyle, 'auto')
  const special = Object.fromEntries(
    (Object.keys(SPECIAL_CHOICES) as (keyof SpecialOptions)[]).map(k => [k, oneOf(SPECIAL_CHOICES[k] as readonly string[], options[k], 'off')]),
  ) as SpecialOptions

  return {
    enabled: flag(options.enabled, true),
    surfaces: surfacesOf(options.surfaces ?? 'terminal'),
    themeName: requested === 'random' ? `random (${resolved.name})` : resolved.name,
    theme,
    isMono: resolved.isMono,
    ...(resolved.bg !== undefined ? { bg: resolved.bg } : {}),
    fills: resolved.fills,
    codeStyle: oneOf(CODE_STYLES, options.codeStyle, 'plain'),
    tableStyle: oneOf(TABLE_STYLES, options.tableStyle, 'box'),
    tableLayout: oneOf(TABLE_LAYOUTS, options.tableLayout, 'classic'),
    headingStyle: oneOf(HEADING_STYLES, options.headingStyle, 'banner'),
    listMarker: oneOf(LIST_MARKERS, options.listMarker, 'dots'),
    taskStyle: oneOf(TASK_STYLES, options.taskStyle, 'checks'),
    highlightNumbers: flag(options.highlightNumbers, true),
    highlightPaths: flag(options.highlightPaths, true),
    promptStyle,
    replyStyle: replyChoice === 'auto' ? (promptStyle === 'bubble' ? 'bubble' : 'off') : replyChoice,
    bubbleLabels: oneOf(BUBBLE_LABELS, options.bubbleLabels, 'small'),
    clock: oneOf(CLOCKS, options.clock, 'off'),
    toolRows: flag(options.toolRows, true),
    toolStyle: oneOf(TOOL_STYLES, options.toolStyle, 'chat'),
    toolOutput: oneOf(TOOL_OUTPUTS, options.toolOutput, 'full'),
    diffStyle: oneOf(DIFF_STYLES, options.diffStyle, 'card'),
    commandOutput: flag(options.commandOutput, true),
    mermaid: flag(options.mermaid, true),
    mermaidAscii: flag(options.mermaidAscii, false),
    pieStyle: oneOf(PIE_STYLES, options.pieStyle, 'round'),
    special,
    latex: flag(options.latex, false),
    footnotes: flag(options.footnotes, true),
    clickablePaths: flag(options.clickablePaths, true),
    diagramHints: flag(options.diagramHints, true),
  }
}
