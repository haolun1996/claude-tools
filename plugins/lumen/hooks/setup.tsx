// /lumen setup: a pane with each style and a button per choice. A press
// saves the setting, the mod reloads with it and the sample on top redraws.

import type { ElementTable, EngineInterface, RenderElement } from 'claude-code'

import { drawBlocks } from './blocks'
import { parse } from './markdown'
import type { Style } from './options'
import {
  BUBBLE_LABELS, CLOCKS, CODE_STYLES, DIFF_STYLES, HEADING_STYLES, LIST_MARKERS, PIE_STYLES, PROMPT_STYLES,
  REPLY_STYLES, TABLE_LAYOUTS, TABLE_STYLES, TASK_STYLES, TOOL_OUTPUTS, TOOL_STYLES,
} from './options'
import { THEME_NAMES } from './theme'
import { linesElement } from './view'

export const SETUP_PANE = 'lumen-setup'

type Step = { key: string; title: string; choices: readonly string[]; current: (s: Style) => string }

const STEPS: Step[] = [
  { key: 'theme', title: 'Theme', choices: THEME_NAMES, current: s => s.themeName.replace(/^random.*/, 'random') },
  { key: 'promptStyle', title: 'Your prompts', choices: PROMPT_STYLES, current: s => s.promptStyle },
  { key: 'replyStyle', title: 'Replies', choices: REPLY_STYLES, current: s => s.replyStyle },
  { key: 'tableStyle', title: 'Tables', choices: TABLE_STYLES, current: s => s.tableStyle },
  { key: 'codeStyle', title: 'Code blocks', choices: CODE_STYLES, current: s => s.codeStyle },
  { key: 'toolStyle', title: 'Tool rows', choices: TOOL_STYLES, current: s => s.toolStyle },
  { key: 'toolOutput', title: 'Tool output', choices: TOOL_OUTPUTS, current: s => s.toolOutput },
  { key: 'diffStyle', title: 'Diffs', choices: DIFF_STYLES, current: s => s.diffStyle },
  { key: 'headingStyle', title: 'Headings', choices: HEADING_STYLES, current: s => s.headingStyle },
  { key: 'tableLayout', title: 'Table layout', choices: TABLE_LAYOUTS, current: s => s.tableLayout },
  { key: 'taskStyle', title: 'Task lists', choices: TASK_STYLES, current: s => s.taskStyle },
  { key: 'listMarker', title: 'List markers', choices: LIST_MARKERS, current: s => s.listMarker },
  { key: 'bubbleLabels', title: 'Bubble labels', choices: BUBBLE_LABELS, current: s => s.bubbleLabels },
  { key: 'clock', title: 'Clock', choices: CLOCKS, current: s => s.clock },
  { key: 'pieStyle', title: 'Pie charts', choices: PIE_STYLES, current: s => s.pieStyle },
]

const SAMPLE = `## Sample

Some **bold**, *italic* and \`code\`, version v2.1.0 in ~/src/app.ts.

- [x] done
- [ ] to do

| Name | Time |
|---|---:|
| build | 120 ms |

\`\`\`bash
npm test -- --watch
\`\`\``

/** Saves one setting; the mod reloads with it. */
export async function choose($: EngineInterface, key: string, value: string): Promise<void> {
  const saved = await $.config.set({ key: `lumen.${key}`, value }).catch((err: unknown) => ({ deny: String(err) }))
  if ('deny' in saved && saved.deny) $.ui.toast(`Could not save ${key}: ${saved.deny}`)
}

export async function drawSetup($: EngineInterface, el: ElementTable, style: Style, columns: number, replyStyle: string): Promise<RenderElement> {
  const { Box, Text, Button } = el
  const t = style.theme
  return (
    <Box flexDirection="column">
      <Text dimColor>Press a choice to save it. The sample redraws in the new look.</Text>
      <Box marginTop={1}>{linesElement(el, drawBlocks(style, parse(SAMPLE), Math.max(20, columns - 2)))}</Box>
      {STEPS.map(step => {
        const now = step.key === 'replyStyle' ? replyStyle : step.current(style)
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text bold {...(t.heading !== undefined ? { color: t.heading } : {})}>{step.title}</Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {step.choices.map(choice => (
                <Button key={`${step.key}-${choice}`} onPress={() => choose($, step.key, choice)}>
                  {choice === now ? `● ${choice}` : `○ ${choice}`}
                </Button>
              ))}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
