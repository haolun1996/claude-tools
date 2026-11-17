/** A theme name; '' for none. */
export type ThemeOverride = string

/** When each prompt was sent (ms since the epoch), by its text; the newest kept. */
export type PromptTimes = Record<string, number>

/** Ids of folded blocks the person opened (a long diff, a new file's lines). */
export type OpenFolds = string[]

/** What `$.lumen.markdown` takes: the surface to draw for, the markdown, the width in columns. */
export type LumenMarkdownArgs<Surface> = {
  surface: Surface
  text: string
  columns: number
}

/**
 * lumen's noun for other mods: `$.lumen.markdown(args)` answers the tree that
 * draws the markdown in the user's lumen theme, or undefined when lumen is off
 * or the text holds nothing to draw. It throws where lumen is not installed.
 */
export type Lumen<Surface, Drawing> = {
  markdown: (args: LumenMarkdownArgs<Surface>) => Promise<Drawing | undefined>
}

declare module 'claude-code' {
  interface EngineInterface {
    lumen: Lumen<RenderSurface, RenderElement>
  }
  interface PluginState {
    lumen: {
      /** A theme /lumen theme picked where the setting could not be saved; '' for none. */
      themeOverride: Shaped<ThemeOverride>
      promptTimes: Shaped<PromptTimes>
      openFolds: Shaped<OpenFolds>
    }
  }
}
