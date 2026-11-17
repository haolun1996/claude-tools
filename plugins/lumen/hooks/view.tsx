// Lines of styled runs to elements: one Text per line, a Text per run inside
// it, and a Link around a run that points at a web page.

import type { ElementTable, RenderElement } from 'claude-code'

import type { Line, Run } from './inline'

const runElement = (el: ElementTable, run: Run): RenderElement => {
  const { Text, Link } = el
  const text = (
    <Text
      {...(run.color !== undefined ? { color: run.color } : {})}
      {...(run.bg !== undefined ? { backgroundColor: run.bg } : {})}
      {...(run.bold ? { bold: true } : {})}
      {...(run.italic ? { italic: true } : {})}
      {...(run.strike ? { strikethrough: true } : {})}
      {...(run.underline ? { underline: true } : {})}
      {...(run.dim ? { dimColor: true } : {})}
    >
      {run.text}
    </Text>
  )
  return run.href !== undefined ? <Link href={run.href}>{text}</Link> : text
}

export const lineElement = (el: ElementTable, line: Line): RenderElement => {
  const { Text } = el
  if (line.length === 0) return <Text> </Text>
  const picture = line.find(r => r.image !== undefined)?.image
  if (picture !== undefined && 'Image' in el) {
    const { Image } = el
    return <Image source={{ png: picture.png }} columns={picture.columns} rows={picture.rows} alt={picture.alt} />
  }
  return <Text wrap="truncate-end">{line.map(run => runElement(el, run))}</Text>
}

export const linesElement = (el: ElementTable, lines: readonly Line[]): RenderElement => {
  const { Box } = el
  return <Box flexDirection="column">{lines.map(l => lineElement(el, l))}</Box>
}
