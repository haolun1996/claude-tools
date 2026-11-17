// Watches the files a shell command means to change: what it deletes (rm,
// unlink, rmdir, git rm), moves (mv, git mv), edits in place (sed -i, perl -i)
// or writes (> file, >> file, tee). Their content is read before the command
// runs and again after, so the change can be drawn as a card.

import type { EngineInterface } from 'claude-code'

import { diffTexts } from './diff'
import type { Hunk } from './diff'

export type ShellChange =
  | { kind: 'deleted'; path: string; content: string }
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'modified'; path: string; hunks: Hunk[] }
  | { kind: 'created'; path: string; content: string }

type Plan = { deletes: string[]; moves: { sources: string[]; dest: string }[]; writes: string[] }

const STRIP_QUOTES = /^(['"])(.*)\1$/
const UNKNOWABLE = /[*?$`{}]/
const MAX_BYTES = 512 * 1024

const words = (segment: string) => segment.trim().split(/\s+/).filter(Boolean).map(w => w.replace(STRIP_QUOTES, '$2'))

export const planOf = (command: string): Plan => {
  const plan: Plan = { deletes: [], moves: [], writes: [] }
  // Redirections write their target: `> f`, `>> f`, `1> f` (not `2>`, `&>`, `>&`).
  for (const m of command.matchAll(/(?:^|[\s;|&])1?>>?\s*([^\s;|&<>]+)/g)) {
    const target = (m[1] ?? '').replace(STRIP_QUOTES, '$2')
    if (target !== '' && !target.startsWith('&') && !target.startsWith('/dev/') && !UNKNOWABLE.test(target)) plan.writes.push(target)
  }
  for (const segment of command.split(/&&|\|\||;|\n|\|/)) {
    const w = words(segment.replace(/\d?>>?\s*\S+/g, ''))
    if (w[0] === 'sudo') w.shift()
    const verb = w[0] === 'git' ? `git ${w[1] ?? ''}` : (w[0] ?? '')
    const args = (verb.startsWith('git ') ? w.slice(2) : w.slice(1)).filter(a => !a.startsWith('-'))
    if (args.some(a => UNKNOWABLE.test(a))) continue
    if (verb === 'rm' || verb === 'unlink' || verb === 'rmdir' || verb === 'git rm') plan.deletes.push(...args)
    else if ((verb === 'mv' || verb === 'git mv') && args.length >= 2) {
      plan.moves.push({ sources: args.slice(0, -1), dest: args[args.length - 1] as string })
    } else if (verb === 'tee') plan.writes.push(...args)
    else if ((verb === 'sed' || verb === 'perl') && w.some(a => /^-[a-z]*i/.test(a))) {
      // The files are the arguments after the script: the last ones that exist are checked later.
      plan.writes.push(...args.slice(1))
    }
  }
  return plan
}

type Snapshot = { path: string; content: string | undefined }

const join = (cwd: string, path: string) => (path.startsWith('/') || cwd === '' ? path : `${cwd.replace(/\/$/, '')}/${path}`)

async function readSmall($: EngineInterface, path: string): Promise<string | undefined> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined || stat.kind !== 'file' || stat.size > MAX_BYTES) return undefined
  return $.fs.read(path).catch(() => undefined)
}

export type Watch = { finish: () => Promise<ShellChange[]> }

/** Reads what the command may change; `finish`, after it ran, says what did. */
export async function watch($: EngineInterface, cwd: string, command: string): Promise<Watch | undefined> {
  const plan = planOf(command)
  if (plan.deletes.length + plan.moves.length + plan.writes.length === 0) return undefined
  const abs = (p: string) => join(cwd, p)

  const deletes: Snapshot[] = await Promise.all(plan.deletes.map(async p => ({ path: abs(p), content: await readSmall($, abs(p)) })))
  const writes: Snapshot[] = await Promise.all([...new Set(plan.writes)].map(async p => ({ path: abs(p), content: await readSmall($, abs(p)) })))
  const moves = await Promise.all(
    plan.moves.flatMap(m =>
      m.sources.map(async src => ({
        from: abs(src),
        dest: abs(m.dest),
        inside: `${abs(m.dest).replace(/\/+$/, '')}/${src.replace(/\/+$/, '').split('/').pop() ?? src}`,
        existed: await $.fs.exists(abs(src)).catch(() => false),
      })),
    ),
  )

  return {
    finish: async () => {
      const out: ShellChange[] = []
      for (const d of deletes) {
        if (d.content !== undefined && !(await $.fs.exists(d.path).catch(() => true))) out.push({ kind: 'deleted', path: d.path, content: d.content })
      }
      for (const m of moves) {
        if (!m.existed || (await $.fs.exists(m.from).catch(() => true))) continue
        const to = (await $.fs.exists(m.inside).catch(() => false)) ? m.inside : m.dest
        out.push({ kind: 'renamed', from: m.from, to })
      }
      for (const w of writes) {
        const after = await readSmall($, w.path)
        if (after === undefined) continue
        if (w.content === undefined) out.push({ kind: 'created', path: w.path, content: after })
        else if (after !== w.content) out.push({ kind: 'modified', path: w.path, hunks: diffTexts(w.content, after) })
      }
      return out
    },
  }
}
