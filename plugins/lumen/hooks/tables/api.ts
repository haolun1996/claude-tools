// apiTable: a method column of HTTP verbs. `verbs` colors each by what it
// does, `auth` marks the schemes of an auth column.

import { filled, findColumn, gray, headerColumn, key, tone } from './common'
import type { Column, Paint, Part } from './common'
import type { SpecialOptions, Theme } from './types'

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
const WRITES = new Set(['POST', 'PUT', 'PATCH'])
const VERBS = new Set([...READS, ...WRITES, 'DELETE', 'TRACE', 'CONNECT'])

/** The verb a method cell opens with, uppercased, when it is one. */
export const verbOf = (cell: string): string | undefined => {
  const word = /^[A-Za-z]+/.exec(cell.trim())?.[0]?.toUpperCase()
  return word !== undefined && VERBS.has(word) ? word : undefined
}

const METHOD_HINT = /^(?:http )?(?:method|verb|methods)$/
const AUTH_HINT = /auth|security|scheme|credential/
const SCHEME = /bearer|oauth|api[ _-]?key|jwt|\bbasic\b/i
const PATH = /^\/|^https?:\/\//

export const verbColor = (theme: Theme, verb: string): Paint =>
  READS.has(verb) ? tone(theme.link) : WRITES.has(verb) ? tone(theme.codeString) : verb === 'DELETE' ? tone(theme.diffRemoved, { bold: true }) : gray(theme)

export const apiTable = (mode: SpecialOptions['apiTable'], theme: Theme, cols: readonly Column[]): Part | undefined => {
  if (mode === 'off') return undefined
  // A "Method" header over uppercase words with at least one real verb, or a
  // column of nothing but uppercase verbs beside a column of paths.
  const hinted = cols.find(col => {
    const cells = filled(col)
    return METHOD_HINT.test(col.header) && cells.length > 0 && cells.every(c => /^[A-Z]+\b/.test(c)) && cells.some(c => verbOf(c) !== undefined)
  })
  const hasPaths = cols.some(col => filled(col).length > 0 && filled(col).every(c => PATH.test(c)))
  const method = hinted ?? (hasPaths ? findColumn(cols, c => /^[A-Z]+\b/.test(c) && verbOf(c) !== undefined, /(?!)/, 1) : undefined)
  if (method === undefined) return undefined

  const cells = new Map<string, Paint>()
  if (mode === 'verbs' || mode === 'full') {
    method.cells.forEach((cell, row) => {
      const word = /^[A-Za-z]+/.exec(cell.trim())?.[0]?.toUpperCase()
      if (word !== undefined) cells.set(key(row, method.index), verbColor(theme, word))
    })
  }
  if (mode === 'auth' || mode === 'full') {
    const auth = headerColumn(cols, AUTH_HINT, new Set([method.index]))
    auth?.cells.forEach((cell, row) => {
      if (SCHEME.test(cell)) cells.set(key(row, auth.index), tone(theme.accent, { bold: true }))
    })
  }
  return { cells }
}
