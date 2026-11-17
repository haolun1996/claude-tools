# claude-tools

Claude Code mods by haolun1996, in one marketplace:

- **lumen** redraws Claude Code's chat in color. Replies get themed text, tables, code blocks, mermaid diagrams and charts, text figures and typeset math. Prompts and replies sit in chat bubbles, tool calls draw as one-line rows, and edits draw as diff cards. 16 themes plus `mono`.
- **subagent-changes** adds a pane beside the chat that lists every subagent the session starts, with each file it added, modified, deleted or renamed and the lines that changed.

Each is a separate plugin: install either one or both.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install lumen --marketplace haolun1996/claude-tools
```

```
/plugin install subagent-changes --marketplace haolun1996/claude-tools
```

Answer `y` to add the marketplace, then press Enter for the user scope. Or add the marketplace once and install by name:

```
/plugin marketplace add haolun1996/claude-tools
/plugin install lumen@claude-tools
/plugin install subagent-changes@claude-tools
```

From a shell:

```bash
claude plugin install lumen --marketplace haolun1996/claude-tools
claude plugin install subagent-changes --marketplace haolun1996/claude-tools
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `haolun1996/claude-tools`, then Add plugin.

Turn either off in `/plugin`; Claude Code's own drawing comes back at once. Don't run lumen together with another mod that redraws replies (such as prismantis): both would draw the same rows.

## lumen

`/lumen setup` opens a pane to pick the theme and styles with a sample that redraws as you choose. `/lumen theme <name>` switches theme, `/lumen help` lists everything.

### What it draws

| Area | What you get |
| --- | --- |
| Themes | `catppuccin-mocha` (default), `dracula`, `nord`, `tokyo-night`, `gruvbox-dark`, `rose-pine`, `everforest`, `github-dark`, `one-dark`, `solarized-dark`, `neon`, `catppuccin-latte`, `gruvbox-light`, `rose-pine-dawn`, `github-light`, `solarized-light`, plus `mono` (bold and dim only) and `random`. Every color slot can be overridden. Themes color what lumen draws; they do not change your terminal's own colors, so pick a dark theme for a dark terminal. |
| Text | **Bold**, *italic*, ~~strikethrough~~, `inline code`, links; numbers, versions, durations, sizes and percentages in the number color; paths in the path color. Inline `$…$` math shows its symbols (`\rho` as ρ). |
| Headings, lists, quotes | 4 heading styles (`banner`, `bold`, `underline`, `uppercase`), nested lists, task lists in 4 styles (`checks`, `ticks`, `box`, `progress`), quotes with an accent bar, GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) as colored boxes, footnotes as superscript marks with the notes at the end. |
| Code blocks | 4 styles: `plain`, `framed` (a rounded box), `filled` (a background), `card` (both). Shell blocks color the command word, `--flags`, strings, `$variables` and `# comments`; `diff` blocks color their `+`/`-` lines. |
| Tables | 4 styles (`box`, `rules`, `grid`, `minimal`), 4 layouts (`classic`, `auto`, `compact`, `stacked` cards), `:---:` alignment, colored numbers, sized to the window with long columns wrapping first. Optional coloring for status, test-result, benchmark, schema, comparison, API and config tables. |
| Diagrams and charts | ```` ```mermaid ```` flowcharts, sequence, state, class and ER diagrams, `xychart-beta` bar and line charts, pie (a text circle or bars), gantt, quadrant charts, mindmaps, journeys, kanban boards and gitGraphs, drawn as colored text. A diagram too wide for the window stays code with a note saying why. Back-to-back tables and diagrams sit side by side when they fit. |
| Figures | ```` ```figure ```` blocks draw text pictures as written, colored with `{accent:…}`, `{warn:…}`, `{ok:…}`, `{note:…}`, `{dim:…}`, `{strong:…}`. A figure with a glyph that may draw as an emoji, a tab or broken markup stays code, with a note naming the line. |
| LaTeX | `$$ … $$` and ```` ```math ```` formulas typeset as pictures in kitty and Ghostty (outside tmux) once `latex` is on and [RaTeX](https://github.com/erweixin/RaTeX)'s renderer is installed as `ratex-render` on your `PATH`. Elsewhere they stay text. |
| Your prompts | `bubble` on the right like a chat app (default), `framed`, `wide`, `bar`, `chevron` or `off`. `clock` adds when you sent each prompt and when each turn finished. |
| Replies | `bubble` (with `● Claude` over it), `solid`, `framed` or `off`; `auto` follows the prompt style. |
| Tool rows | Each call is one row: `Ran npm test`, `Read src/app.ts`, `Edited …`, with a status dot (running, done, failed). Folded groups read `Ran 3 commands, read 2 files · last: …`. 4 row styles (`chat`, `tree-dim`, `tree-bold`, `classic`); `toolOutput` `quiet` hides output under reads and read-only commands, `rows` under every call that worked. |
| Diff cards | Edits draw as diff cards in 4 styles (`card`, `full`, `marks`, `bar`) with the changed words tinted. A file Write creates shows its first 10 lines. Files a shell command changes get cards too: `sed -i`/`perl -i` edits and `>`/`>>`/`tee` writes as diffs, `rm` as `Deleted <path> (N lines)`, `mv` as `Renamed old → new`. Long cards fold behind `+N more lines`. |
| Turn footer | `✻ Baked for 6m 20s` with the duration in the number color. |
| Slash commands | Command output that holds markdown (tables, lists, code) is drawn like a reply. |
| Diagram hints | A short model-only note in the system prompt tells Claude that diagrams, charts and figures render here, so it uses them when a picture helps (about 600 tokens, cached; off with `diagramHints`). |
| Links | Paths (`~/src/a.ts`, `./a.md`, `/tmp/x/y.txt`) and editor links (`vscode://file/…`, `cursor://`, `zed://`, `windsurf://`) open on click. Programs, scripts and installers (`.sh`, `.py`, `.exe`, `.app`, `.command`, …) never link, a `file://` link whose text is not its own path shows its target, and paths stay text over SSH. |
| Other mods | `$.lumen.markdown({ surface, text, columns })` draws markdown in the user's lumen theme (see below). |

