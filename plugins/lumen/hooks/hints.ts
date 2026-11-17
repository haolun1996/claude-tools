// The model-only note that tells Claude what this terminal draws, so it
// reaches for a diagram, chart or figure when a picture helps.

const MAIN = `This terminal runs lumen, which draws markdown instead of showing its source: tables, GitHub alerts (> [!NOTE], [!TIP], [!WARNING]), fenced code, and \`\`\`mermaid blocks (flowchart, sequence, state, class and ER diagrams, xychart-beta bar and line charts, pie, gantt, quadrantChart, mindmap, journey, kanban, gitGraph) all render as colored pictures. Put shell commands in fenced blocks.

When a reply explains, compares or plans something that is easier to grasp as a picture (a flow, an architecture, a timeline, numbers to compare), build the reply around a diagram or chart and keep the core on the first screen. Skip pictures for short answers, code changes and status reports. Do not retell in prose what the picture already shows. Keep diagrams within about 80 columns and 40 lines.`

const FIGURES = `For a picture where position carries meaning (durations racing on a time axis, a screen layout, phases, before and after), write a \`\`\`figure block instead of mermaid: its lines draw exactly as written, at most 74 columns, single-width glyphs only (no emoji; use ► ◄ not ▶ ◀). Color runs with {accent:frames and arrows}, {warn:a risk or break}, {ok:healthy or done}, {note:time and effort}, {dim:side notes}, {strong:the key point}; markup is lowercase, not nested, always closed. For a time axis use ▏ ticks and █ bars so bars line up.`

const MATH = 'Display math in $$ … $$ or ```math blocks renders typeset.'

export const hintText = (latex: boolean) => [MAIN, FIGURES, ...(latex ? [MATH] : [])].join('\n\n')
