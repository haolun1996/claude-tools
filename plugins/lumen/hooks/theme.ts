// Color themes: each palette is a small set of named colors, and every slot
// lumen draws with (a token) is derived from it. Palettes follow the published
// color specs of each theme (credited in the README); `neon` is lumen's own.

export const TOKENS = [
  'accent', 'heading', 'strong', 'emphasis', 'inlineCode',
  'codeText', 'codeCommand', 'codeFlag', 'codeString', 'codeComment', 'codeFill', 'codeBorder',
  'link', 'path', 'number', 'quote', 'rule',
  'tableHeader', 'tableRule', 'tableText', 'bullet',
  'diagram', 'diagramText', 'diffAdded', 'diffRemoved',
  'promptFill', 'promptBorder', 'promptText', 'replyFill', 'replyBorder',
  'alertNote', 'alertTip', 'alertImportant', 'alertWarning', 'alertCaution',
] as const

export type Token = (typeof TOKENS)[number]
export type Theme = Partial<Record<Token, string>>

type Palette = {
  dark: boolean
  bg: string // the theme's background
  raised: string // a step off the background: fills
  fg: string
  muted: string // comments, rules
  red: string
  orange: string
  yellow: string
  green: string
  cyan: string
  blue: string
  purple: string
  pink: string
  /** The theme's signature color; defaults to purple. */
  accent?: string
}

const PALETTES = {
  'catppuccin-mocha': {
    dark: true, bg: '#1e1e2e', raised: '#313244', fg: '#cdd6f4', muted: '#6c7086',
    red: '#f38ba8', orange: '#fab387', yellow: '#f9e2af', green: '#a6e3a1',
    cyan: '#94e2d5', blue: '#89b4fa', purple: '#cba6f7', pink: '#f5c2e7',
  },
  dracula: {
    dark: true, bg: '#282a36', raised: '#44475a', fg: '#f8f8f2', muted: '#6272a4',
    red: '#ff5555', orange: '#ffb86c', yellow: '#f1fa8c', green: '#50fa7b',
    cyan: '#8be9fd', blue: '#8be9fd', purple: '#bd93f9', pink: '#ff79c6',
  },
  nord: {
    dark: true, bg: '#2e3440', raised: '#3b4252', fg: '#d8dee9', muted: '#616e88',
    red: '#bf616a', orange: '#d08770', yellow: '#ebcb8b', green: '#a3be8c',
    cyan: '#8fbcbb', blue: '#81a1c1', purple: '#b48ead', pink: '#b48ead', accent: '#88c0d0',
  },
  'tokyo-night': {
    dark: true, bg: '#1a1b26', raised: '#292e42', fg: '#c0caf5', muted: '#565f89',
    red: '#f7768e', orange: '#ff9e64', yellow: '#e0af68', green: '#9ece6a',
    cyan: '#7dcfff', blue: '#7aa2f7', purple: '#bb9af7', pink: '#bb9af7',
  },
  'gruvbox-dark': {
    dark: true, bg: '#282828', raised: '#3c3836', fg: '#ebdbb2', muted: '#928374',
    red: '#fb4934', orange: '#fe8019', yellow: '#fabd2f', green: '#b8bb26',
    cyan: '#8ec07c', blue: '#83a598', purple: '#d3869b', pink: '#d3869b', accent: '#fabd2f',
  },
  'rose-pine': {
    dark: true, bg: '#191724', raised: '#26233a', fg: '#e0def4', muted: '#6e6a86',
    red: '#eb6f92', orange: '#ebbcba', yellow: '#f6c177', green: '#31748f',
    cyan: '#9ccfd8', blue: '#9ccfd8', purple: '#c4a7e7', pink: '#ebbcba',
  },
  everforest: {
    dark: true, bg: '#2d353b', raised: '#3d484d', fg: '#d3c6aa', muted: '#859289',
    red: '#e67e80', orange: '#e69875', yellow: '#dbbc7f', green: '#a7c080',
    cyan: '#83c092', blue: '#7fbbb3', purple: '#d699b6', pink: '#d699b6', accent: '#a7c080',
  },
  'github-dark': {
    dark: true, bg: '#0d1117', raised: '#161b22', fg: '#e6edf3', muted: '#8b949e',
    red: '#ff7b72', orange: '#ffa657', yellow: '#e3b341', green: '#7ee787',
    cyan: '#a5d6ff', blue: '#79c0ff', purple: '#d2a8ff', pink: '#d2a8ff', accent: '#58a6ff',
  },
  'one-dark': {
    dark: true, bg: '#282c34', raised: '#2c313a', fg: '#abb2bf', muted: '#5c6370',
    red: '#e06c75', orange: '#d19a66', yellow: '#e5c07b', green: '#98c379',
    cyan: '#56b6c2', blue: '#61afef', purple: '#c678dd', pink: '#c678dd', accent: '#61afef',
  },
  'solarized-dark': {
    dark: true, bg: '#002b36', raised: '#073642', fg: '#93a1a1', muted: '#586e75',
    red: '#dc322f', orange: '#cb4b16', yellow: '#b58900', green: '#859900',
    cyan: '#2aa198', blue: '#268bd2', purple: '#6c71c4', pink: '#d33682', accent: '#268bd2',
  },
  neon: {
    dark: true, bg: '#0b0b17', raised: '#1a1a33', fg: '#e8e8ff', muted: '#6b6b9a',
    red: '#ff3860', orange: '#ff9f1c', yellow: '#fff200', green: '#39ff14',
    cyan: '#00f0ff', blue: '#4d9dff', purple: '#b026ff', pink: '#ff2bd6', accent: '#ff2bd6',
  },
  'catppuccin-latte': {
    dark: false, bg: '#eff1f5', raised: '#e6e9ef', fg: '#4c4f69', muted: '#8c8fa1',
    red: '#d20f39', orange: '#fe640b', yellow: '#df8e1d', green: '#40a02b',
    cyan: '#179299', blue: '#1e66f5', purple: '#8839ef', pink: '#ea76cb',
  },
  'gruvbox-light': {
    dark: false, bg: '#fbf1c7', raised: '#ebdbb2', fg: '#3c3836', muted: '#928374',
    red: '#9d0006', orange: '#af3a03', yellow: '#b57614', green: '#79740e',
    cyan: '#427b58', blue: '#076678', purple: '#8f3f71', pink: '#8f3f71', accent: '#af3a03',
  },
  'rose-pine-dawn': {
    dark: false, bg: '#faf4ed', raised: '#f2e9e1', fg: '#575279', muted: '#9893a5',
    red: '#b4637a', orange: '#d7827e', yellow: '#ea9d34', green: '#286983',
    cyan: '#56949f', blue: '#56949f', purple: '#907aa9', pink: '#d7827e',
  },
  'github-light': {
    dark: false, bg: '#ffffff', raised: '#f6f8fa', fg: '#1f2328', muted: '#656d76',
    red: '#cf222e', orange: '#953800', yellow: '#9a6700', green: '#116329',
    cyan: '#0a3069', blue: '#0550ae', purple: '#8250df', pink: '#8250df', accent: '#0969da',
  },
  'solarized-light': {
    dark: false, bg: '#fdf6e3', raised: '#eee8d5', fg: '#586e75', muted: '#93a1a1',
    red: '#dc322f', orange: '#cb4b16', yellow: '#b58900', green: '#859900',
    cyan: '#2aa198', blue: '#268bd2', purple: '#6c71c4', pink: '#d33682', accent: '#268bd2',
  },
} satisfies Record<string, Palette>

