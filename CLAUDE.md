# CLAUDE.md

This repository is a Claude Code marketplace (`haolun1996/claude-tools`) holding two mods (plugins of function hooks):

- `plugins/lumen`: redraws replies, prompts, tool rows, diffs and the turn footer in themed colors.
- `plugins/subagent-changes`: a pane listing each subagent and the files it changed.

`.claude-plugin/marketplace.json` lists both. Each plugin has `.claude-plugin/plugin.json` (with `userConfig` settings), `hooks/hooks.json` naming one module, `hooks/register.tsx`, a `types/index.d.ts` contract and `tests/`.

## Sandbox rules (the engine refuses a module that breaks them)

- No Node, DOM, timers, `eval`/`new Function`, `new RegExp(dynamic)`, dynamic `import()` or WebAssembly. Reach everything through `$`.
- `$` may be passed only to functions declared at the top of `register.tsx`, or imported **`function` declarations** (not arrow functions) from the plugin's own files. Closures inside `register` must not receive `$`.
- `$.env.get` takes a literal name.
- A render hook never writes `$.state`; write from handlers (`onPress`) or other events with `update()`.
- Drawn state lives in `$.state` atoms declared in `types/index.d.ts`. When a stored value's shape changes, bump the atom's `shape` tag.

## lumen layout (`plugins/lumen/hooks`)

| File | Role |
| --- | --- |
| `register.tsx` | All hooks: replies (`AssistantMessage`), prompts (`UserMessage`), tool rows (`ToolUse`, `ToolGroup`, `ToolResult`), footer (`TurnDuration`), `CommandOutput`, `/lumen` command and setup pane, `prompt.compose` hints, `$.lumen.markdown`, shell watching in `tool.call`. |
| `options.ts` | Settings to a `Style`; every option's allowed values. Keep in sync with `userConfig` in `plugin.json`. |
| `theme.ts` | Palettes and token derivation; diff fills. |
| `markdown.ts`, `prepare.ts` | Block parser; footnotes and `$$` math before parsing. |
| `inline.ts`, `links.ts` | Inline markdown to styled runs; which paths and links may open (programs never do). |
| `blocks.ts`, `table.ts`, `shell.ts` | Blocks to lines: headings, lists, quotes, alerts, code styles, tables, side-by-side pictures. |
| `wrap.ts`, `width.ts`, `view.tsx` | Wrapping, display width (emoji are 2), lines to `Text`/`Link`/`Image` elements. |
| `mermaid/` | One renderer per diagram type behind `mermaid/index.ts` (`drawMermaid`), contract in `mermaid/types.ts`. |
| `tables/` | Special-table detection and coloring (`decorateTable`), contract in `tables/types.ts`. |
| `figure.ts`, `latex.ts` | ```` ```figure ```` blocks; RaTeX formulas as images. |
| `chat.ts`, `rows.ts`, `diff.ts`, `shellwatch.ts` | Bubbles and clock; tool row text; line diff and diff cards; files a shell command changes. |
| `setup.tsx`, `hints.ts` | `/lumen setup` pane; the model-only hints note. |

Everything that draws is a pure function to `Line[]` (arrays of styled `Run`s); only `view.tsx` makes elements. Test pure parts directly.

## Checks before committing

```bash
claude plugin validate plugins/lumen
claude plugin test plugins/lumen
claude plugin validate plugins/subagent-changes
claude plugin test plugins/subagent-changes
```

Type-check with `tsc -p plugins/<name>` once Claude Code has laid `.claude-plugin/types/` (it does when the plugin loads from `--plugin-dir`; that folder is git-ignored).

## Conventions

- Glyphs must draw one column wide and never as emoji: `►` `◄`, not `▶` `◀`.
- Width math always uses `width()` from `width.ts`, never `.length`.
- A diagram or figure that cannot draw well returns `{ error }`; the caller keeps the code with a note.
- Do not rename a plugin: its `$.state` keys and `/config` rows are named after it.
