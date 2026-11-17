// Special tables: each enabled kind reads the table by its headers and cells;
// those that recognize it recolor cells (later kinds win on the same cell),
// statusMatrix `group` reorders rows, and the footers are concatenated, the
// test report taking the place of the status count line when both draw.

import { apiTable } from './api'
import { benchTable } from './bench'
import { applyPaint, columnsOf } from './common'
import type { Paint, Part } from './common'
import { compareTable } from './compare'
import { kvTable } from './kv'
import { schemaTable } from './schema'
import { statusMatrix, testMatrix } from './status'
import type { Decoration, Line, Run, SpecialOptions, Theme } from './types'

export const decorateTable = (
  options: SpecialOptions,
  theme: Theme,
  header: readonly string[],
  rows: readonly (readonly string[])[],
): Decoration | undefined => {
  if (header.length === 0 || rows.length === 0) return undefined
  const cols = columnsOf(header, rows)

  const status = statusMatrix(options.statusMatrix, theme, cols)
  const test = testMatrix(options.testMatrix, theme, cols)
  const parts: Part[] = [
    status,
    test,
    benchTable(options.benchTable, theme, cols),
    schemaTable(options.schemaTable, theme, cols),
    compareTable(options.compareTable, theme, cols),
    apiTable(options.apiTable, theme, cols),
    kvTable(options.kvTable, theme, cols),
  ].filter((p): p is Part => p !== undefined)
  if (parts.length === 0) return undefined

  const paints = new Map<string, Paint>()
  for (const part of parts) for (const [k, p] of part.cells) paints.set(k, p)

  const footer: Line[] = []
  for (const part of parts) {
    if (part === status && test !== undefined) continue
    footer.push(...(part.footer ?? []))
  }

  const decoration: Decoration = {
    cell: (row: number, col: number, runs: Run[]) => {
      const p = paints.get(`${row}:${col}`)
      return p === undefined ? runs : applyPaint(runs, p)
    },
    footer,
  }
  if (status?.order !== undefined) decoration.order = status.order
  if (status?.ruleAfter !== undefined && status.ruleAfter.size > 0) decoration.ruleAfter = status.ruleAfter
  return decoration
}
