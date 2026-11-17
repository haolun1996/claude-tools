// kvTable: a column of options beside values, sources and defaults. `sources`
// colors where each value comes from, `overrides` marks a value that is not
// its default.

import { gray, headerColumn, isBlank, key, tone } from './common'
import type { Column, Paint, Part } from './common'
import type { SpecialOptions, Theme } from './types'

export type SourceKind = 'env' | 'config' | 'default'

export const sourceOf = (cell: string): SourceKind | undefined => {
  const text = cell.trim().toLowerCase()
  if (text === '') return undefined
  if (/\benv\b|\benvironment\b|env[ _-]?var|^\$[a-z_]/.test(text)) return 'env'
  if (/^(?:default|defaults|unset|none|not set|built-?in|-|–|—)$|^default\b/.test(text)) return 'default'
  if (/config|settings?\b|\bflags?\b|\bcli\b|command[ -]line|\bargs?\b|argument|\.json\b|\.toml\b|\.ya?ml\b|\.rc\b|\.env\b|file/.test(text)) return 'config'
  return undefined
}

const OPTION_HINT = /option|^key$|name|setting|variable|^var$|flag|param|property|^field$|^config/
const DEFAULT_HINT = /default/
const VALUE_HINT = /value|current|effective|actual|set to/
const SOURCE_HINT = /source|origin|^from$|set by|set in|provenance|where/

/** A value as compared with its default: quotes and case dropped, blanks alike. */
const normal = (cell: string) => {
  const text = cell.trim().replace(/^["']|["']$/g, '').toLowerCase()
  return isBlank(text) || /^(?:none|null|unset|not set|empty|\(none\))$/.test(text) ? '' : text
}

export const kvTable = (mode: SpecialOptions['kvTable'], theme: Theme, cols: readonly Column[]): Part | undefined => {
  if (mode === 'off') return undefined
  const def = headerColumn(cols, DEFAULT_HINT)
  const taken = new Set(def ? [def.index] : [])
  const source = headerColumn(cols, SOURCE_HINT, taken)
  if (source) taken.add(source.index)
  const value = headerColumn(cols, VALUE_HINT, taken)
  if (value) taken.add(value.index)
  const option = headerColumn(cols, OPTION_HINT, taken)
  if (option === undefined || (source === undefined && (value === undefined || def === undefined))) return undefined

  const doSources = (mode === 'sources' || mode === 'full') && source !== undefined
  const doOverrides = (mode === 'overrides' || mode === 'full') && value !== undefined && def !== undefined
  if (!doSources && !doOverrides) return undefined

  const cells = new Map<string, Paint>()
  if (doSources && source) {
    source.cells.forEach((cell, row) => {
      const k = sourceOf(cell)
      if (k === undefined) return
      cells.set(key(row, source.index), k === 'env' ? tone(theme.link) : k === 'config' ? tone(theme.codeString) : gray(theme))
    })
  }
  if (doOverrides && value && def) {
    value.cells.forEach((cell, row) => {
      if (isBlank(cell)) return
      if (normal(cell) !== normal(def.cells[row] ?? '')) cells.set(key(row, value.index), tone(theme.accent, { bold: true }, { bold: true }))
    })
  }
  return { cells }
}