lumen draws in the terminal by default; the `surfaces` setting adds `desktop`, `vscode` or `mobile`.

### Configure

Open `/config` and look for the **lumen** rows, or set values in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "lumen@claude-tools": {
      "options": {
        "theme": "tokyo-night",
        "codeStyle": "card",
        "tableStyle": "grid",
        "numberColor": "#ffcc00"
      }
    }
  }
}
```

| Option | Values | Default |
| --- | --- | --- |
| `enabled` | `true`, `false`. Draw replies with lumen. Off falls back to Claude Code's own renderer. | `true` |
| `surfaces` | text. Where lumen draws: all, or a comma-separated list of terminal, desktop, vscode, mobile. The rest use Claude Code's own renderer. | `terminal` |
| `theme` | `catppuccin-mocha`, `dracula`, `nord`, `tokyo-night`, `gruvbox-dark`, `rose-pine`, `everforest`, `github-dark`, `one-dark`, `solarized-dark`, `neon`, `catppuccin-latte`, `gruvbox-light`, `rose-pine-dawn`, `github-light`, `solarized-light`, `mono`, `random`. The color theme. random picks a dark theme each time the mod loads. | `catppuccin-mocha` |
| `codeStyle` | `plain`, `framed`, `filled`, `card`. plain: no frame. framed: a rounded box. filled: a background. card: a rounded box on a background. | `plain` |
| `tableStyle` | `box`, `rules`, `grid`, `minimal`. box: every cell boxed. grid: framed, no lines between rows. rules: horizontal rules only. minimal: a rule under the header. | `box` |
| `tableLayout` | `classic`, `auto`, `compact`, `stacked`. classic: columns share the width. auto: stack rows as cards when the longest words do not fit. compact: columns at their longest word. stacked: always cards. | `classic` |
| `headingStyle` | `banner`, `bold`, `underline`, `uppercase`. banner: a box around H1, a heavy rule under H2. bold, underline (H1 and H2), uppercase (H1). | `banner` |
| `listMarker` | `dots`, `dash`. dots: bullets nested as dots. dash: - at every level, pastes as a markdown list. | `dots` |
| `taskStyle` | `checks`, `ticks`, `box`, `progress`. checks: [ ] [✓]. ticks: ○ ✓. box: □ ✓. progress: ticks with a done-count bar. | `checks` |
| `highlightNumbers` | `true`, `false`. Numbers, versions, durations, sizes and percentages in the number color. | `true` |
| `highlightPaths` | `true`, `false`. File paths in the path color. | `true` |
| `promptStyle` | `bubble`, `framed`, `wide`, `bar`, `chevron`, `off`. bubble: your prompt on the right in a filled bubble. framed: the same with no fill. wide: a full-width box. bar: an accent bar. chevron: a bold ❯. off: Claude Code's own. | `bubble` |
| `replyStyle` | `auto`, `bubble`, `solid`, `framed`, `off`. auto: bubble while prompts are bubbles, else off. bubble: a framed, filled bubble. solid: filled to the edge. framed: a frame, no fill. off: a dot before the first line. | `auto` |
| `bubbleLabels` | `small`, `large`, `off`. small: You ● and ● Claude over the bubbles. large: a bigger ⬤ (some terminals draw it wider than one column). off: no labels. | `small` |
| `clock` | `off`, `24h`, `12h`. Show when you sent each prompt and when each turn finished. | `off` |
| `toolRows` | `true`, `false`. Draw each tool call as one row (Ran, Read, Edited) with a status dot, and edits as diff cards. | `true` |
| `toolStyle` | `chat`, `tree-dim`, `tree-bold`, `classic`. chat: dimmed on the right. tree-dim: under the reply with ⎿, dimmed. tree-bold: tree-dim with one-line sentences in bold. classic: bold verb, full brightness. | `chat` |
| `toolOutput` | `full`, `quiet`, `rows`. full: output as usual. quiet: nothing under reads and read-only commands. rows: nothing under any call that worked (edits keep their diff, failures their error). | `full` |
| `diffStyle` | `card`, `full`, `marks`, `bar`. card: a rounded box with tinted lines. full: lines tinted across the width. marks: colored + and − only. bar: a colored ▌ before changed lines. | `card` |
| `commandOutput` | `true`, `false`. Draw slash command output that holds markdown (tables, lists, code) like a reply. | `true` |
| `mermaid` | `true`, `false`. Draw ```mermaid blocks as diagrams and charts. Off keeps them as code. | `true` |
| `mermaidAscii` | `true`, `false`. Draw diagram lines with + - | instead of box characters. | `false` |
| `pieStyle` | `round`, `bars`. round: a circle with a legend. bars: one bar per slice. | `round` |
| `statusMatrix` | `off`, `color`, `summary`, `group`. color: status cells (✓ passed, ✗ failed, pending) in theme colors. summary: plus a count line. group: plus rows grouped by status. | `off` |
| `testMatrix` | `off`, `report`. report: a line under a table of test results with the share passed, other results and total time. | `off` |
| `benchTable` | `off`, `color`, `trend`. color: changes green for an improvement, red for a regression. trend: plus a sparkline of the runs. | `off` |
| `schemaTable` | `off`, `types`, `keys`, `full`. types: type cells by family. keys: PK, FK, unique marked. full: both. | `off` |
| `compareTable` | `off`, `rank`, `pick`, `full`. rank: rank cells as medals. pick: the top score marked. full: both. | `off` |
| `apiTable` | `off`, `verbs`, `auth`, `full`. verbs: method cells by HTTP verb. auth: auth schemes marked. full: both. | `off` |
| `kvTable` | `off`, `sources`, `overrides`, `full`. sources: source cells by origin. overrides: values off their default marked. full: both. | `off` |
| `latex` | `true`, `false`. Typeset $$ and ```math formulas as images in kitty and Ghostty (needs ratex-render on PATH). Elsewhere they stay text. | `false` |
| `footnotes` | `true`, `false`. Draw [^1] footnote marks as superscripts with the notes at the end of the reply. | `true` |
| `clickablePaths` | `true`, `false`. Make file paths and editor links in replies open on click (never programs or scripts). | `true` |
| `diagramHints` | `true`, `false`. Add a short model-only note to each prompt saying diagrams, charts and figures render here (about 600 tokens). | `true` |
| `<token>Color` | a color for one slot: `accent`, `heading`, `strong`, `emphasis`, `inlineCode`, `codeText`, `codeCommand`, `codeFlag`, `codeString`, `codeComment`, `codeFill`, `codeBorder`, `link`, `path`, `number`, `quote`, `rule`, `tableHeader`, `tableRule`, `tableText`, `bullet`, `diagram`, `diagramText`, `diffAdded`, `diffRemoved`, `promptFill`, `promptBorder`, `promptText`, `replyFill`, `replyBorder`, `alertNote`, `alertTip`, `alertImportant`, `alertWarning`, `alertCaution` | the theme's |

A color is hex (`#a6e3a1`, `#fc0`), `rgb(166,227,161)`, `ansi256(114)` or a name (`green`, `cyanBright`); one that does not parse is ignored.

