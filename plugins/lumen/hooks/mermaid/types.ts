// The contract every diagram renderer follows. A renderer is a pure function:
// mermaid source in, styled text lines out (or an error saying why not).

import type { Line, Run } from '../inline'
import type { Theme } from '../theme'

export type DiagramContext = {
  theme: Theme
  /** Columns available. A result wider than this is refused by the caller. */
  width: number
  /** The theme has no colors (mono): use bold and dim instead. */
  isMono: boolean
  /** How a pie draws: a text circle, or one bar per slice. */
  pieStyle: 'round' | 'bars'
}

export type DiagramResult = { lines: Line[] } | { error: string }

/** One diagram type's renderer: mermaid source (the whole block, keyword line included) to lines. */
export type Renderer = (ctx: DiagramContext, source: string) => DiagramResult

/** A diagram taller than this stays code. */
export const MAX_LINES = 80

/**
 * Distinct colors for boxes, participants, series and slices, in order.
 * In mono there are none: renderers fall back to bold / plain.
 */
export const seriesColors = (theme: Theme): string[] => {
  const picks = [
    theme.accent, theme.link, theme.inlineCode, theme.number, theme.emphasis,
    theme.path, theme.alertWarning, theme.diffRemoved, theme.alertImportant,
  ]
  return [...new Set(picks.filter((c): c is string => c !== undefined))]
}

/** A run in a color, or plain when the color is undefined (mono). */
export const paint = (text: string, color: string | undefined, extra: Omit<Run, 'text' | 'color'> = {}): Run =>
  color === undefined ? { text, ...extra } : { text, color, ...extra }

/** Line-drawing color (theme.diagram) and label color (theme.diagramText). */
export const lineRun = (theme: Theme, text: string): Run => paint(text, theme.diagram, theme.diagram === undefined ? { dim: true } : {})
export const labelRun = (theme: Theme, text: string): Run => paint(text, theme.diagramText)

export type { Line, Run }
