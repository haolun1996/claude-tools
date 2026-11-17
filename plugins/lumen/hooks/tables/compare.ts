// compareTable: a column of scores beside a column of ranks. `rank` draws the
// ranks as medals, `pick` marks the top score in the improvement green.

import { findColumn, isBlank, key, tone } from './common'
import type { Column, Paint, Part } from './common'
import type { SpecialOptions, Theme } from './types'

/** A rank cell: `1`, `#2`, `3rd`, `1.`, 🥇. */
export const rankOf = (cell: string): number | undefined => {
  const text = cell.trim()
  const medal = ['🥇', '🥈', '🥉'].findIndex(m => text.startsWith(m))
  if (medal !== -1) return medal + 1
  const m = /^(?:#\s*)?(\d{1,4})(?:st|nd|rd|th)?\.?$/i.exec(text)
  return m ? Number(m[1]) : undefined
}

/** A score cell: `8.5`, `92%`, `4/5`, `8.5 / 10`, `★★★★☆`. */
export const scoreOf = (cell: string): number | undefined => {
  const text = cell.trim()
  if (/^[★☆]+$/u.test(text)) return [...text].filter(c => c === '★').length
  const m = /^([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:%|pts?|points|\/\s*\d+(?:\.\d+)?|★)?$/i.exec(text)
  return m ? Number((m[1] ?? '').replace(/,/g, '')) : undefined
}

const RANK_HINT = /rank|place|position|^#$|^pos\.?$|standing/
const SCORE_HINT = /score|rating|points|^pts$|total|grade|overall|mark/

export const compareTable = (mode: SpecialOptions['compareTable'], theme: Theme, cols: readonly Column[]): Part | undefined => {
  if (mode === 'off') return undefined
  const rankCol = findColumn(cols, c => rankOf(c) !== undefined, RANK_HINT, Infinity)
  if (rankCol === undefined) return undefined
  const scoreCol = findColumn(cols, c => scoreOf(c) !== undefined, SCORE_HINT, Infinity, new Set([rankCol.index]))
  if (scoreCol === undefined) return undefined

  const cells = new Map<string, Paint>()
  if (mode === 'rank' || mode === 'full') {
    rankCol.cells.forEach((cell, row) => {
      const r = rankOf(cell)
      if (r === 1) cells.set(key(row, rankCol.index), tone(theme.accent, { bold: true }, { bold: true }))
      else if (r === 2 || r === 3) cells.set(key(row, rankCol.index), tone(theme.link, { bold: true }, { bold: true }))
    })
  }
  if (mode === 'pick' || mode === 'full') {
    const scores = scoreCol.cells.map(c => (isBlank(c) ? undefined : scoreOf(c)))
    const ranks = rankCol.cells.map(c => rankOf(c))
    // The ranks tell which way is better: when the best-ranked row has the
    // lower score than the worst-ranked one, lower scores win.
    const ranked = ranks.flatMap((r, row) => (r !== undefined && scores[row] !== undefined ? [{ r, s: scores[row] as number }] : []))
    const best = ranked.reduce<{ r: number; s: number } | undefined>((a, b) => (a === undefined || b.r < a.r ? b : a), undefined)
    const worst = ranked.reduce<{ r: number; s: number } | undefined>((a, b) => (a === undefined || b.r > a.r ? b : a), undefined)
    const lowerWins = best !== undefined && worst !== undefined && best.s < worst.s
    const known = scores.filter((s): s is number => s !== undefined)
    if (known.length > 0) {
      const top = lowerWins ? Math.min(...known) : Math.max(...known)
      scores.forEach((s, row) => {
        if (s === top) cells.set(key(row, scoreCol.index), tone(theme.diffAdded, { bold: true }, { bold: true }))
      })
    }
  }
  return { cells }
}
