// Inline markdown to styled runs: bold, italic, strikethrough, inline code,
// links and bare URLs, then numbers, versions, durations, sizes, percentages
// and paths picked out of the plain text.

import { isOpenableLink, pathHref } from './links'
import type { Style } from './options'
import { INLINE_MATH, mathText } from './prepare'

export type Run = {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
  dim?: boolean
  /** A URL the run links to: http(s), an editor's file link, or file:// for a path. */
  href?: string
  /** A picture drawn in place of the line holding this run (a typeset formula). */
  image?: { png: string; columns: number; rows: number; alt: string }
}

export type Line = Run[]

type Marks = { bold?: boolean; italic?: boolean; strike?: boolean }

const URL_RE = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/
const AUTOLINK = /^<(https?:\/\/[^\s>]+)>/
const LINK = /^\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/

/** The first index at or after `from` where `delim` closes, not preceded by a backslash. */
const closing = (text: string, delim: string, from: number): number => {
  let i = from
  while (i < text.length) {
    const at = text.indexOf(delim, i)
    if (at === -1) return -1
    if (text[at - 1] !== '\\' && at > from) return at
    i = at + 1
  }
  return -1
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)

const apply = (style: Style, marks: Marks, run: Run): Run => {
  const t = style.theme
  const out: Run = { ...run }
  if (marks.bold) {
    out.bold = true
    out.color ??= t.strong
  }
  if (marks.italic) {
    out.italic = true
    out.color ??= t.emphasis
  }
  if (marks.strike) {
    out.strike = true
    out.dim = true
  }
  return out
}

// Numbers and paths, in plain text only.
const VERSION = /^v?\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?(?![\w.])/
const DURATION = /^\d+(?:\.\d+)?(?:ns|µs|us|ms|s|m|h|d)(?![\p{L}\p{N}])/u
const SIZE = /^\d+(?:\.\d+)?\s?(?:[KMGTP]i?B|[KMGTP]i|B)(?![\p{L}\p{N}])/u
const PERCENT = /^\d+(?:\.\d+)?%/
const NUMBER = /^\d[\d,_]*(?:\.\d+)?(?![\p{L}])/u
const PATH = /^(?:~\/|\.{1,2}\/|\/)[\w.@+-]+(?:\/[\w.@+-]*)*|^[\w.@-]+(?:\/[\w.@+-]+)+\.\w+/

const highlight = (style: Style, text: string, base: Run): Run[] => {
  const t = style.theme
  if (!style.highlightNumbers && !style.highlightPaths) return [{ ...base, text }]
  const out: Run[] = []
  let plain = ''
  const flush = () => {
    if (plain !== '') out.push({ ...base, text: plain })
    plain = ''
  }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const prev = text[i - 1]
    const atWordStart = !isWordChar(prev) && prev !== '.' && prev !== '/'
    let match: string | undefined
    let color: string | undefined
    if (atWordStart && style.highlightPaths) {
      const p = PATH.exec(rest)?.[0]
      // A path holds a slash past its first character: "/" alone and "/config"
      // (a slash command) stay text.
      if (p !== undefined && (p.slice(1).includes('/') || p.startsWith('~/') || p.startsWith('./') || p.startsWith('../'))) {
        match = p.replace(/[.,;:]+$/, '')
        color = t.path
      }
    }
    if (match === undefined && atWordStart && style.highlightNumbers) {
      match = (VERSION.exec(rest) ?? DURATION.exec(rest) ?? SIZE.exec(rest) ?? PERCENT.exec(rest) ?? NUMBER.exec(rest))?.[0]
      color = t.number
    }
    if (match !== undefined && match !== '') {
      flush()
      const href = color === t.path && style.clickablePaths ? pathHref(style.links, match) : undefined
      out.push({ ...base, text: match, ...(base.color === undefined || base.color === t.strong ? { color } : {}), ...(href !== undefined && base.href === undefined ? { href } : {}) })
      i += match.length
      continue
    }
    plain += text[i]
    i++
  }
  flush()
  return out
}

