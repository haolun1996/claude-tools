// Node boxes: their size, their rows of text, the border cells edges may meet,
// and how each shape draws.

import type { Canvas, Ink } from './graph-canvas'
import type { GNode, Shape } from './graph-model'
import { cut, pad, width } from '../width'
import { wrap } from '../wrap'

export type BoxRow = { kind: 'title' | 'header' | 'member' | 'blank' | 'sep'; text: string }

export type Box = { shape: Shape; w: number; h: number; rows: BoxRow[] }

/** Words wrapped to `max` columns; explicit line breaks kept. */
export const wrapText = (text: string, max: number): string[] => {
  const out: string[] = []
  for (const hard of text.split('\n')) {
    if (hard.trim() === '') {
      out.push('')
      continue
    }
    for (const l of wrap([{ text: hard }], Math.max(1, max))) out.push(l.map(r => r.text).join(''))
  }
  return out.length === 0 ? [''] : out
}

const clip = (text: string, max: number): string => (width(text) <= max ? text : cut(text, Math.max(1, max - 1)) + '…')

export const isGlyph = (shape: Shape): boolean => shape === 'start' || shape === 'end'

export const makeBox = (node: GNode, maxLabel: number, maxMember: number, lr: boolean): Box => {
  const shape = node.shape
  if (isGlyph(shape)) return { shape, w: 1, h: 1, rows: [] }
  if (shape === 'bar') return lr ? { shape, w: 1, h: 3, rows: [] } : { shape, w: 7, h: 1, rows: [] }
  const rows: BoxRow[] = []
  if (node.header !== undefined) rows.push({ kind: 'header', text: clip(node.header, maxMember) })
  const title = node.label.trim() === '' && shape !== 'record' ? [' '] : wrapText(node.label, maxLabel)
  for (const t of title) rows.push({ kind: 'title', text: t })
  for (const section of node.sections ?? []) {
    rows.push({ kind: 'sep', text: '' })
    for (const m of section) rows.push({ kind: 'member', text: clip(m, maxMember) })
  }
  const inner = Math.max(1, ...rows.map(r => width(r.text)))
  const extra = shape === 'stadium' || shape === 'circle' || shape === 'hexagon' ? 2 : 0
  return { shape, w: inner + 4 + extra, h: rows.length + 2, rows }
}

/** One more cell along the cross axis (TD: wider; LR: taller, keeping text centered). */
export const growBox = (box: Box, lr: boolean): void => {
  if (isGlyph(box.shape)) return
  if (!lr) {
    box.w++
    return
  }
  if (box.shape === 'bar') {
    box.h++
    return
  }
  if (box.shape === 'record') box.rows.push({ kind: 'blank', text: '' })
  else {
    const top = box.rows.findIndex(r => r.kind !== 'blank')
    const bottom = box.rows.length - 1 - [...box.rows].reverse().findIndex(r => r.kind !== 'blank')
    if (box.rows.length - 1 - bottom <= top) box.rows.push({ kind: 'blank', text: '' })
    else box.rows.unshift({ kind: 'blank', text: '' })
  }
  box.h++
}

/** A taller box (TD self loops want two inner rows). */
export const growHeight = (box: Box): void => {
  if (isGlyph(box.shape) || box.shape === 'bar') return
  box.rows.push({ kind: 'blank', text: '' })
  box.h++
}

/** Cross-axis offsets where an edge may meet the box on its main-axis sides. */
export const portSlots = (box: Box, lr: boolean): number[] => {
  if (isGlyph(box.shape)) return [0]
  if (box.shape === 'bar') return Array.from({ length: lr ? box.h : box.w }, (_, i) => i)
  if (!lr) return Array.from({ length: Math.max(0, box.w - 2) }, (_, i) => i + 1)
  const out: number[] = []
  box.rows.forEach((r, i) => {
    if (r.kind !== 'sep') out.push(i + 1)
  })
  return out
}

type Glyphs = { tl: string; tr: string; bl: string; br: string; h: string; l: string; r: string }

const GLYPHS = (shape: Shape): Glyphs => {
  switch (shape) {
    case 'decision':
      return { tl: '◇', tr: '◇', bl: '◇', br: '◇', h: '─', l: '│', r: '│' }
    case 'hexagon':
      return { tl: '╱', tr: '╲', bl: '╲', br: '╱', h: '─', l: '│', r: '│' }
    case 'sub':
      return { tl: '╓', tr: '╖', bl: '╙', br: '╜', h: '─', l: '║', r: '║' }
    case 'stadium':
    case 'circle':
      return { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', l: '(', r: ')' }
    default:
      return { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', l: '│', r: '│' }
  }
}

export type BoxInks = { border: Ink; title: Ink; header: Ink; member: Ink; glyph: Ink }

export const drawBox = (cv: Canvas, box: Box, x: number, y: number, ink: BoxInks): void => {
  if (box.shape === 'start') {
    cv.text(x, y, '●', ink.glyph)
    return
  }
  if (box.shape === 'end') {
    cv.text(x, y, '◉', ink.glyph)
    return
  }
  if (box.shape === 'bar') {
    if (box.h === 1) cv.text(x, y, '━'.repeat(box.w), ink.glyph)
    else for (let i = 0; i < box.h; i++) cv.text(x, y + i, '┃', ink.glyph)
    return
  }
  const g = GLYPHS(box.shape)
  const inner = box.w - 2
  cv.text(x, y, g.tl + g.h.repeat(inner) + g.tr, ink.border)
  cv.text(x, y + box.h - 1, g.bl + g.h.repeat(inner) + g.br, ink.border)
  const side = box.shape === 'stadium' || box.shape === 'circle' ? 2 : 1
  box.rows.forEach((row, i) => {
    const ry = y + 1 + i
    if (row.kind === 'sep') {
      cv.text(x, ry, '├' + '─'.repeat(inner) + '┤', ink.border)
      return
    }
    // Stadium sides curve only where there is text; blank rows keep a straight side for ports.
    const l = row.kind === 'blank' && side === 2 ? '│' : g.l
    const r = row.kind === 'blank' && side === 2 ? '│' : g.r
    cv.text(x, ry, l, ink.border)
    cv.text(x + box.w - 1, ry, r, ink.border)
    const room = box.w - 2 - 2 * side
    const text = row.kind === 'member' ? pad(row.text, room) : pad(row.text, room, 'center')
    cv.text(x + 1, ry, ' '.repeat(side), {})
    const used = cv.text(x + 1 + side, ry, text, row.kind === 'title' ? ink.title : row.kind === 'header' ? ink.header : ink.member)
    const rest = box.w - 2 - side - used
    if (rest > 0) cv.text(x + 1 + side + used, ry, ' '.repeat(rest), {})
  })
}
