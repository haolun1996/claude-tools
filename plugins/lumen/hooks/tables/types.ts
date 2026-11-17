// The contract for special tables (status, test, bench, schema, compare, api,
// kv): a pure analysis of a parsed table that recolors cells, may reorder rows
// and adds lines under the table.

import type { Line, Run } from '../inline'
import type { Theme } from '../theme'

export type SpecialOptions = {
  statusMatrix: 'off' | 'color' | 'summary' | 'group'
  testMatrix: 'off' | 'report'
  benchTable: 'off' | 'color' | 'trend'
  schemaTable: 'off' | 'types' | 'keys' | 'full'
  compareTable: 'off' | 'rank' | 'pick' | 'full'
  apiTable: 'off' | 'verbs' | 'auth' | 'full'
  kvTable: 'off' | 'sources' | 'overrides' | 'full'
}

export type Decoration = {
  /**
   * Restyles one body cell. `row` and `col` index the original rows; `runs`
   * are the cell's runs as inline markdown drew them. Return them unchanged
   * for a cell the decoration leaves alone.
   */
  cell: (row: number, col: number, runs: Run[]) => Run[]
  /** Body rows in the order to draw them (indexes into the original rows); absent keeps the order. */
  order?: number[]
  /** Draw a heavy rule after these positions in `order` (group mode). */
  ruleAfter?: ReadonlySet<number>
  /** Lines drawn under the table (a count line, a report, a sparkline). */
  footer: Line[]
}

export type { Line, Run, Theme }
