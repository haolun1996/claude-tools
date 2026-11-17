// What a tool call did, in a few words: the verb and target of its row, and
// the summary line of a folded group of calls.

import type { Line, Run } from './inline'
import type { Style } from './options'
import { shellLine } from './shell'

export type Status = 'running' | 'done' | 'failed' | 'interrupted'

const str = (input: unknown, key: string): string | undefined => {
  if (input === null || typeof input !== 'object') return undefined
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined
}

export const shortPath = (cwd: string, path: string) => {
  const root = cwd.replace(/\/$/, '') + '/'
  return cwd !== '' && path.startsWith(root) ? path.slice(root.length) : path
}

const firstLine = (text: string) => {
  const lines = text.split('\n')
  return lines.length > 1 ? `${lines[0]} …` : (lines[0] ?? '')
}

/** The verb and target of one call's row. */
export const describe = (style: Style, cwd: string, tool: string, input: unknown): { verb: string; target: Run[] } => {
  const t = style.theme
  const path = (key: string) => {
    const p = str(input, key)
    return p === undefined ? [] : [{ text: shortPath(cwd, p), ...(t.path ? { color: t.path } : {}) }]
  }
  const quoted = (text: string | undefined) => (text === undefined ? [] : [{ text, ...(t.codeString ? { color: t.codeString } : {}) }])
  switch (tool) {
    case 'Bash':
      return { verb: 'Ran', target: shellLine(t, firstLine(str(input, 'command') ?? '')) }
    case 'Read': {
      const offset = Number(str(input, 'offset') ?? 0)
      const limit = Number(str(input, 'limit') ?? 0)
      const range = limit > 0 ? [{ text: ` lines ${offset || 1}–${(offset || 1) + limit - 1}`, dim: true }] : []
      return { verb: 'Read', target: [...path('file_path'), ...range] }
    }
    case 'Edit':
    case 'MultiEdit':
      return { verb: 'Edited', target: path('file_path') }
    case 'Write':
      return { verb: 'Wrote', target: path('file_path') }
    case 'NotebookEdit':
      return { verb: 'Edited', target: path('notebook_path') }
    case 'Grep': {
      const where = str(input, 'path')
      return { verb: 'Searched', target: [...quoted(str(input, 'pattern')), ...(where ? [{ text: ' in ' }, ...path('path')] : [])] }
    }
    case 'Glob':
      return { verb: 'Listed', target: quoted(str(input, 'pattern')) }
    case 'WebFetch':
      return { verb: 'Fetched', target: [{ text: str(input, 'url') ?? '', ...(t.link ? { color: t.link } : {}) }] }
    case 'WebSearch':
      return { verb: 'Searched the web for', target: quoted(str(input, 'query')) }
    case 'Agent':
    case 'Task':
      return { verb: 'Started agent', target: [{ text: str(input, 'description') ?? '' }] }
    case 'TodoWrite':
      return { verb: 'Updated', target: [{ text: 'the todo list' }] }
    default: {
      const first = input !== null && typeof input === 'object' ? Object.values(input as Record<string, unknown>).find(v => typeof v === 'string') : undefined
      const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' · ') : tool
      return { verb: name, target: typeof first === 'string' ? [{ text: firstLine(first), dim: true }] : [] }
    }
  }
}

export const dot = (style: Style, status: Status): Run => {
  const t = style.theme
  switch (status) {
    case 'running':
      return { text: '◌', ...(t.accent ? { color: t.accent } : {}) }
    case 'failed':
      return { text: '●', ...(t.diffRemoved ? { color: t.diffRemoved } : { bold: true }) }
    case 'interrupted':
      return { text: '○', dim: true }
    default:
      return { text: '●', ...(t.diffAdded ? { color: t.diffAdded } : {}) }
  }
}

/** One call as a single row: status dot, verb, target, a failure note. */
export const rowLine = (style: Style, status: Status, verb: string, target: Run[]): Line => {
  const t = style.theme
  const strongVerb = style.toolStyle === 'classic'
  const tail: Run[] =
    status === 'failed' ? [{ text: ' · failed', ...(t.codeFlag ? { color: t.codeFlag } : {}) }] : status === 'interrupted' ? [{ text: ' · interrupted', dim: true }] : []
  return [dot(style, status), { text: ' ' }, { text: verb, ...(strongVerb ? { bold: true } : {}) }, ...(target.length > 0 ? [{ text: ' ' }, ...target] : []), ...tail]
}

type Tally = { ran: number; read: number; searched: number; edited: number; fetched: number; other: number }

const CATEGORY: Record<string, keyof Tally> = {
  Bash: 'ran', Read: 'read', Grep: 'searched', Glob: 'searched', Edit: 'edited', MultiEdit: 'edited',
  Write: 'edited', NotebookEdit: 'edited', WebFetch: 'fetched', WebSearch: 'searched',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Ran 3 commands, read 2 files". */
export const groupSummary = (tools: readonly string[]): string => {
  const tally: Tally = { ran: 0, read: 0, searched: 0, edited: 0, fetched: 0, other: 0 }
  for (const tool of tools) tally[CATEGORY[tool] ?? 'other']++
  const parts = [
    tally.ran > 0 ? `ran ${plural(tally.ran, 'command', 'commands')}` : '',
    tally.read > 0 ? `read ${plural(tally.read, 'file', 'files')}` : '',
    tally.searched > 0 ? `searched ${plural(tally.searched, 'time', 'times')}` : '',
    tally.edited > 0 ? `edited ${plural(tally.edited, 'file', 'files')}` : '',
    tally.fetched > 0 ? `fetched ${plural(tally.fetched, 'page', 'pages')}` : '',
    tally.other > 0 ? `used ${plural(tally.other, 'tool', 'tools')}` : '',
  ].filter(Boolean)
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'fd', 'wc', 'pwd', 'echo', 'which', 'file', 'stat', 'tree',
  'du', 'df', 'jq', 'sort', 'uniq', 'env', 'printenv', 'date', 'whoami', 'uname', 'ps', 'type', 'less', 'more',
])
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'blame', 'rev-parse', 'ls-files'])

/** Whether a shell command only reads: no redirect, every segment a known reader. */
export const isReadOnlyCommand = (command: string): boolean => {
  if (/(^|[^2&])>/.test(command)) return false
  return command.split(/&&|\|\||;|\||\n/).every(segment => {
    const w = segment.trim().split(/\s+/)
    if (w[0] === undefined || w[0] === '') return true
    if (w[0] === 'git') return READ_ONLY_GIT.has(w[1] ?? '')
    return READ_ONLY.has(w[0])
  })
}
