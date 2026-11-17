// Display width of text in terminal columns: wide East Asian characters and
// most emoji take two, combining marks and zero-width characters none.

const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff], [0x1f680, 0x1f6ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]

const isZeroWidth = (cp: number) =>
  (cp >= 0x0300 && cp <= 0x036f) || // combining marks
  (cp >= 0x200b && cp <= 0x200f) || // zero-width space, joiners, direction marks
  (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
  cp === 0x00ad || cp < 0x20

const isWide = (cp: number) => WIDE.some(([lo, hi]) => cp >= lo && cp <= hi)

const EMOJI = /\p{Emoji_Presentation}/u
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const ZWJ = '‍'
const VS16 = '️'

/** One character alone: emoji such as ✅ ⏳ 🚀 take two columns. */
export const charWidth = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0
  if (isZeroWidth(cp)) return 0
  return isWide(cp) || EMOJI.test(ch) ? 2 : 1
}

/**
 * Width of text as a terminal draws it: an emoji takes two columns, so does a
 * symbol followed by U+FE0F (✔️), and an emoji joined to the one before it by
 * a zero-width joiner adds none, so 👨‍👩‍👧 is two.
 */
export const width = (text: string): number => {
  const chars = [...text]
  let n = 0
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string
    if (chars[i - 1] === ZWJ && PICTOGRAPHIC.test(ch)) continue
    if (PICTOGRAPHIC.test(ch) && chars[i + 1] === VS16) {
      n += 2
      continue
    }
    n += charWidth(ch)
  }
  return n
}

/** Cuts text to at most `max` columns. */
export const cut = (text: string, max: number): string => {
  let n = 0
  let out = ''
  for (const ch of text) {
    const w = charWidth(ch)
    if (n + w > max) break
    n += w
    out += ch
  }
  return out
}

export const pad = (text: string, size: number, align: 'left' | 'center' | 'right' = 'left'): string => {
  const room = Math.max(0, size - width(text))
  if (align === 'right') return ' '.repeat(room) + text
  if (align === 'center') {
    const left = Math.floor(room / 2)
    return ' '.repeat(left) + text + ' '.repeat(room - left)
  }
  return text + ' '.repeat(room)
}