/** Parses inline markdown into runs, every run given `base` and the marks around it. */
export const inline = (style: Style, text: string, base: Run = { text: '' }, marks: Marks = {}): Run[] => {
  const t = style.theme
  const out: Run[] = []
  let plain = ''
  const flush = () => {
    if (plain !== '') out.push(...highlight(style, plain, apply(style, marks, { ...base, text: '' })))
    plain = ''
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    const rest = text.slice(i)

    if (ch === '\\' && i + 1 < text.length && /[\\`*_~[\]()#+\-.!|<>]/.test(text[i + 1] as string)) {
      plain += text[i + 1]
      i += 2
      continue
    }

    if (ch === '`') {
      const ticks = /^`+/.exec(rest)?.[0] ?? '`'
      const end = text.indexOf(ticks, i + ticks.length)
      if (end !== -1) {
        flush()
        const code = text.slice(i + ticks.length, end).replace(/^ (.*) $/, '$1')
        out.push(apply(style, { ...marks, italic: false }, { ...base, text: code, color: t.inlineCode }))
        i = end + ticks.length
        continue
      }
    }

    const link = LINK.exec(rest)
    if (link) {
      flush()
      const [, label = '', href = ''] = link
      // A file:// link opens only where its text is the path it opens, so a
      // harmless name cannot hide what a click runs.
      const filePath = href.startsWith('file://') ? decodeURI(href.slice(7)) : undefined
      const opens =
        filePath !== undefined
          ? style.clickablePaths && (label === '' || label === href || label === filePath) && style.links !== undefined && pathHref(style.links, filePath) !== undefined
          : isOpenableLink(href) && (style.clickablePaths || /^https?:/i.test(href))
      const runs = inline(style, label === '' ? href : label, { ...base, color: t.link, underline: true }, marks)
      out.push(...runs.map(r => (opens ? { ...r, href } : r)))
      if (!opens && href !== label) out.push({ ...base, text: ` (${href})`, dim: true })
      i += link[0].length
      continue
    }

    const auto = AUTOLINK.exec(rest) ?? (isWordChar(text[i - 1]) ? null : URL_RE.exec(rest))
    if (auto) {
      flush()
      const href = auto[1] ?? auto[0]
      out.push(apply(style, marks, { ...base, text: href, color: t.link, underline: true, href }))
      i += auto[0].length
      continue
    }

    if (rest.startsWith('**') || rest.startsWith('__')) {
      const delim = rest.slice(0, 2)
      const end = closing(text, delim, i + 2)
      const isOpenOk = delim === '**' || !isWordChar(text[i - 1])
      if (end !== -1 && isOpenOk && text[i + 2] !== ' ') {
        flush()
        out.push(...inline(style, text.slice(i + 2, end), base, { ...marks, bold: true }))
        i = end + 2
        continue
      }
    }

    if (rest.startsWith('~~')) {
      const end = closing(text, '~~', i + 2)
      if (end !== -1) {
        flush()
        out.push(...inline(style, text.slice(i + 2, end), base, { ...marks, strike: true }))
        i = end + 2
        continue
      }
    }

    if (ch === '$') {
      const math = INLINE_MATH.exec(rest)
      if (math) {
        flush()
        out.push(apply(style, marks, { ...base, text: mathText(math[1] ?? ''), italic: true, ...(t.emphasis !== undefined ? { color: t.emphasis } : {}) }))
        i += math[0].length
        continue
      }
    }

    if ((ch === '*' || ch === '_') && text[i + 1] !== ch && text[i + 1] !== ' ' && text[i + 1] !== undefined) {
      const end = closing(text, ch, i + 1)
      const isOpenOk = ch === '*' || !isWordChar(text[i - 1])
      const isCloseOk = end !== -1 && text[end - 1] !== ' ' && (ch === '*' || !isWordChar(text[end + 1]))
      if (isOpenOk && isCloseOk) {
        flush()
        out.push(...inline(style, text.slice(i + 1, end), base, { ...marks, italic: true }))
        i = end + 1
        continue
      }
    }

    plain += ch
    i++
  }
  flush()
  return out
}

/** The plain text of runs. */
export const plainOf = (runs: readonly Run[]) => runs.map(r => r.text).join('')