### For other mods

```tsx
let drawn
try {
  drawn = await $.lumen.markdown({ surface: e.surface, text, columns: e.props.bodyColumns })
} catch {}
return drawn ?? <Markdown text={text} />
```

It answers `undefined` when lumen is off or the text holds nothing to draw, and throws when lumen is not installed. List `lumen` under `dependencies` in your `plugin.json` to get its types.

### What it runs and reads

No network calls. It runs `date +%z` once per session (for the clock's time zone) and, only with `latex` on in kitty or Ghostty, `mktemp -d` and `ratex-render`. To draw shell-change cards it reads the files a shell command names in `rm`, `mv`, `sed -i`, `perl -i`, `tee`, `>` and `>>`, before and after the command, up to 512 KB each.

### Limits

- The markdown parser covers what Claude writes; it is not full CommonMark.
- Widths count CJK and emoji as two columns; a few emoji draw at other widths in some terminals.
- Diagram layouts are drawn in text; very large diagrams stay code.
- Tested in the terminal (Ghostty, macOS). The desktop app, VS Code and mobile are off by default.

## subagent-changes

A **Subagent changes** pane opens beside the chat (from about 144 columns; `/subagent-changes` opens it any time):

```
2 subagents · 1 added · 1 modified · 1 deleted · 1 renamed

▾ general-purpose  Fix login bug  done  4 files
    view transcript
    A src/new.ts     +40 -0  L1-40
    M src/app.ts     +2 -1   L13-14, L40 (2 changes)
    R src/util.ts → lib/util.ts
    D old/legacy.ts  deleted
```

- Click a subagent's row to collapse it; **view transcript** opens its conversation.
- Click an added, modified or renamed file to see the diff of its latest edit.
- When a subagent finishes, a toast sums up its changes; the status line counts running subagents and changed files.
- Changes come from a subagent's `Write`, `Edit` and `NotebookEdit` calls, and its shell `rm`, `unlink`, `rmdir`, `git rm`, `mv` and `git mv`. Globs, scripts and other shell edits are not tracked.
- `/subagent-changes clear` empties the log.

## Develop

```bash
git clone https://github.com/haolun1996/claude-tools
claude --plugin-dir ./claude-tools/plugins/lumen --plugin-dir ./claude-tools/plugins/subagent-changes
```

Edits hot-reload in that session. Before a commit run `claude plugin validate plugins/<name>`, `claude plugin test plugins/<name>` and a type-check (see CLAUDE.md).

## License

[MIT](LICENSE). Theme palettes are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
