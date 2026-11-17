// Shell lines colored like a prompt: the command word, --flags, quoted
// strings, $variables and # comments; the command word restarts after |, &&,
// || and ;. Diff blocks color their + and - lines. Other code is one color.

import type { Line, Run } from './inline'
import type { Theme } from './theme'

export const SHELL_LANGS = new Set(['', 'bash', 'sh', 'zsh', 'fish', 'shell', 'console', 'powershell', 'ps1', 'pwsh', 'shellsession', 'terminal'])

const PREFIXES = new Set(['sudo', 'env', 'time', 'exec', 'nohup', 'xargs'])

export const shellLine = (theme: Theme, line: string): Line => {
  const out: Run[] = []
  let expectCommand = true
  let i = 0
  const push = (text: string, color: string | undefined) => {
    const last = out[out.length - 1]
    if (last !== undefined && last.color === color) last.text += text
    else out.push({ text, ...(color !== undefined ? { color } : {}) })
  }

  // A prompt sign in front of the command: `$ npm test`.
  const prompt = /^(\s*[$>#%❯]\s+)/.exec(line)
  if (prompt && line.trim().length > 2) {
    push(prompt[1] ?? '', theme.codeComment)
    i = (prompt[1] ?? '').length
  }

  while (i < line.length) {
    const rest = line.slice(i)
    const ch = line[i] as string

    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      push(rest, theme.codeComment)
      break
    }
    if (ch === '"' || ch === "'") {
      let end = i + 1
      while (end < line.length && (line[end] !== ch || (ch === '"' && line[end - 1] === '\\'))) end++
      push(line.slice(i, end + 1), theme.codeString)
      i = end + 1
      expectCommand = false
      continue
    }
    const op = /^(\|\||&&|\||;|&)/.exec(rest)
    if (op) {
      push(op[0], theme.codeFlag)
      i += op[0].length
      expectCommand = true
      continue
    }
    const space = /^\s+/.exec(rest)
    if (space) {
      push(space[0], undefined)
      i += space[0].length
      continue
    }
    const variable = /^\$(?:\{[^}]*\}|\w+|\(|\?)/.exec(rest)
    if (variable) {
      push(variable[0], theme.emphasis)
      i += variable[0].length
      continue
    }
    const word = /^[^\s|;&"'#$]+/.exec(rest)?.[0] ?? ch
    if (expectCommand && /^\w+=/.test(word)) {
      push(word, theme.emphasis) // an env assignment before the command
    } else if (expectCommand) {
      push(word, theme.codeCommand)
      if (!PREFIXES.has(word)) expectCommand = false
    } else if (/^--?[\w-]/.test(word)) {
      push(word, theme.codeFlag)
    } else push(word, theme.codeText)
    i += word.length
  }

  return out.map(r => (r.color === undefined ? { ...r, color: theme.codeText } : r)).map(r => (r.color === undefined ? { text: r.text } : r))
}

export const diffLine = (theme: Theme, line: string): Line => {
  const color = line.startsWith('+') ? theme.diffAdded : line.startsWith('-') ? theme.diffRemoved : line.startsWith('@@') ? theme.accent : theme.codeText
  return [{ text: line, ...(color !== undefined ? { color } : {}) }]
}

export const codeLine = (theme: Theme, lang: string, line: string): Line => {
  if (SHELL_LANGS.has(lang)) return shellLine(theme, line)
  if (lang === 'diff' || lang === 'patch') return diffLine(theme, line)
  return [{ text: line, ...(theme.codeText !== undefined ? { color: theme.codeText } : {}) }]
}