export type PaletteName = keyof typeof PALETTES
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]
export const DARK_NAMES = PALETTE_NAMES.filter(n => PALETTES[n].dark)
export const THEME_NAMES: readonly string[] = [...PALETTE_NAMES, 'mono', 'random']
export const DEFAULT_THEME: PaletteName = 'catppuccin-mocha'

/** Mixes two #rrggbb colors; `t` is the share of `b`. */
const mix = (a: string, b: string, t: number): string => {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')}`
}

const derive = (p: Palette): Theme => {
  const accent = p.accent ?? p.purple
  return {
    accent,
    heading: accent,
    strong: p.fg,
    emphasis: p.pink,
    inlineCode: p.green,
    codeText: p.fg,
    codeCommand: p.blue,
    codeFlag: p.purple,
    codeString: p.green,
    codeComment: p.muted,
    codeFill: p.raised,
    codeBorder: p.muted,
    link: p.blue,
    path: p.cyan,
    number: p.orange,
    quote: mix(p.fg, p.muted, 0.35),
    rule: p.muted,
    tableHeader: accent,
    tableRule: p.muted,
    tableText: p.fg,
    bullet: accent,
    diagram: accent,
    diagramText: p.fg,
    diffAdded: p.green,
    diffRemoved: p.red,
    promptFill: mix(p.bg, p.green, p.dark ? 0.18 : 0.12),
    promptBorder: p.green,
    promptText: p.fg,
    replyFill: p.raised,
    replyBorder: p.orange,
    alertNote: p.blue,
    alertTip: p.green,
    alertImportant: p.purple,
    alertWarning: p.yellow,
    alertCaution: p.red,
  }
}

/** `mono` keeps the terminal's own text color: bold and dim do the work; alerts keep their colors. */
const MONO: Theme = {
  alertNote: 'blue',
  alertTip: 'green',
  alertImportant: 'magenta',
  alertWarning: 'yellow',
  alertCaution: 'red',
}

/** Background tints for diff lines and the words that changed in them; none in mono. */
export type Fills = {
  added?: string
  removed?: string
  addedWord?: string
  removedWord?: string
}

export type Resolved = { name: string; theme: Theme; isMono: boolean; bg?: string; fills: Fills }

const fillsOf = (p: Palette): Fills => ({
  added: mix(p.bg, p.green, p.dark ? 0.16 : 0.14),
  removed: mix(p.bg, p.red, p.dark ? 0.16 : 0.12),
  addedWord: mix(p.bg, p.green, p.dark ? 0.34 : 0.3),
  removedWord: mix(p.bg, p.red, p.dark ? 0.34 : 0.26),
})

/** The theme by name; `random` picks a dark palette, an unknown name the default. */
export const resolveTheme = (name: string, pick: () => number = Math.random): Resolved => {
  if (name === 'mono') return { name, theme: { ...MONO }, isMono: true, fills: {} }
  const chosen: PaletteName =
    name === 'random'
      ? (DARK_NAMES[Math.floor(pick() * DARK_NAMES.length)] ?? DEFAULT_THEME)
      : name in PALETTES
        ? (name as PaletteName)
        : DEFAULT_THEME
  const p = PALETTES[chosen]
  return { name: chosen, theme: derive(p), isMono: false, bg: p.bg, fills: fillsOf(p) }
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i
const ANSI256 = /^ansi256\(\s*\d{1,3}\s*\)$/i
const NAMED = /^(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(Bright)?$/i

/** A color option's value as the surface takes it, or undefined when it does not parse. */
export const parseColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (HEX.test(v)) {
    return v.length === 4 ? `#${[...v.slice(1)].map(c => c + c).join('')}` : v.toLowerCase()
  }
  if (RGB.test(v) || ANSI256.test(v) || NAMED.test(v)) return v
  return undefined
}
