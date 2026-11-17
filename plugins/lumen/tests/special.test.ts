import { expect, test } from 'claude-code/testing'

import { inline } from '../hooks/inline'
import type { Run } from '../hooks/inline'
import { styleOf } from '../hooks/options'
import { decorateTable } from '../hooks/tables/special'
import type { SpecialOptions } from '../hooks/tables/types'

const style = styleOf({ theme: 'catppuccin-mocha' })
const t = style.theme

const OFF: SpecialOptions = {
  statusMatrix: 'off', testMatrix: 'off', benchTable: 'off', schemaTable: 'off', compareTable: 'off', apiTable: 'off', kvTable: 'off',
}
const ALL: SpecialOptions = {
  statusMatrix: 'group', testMatrix: 'report', benchTable: 'trend', schemaTable: 'full', compareTable: 'full', apiTable: 'full', kvTable: 'full',
}

const decorate = (options: Partial<SpecialOptions>, header: string[], rows: string[][]) =>
  decorateTable({ ...OFF, ...options }, t, header, rows)

/** The colors a decorated cell draws in (one per run, deduplicated). */
const colorOf = (options: Partial<SpecialOptions>, header: string[], rows: string[][], row: number, col: number) => {
  const d = decorate(options, header, rows)
  if (d === undefined) return 'none'
  const runs = d.cell(row, col, inline(style, rows[row]?.[col] ?? ''))
  return [...new Set(runs.map(r => r.color))].join(',')
}
const boldOf = (options: Partial<SpecialOptions>, header: string[], rows: string[][], row: number, col: number) => {
  const d = decorate(options, header, rows)
  return d !== undefined && d.cell(row, col, inline(style, rows[row]?.[col] ?? '')).every((r: Run) => r.bold === true)
}
const footerText = (options: Partial<SpecialOptions>, header: string[], rows: string[][]) =>
  (decorate(options, header, rows)?.footer ?? []).map(l => l.map(r => r.text).join(''))

const ORDINARY: [string[], string[][]][] = [
  [['Name', 'Role', 'City'], [['Ann', 'Dev', 'Oslo'], ['Bo', 'PM', 'Rome']]],
  [['Step', 'Notes'], [['1', 'Install the package'], ['2', 'Run it']]],
  [['Year', 'Revenue', 'Profit'], [['2023', '1.2', '0.3'], ['2024', '1.5', '0.4']]],
  [['Feature', 'Supported'], [['Dark mode', 'yes'], ['Export', 'no']]],
]

test('no kind triggers on ordinary tables, even with every kind on', () => {
  for (const [header, rows] of ORDINARY) expect(decorateTable(ALL, t, header, rows)).toBeUndefined()
})

test('every kind is off by default', () => {
  expect(decorate({}, ['Check', 'Status'], [['lint', '✓ passed'], ['e2e', 'failed']])).toBeUndefined()
})

// statusMatrix

const STATUS_H = ['Check', 'Status']
const STATUS_R = [['lint', '✓ passed'], ['types', '✗ failed'], ['e2e', 'pending'], ['unit', 'ok'], ['docs', '⚠ skipped']]

test('statusMatrix color: pass green, fail red, warn amber, wait gray', () => {
  const o = { statusMatrix: 'color' } as const
  expect(colorOf(o, STATUS_H, STATUS_R, 0, 1)).toBe(t.diffAdded)
  expect(colorOf(o, STATUS_H, STATUS_R, 1, 1)).toBe(t.diffRemoved)
  expect(colorOf(o, STATUS_H, STATUS_R, 2, 1)).toBe(t.codeComment)
  expect(colorOf(o, STATUS_H, STATUS_R, 3, 1)).toBe(t.diffAdded)
  expect(colorOf(o, STATUS_H, STATUS_R, 4, 1)).toBe(t.alertWarning)
  // The other column is left alone.
  expect(colorOf(o, STATUS_H, STATUS_R, 0, 0)).toBe('')
  expect(decorate(o, STATUS_H, STATUS_R)?.footer).toEqual([])
})

test('statusMatrix reads emoji and words, and needs a status column', () => {
  expect(colorOf({ statusMatrix: 'color' }, ['Job', 'CI'], [['build', '✅'], ['deploy', '❌ error']], 1, 1)).toBe(t.diffRemoved)
  expect(decorate({ statusMatrix: 'color' }, ['Job', 'Owner'], [['build', 'Ann'], ['deploy', 'Bo']])).toBeUndefined()
  // One cell that is no status keeps the column ordinary.
  expect(decorate({ statusMatrix: 'color' }, ['Job', 'Result'], [['a', 'passed'], ['b', 'see notes']])).toBeUndefined()
})

test('statusMatrix summary adds a count line in status colors', () => {
  const d = decorate({ statusMatrix: 'summary' }, STATUS_H, STATUS_R)
  expect(d?.footer.map(l => l.map(r => r.text).join(''))).toEqual(['✓ 2 · ✗ 1 · ⚠ 1 · ● 1'])
  const runs = d?.footer[0] ?? []
  expect(runs[0]?.color).toBe(t.diffAdded)
  expect(runs.find(r => r.text === '✗ 1')?.color).toBe(t.diffRemoved)
  expect(runs.find(r => r.text === '● 1')?.color).toBe(t.codeComment)
})

test('statusMatrix group orders fail, warn, wait, pass with rules between', () => {
  const d = decorate({ statusMatrix: 'group' }, STATUS_H, STATUS_R)
  expect(d?.order).toEqual([1, 4, 2, 0, 3])
  expect([...(d?.ruleAfter ?? [])].sort()).toEqual([0, 1, 2])
  expect(d?.footer).toHaveLength(1)
})

// testMatrix

const TEST_H = ['Test', 'Result', 'Time']
const TEST_R = [['auth', '✓', '120 ms'], ['db', '✓', '3.2 s'], ['api', '✗ failed', '1m 5s'], ['ui', 'skipped', '0 ms'], ['e2e', '✓', '450 ms'], ['cli', '✓', '80 ms']]

test('testMatrix report: share passed, other kinds, total time', () => {
  expect(footerText({ testMatrix: 'report' }, TEST_H, TEST_R)).toEqual(['✓ 67% passed · ✗ 1 failed · ⚠ 1 skipped · 1m 9s total'])
  const runs = decorate({ testMatrix: 'report' }, TEST_H, TEST_R)?.footer[0] ?? []
  expect(runs[0]?.color).toBe(t.diffAdded)
  expect(runs.find(r => r.text.includes('failed'))?.color).toBe(t.diffRemoved)
  expect(runs.find(r => r.text.includes('skipped'))?.color).toBe(t.alertWarning)
})

test('testMatrix report replaces the status count line', () => {
  expect(footerText({ statusMatrix: 'summary', testMatrix: 'report' }, TEST_H, TEST_R)).toEqual(['✓ 67% passed · ✗ 1 failed · ⚠ 1 skipped · 1m 9s total'])
  // Status cells still colored by statusMatrix.
  expect(colorOf({ statusMatrix: 'summary', testMatrix: 'report' }, TEST_H, TEST_R, 2, 1)).toBe(t.diffRemoved)
})

test('testMatrix needs a duration column', () => {
  expect(decorate({ testMatrix: 'report' }, STATUS_H, STATUS_R)).toBeUndefined()
  expect(footerText({ testMatrix: 'report' }, ['Suite', 'Status', 'Duration'], [['a', 'passed', '1.5 s'], ['b', 'passed', '500ms']])).toEqual(['✓ 100% passed · 2 s total'])
})

// benchTable

const BENCH_H = ['Benchmark', 'Before', 'After', 'Change']
const BENCH_R = [['parse', '12.0 ms', '10.8 ms', '-10%'], ['render', '40 ms', '41.2 ms', '+3%'], ['load', '1.2 s', '1.2 s', '0%']]

test('benchTable color: timings lower is better', () => {
  expect(colorOf({ benchTable: 'color' }, BENCH_H, BENCH_R, 0, 3)).toBe(t.diffAdded)
  expect(colorOf({ benchTable: 'color' }, BENCH_H, BENCH_R, 1, 3)).toBe(t.diffRemoved)
  expect(colorOf({ benchTable: 'color' }, BENCH_H, BENCH_R, 2, 3)).toBe(t.codeComment)
  expect(decorate({ benchTable: 'color' }, BENCH_H, BENCH_R)?.footer).toEqual([])
})

test('benchTable color: throughput and scores are higher is better', () => {
  const h = ['Endpoint', 'Base (req/s)', 'Head (req/s)', 'Δ']
  const r = [['/a', '1200', '1500', '+25%'], ['/b', '900', '850', '-5.6%']]
  expect(colorOf({ benchTable: 'color' }, h, r, 0, 3)).toBe(t.diffAdded)
  expect(colorOf({ benchTable: 'color' }, h, r, 1, 3)).toBe(t.diffRemoved)
  const s = [['x', '80', '90', '+12%']]
  expect(colorOf({ benchTable: 'color' }, ['Model', 'Old score', 'New score', 'Change'], s, 0, 3)).toBe(t.diffAdded)
})

test('benchTable trend draws a sparkline of the runs, steps colored by verdict', () => {
  const lines = decorate({ benchTable: 'trend' }, BENCH_H, BENCH_R)?.footer ?? []
  expect(lines).toHaveLength(2)
  const after = lines[1] ?? []
  expect(after.map(r => r.text).join('')).toMatch(/^after\s+[▁▂▃▄▅▆▇█]{3}$/u)
  expect(after.slice(1).map(r => r.color)).toEqual([t.diffAdded, t.diffRemoved, t.codeComment])
})

test('benchTable needs two run columns beside the changes', () => {
  expect(decorate({ benchTable: 'color' }, ['Metric', 'Change'], [['a', '-10%'], ['b', '+3%']])).toBeUndefined()
  expect(decorate({ benchTable: 'color' }, ['Lib', 'Coverage', 'Lines', 'Files'], [['a', '85%', '120', '3'], ['b', '90%', '300', '9']])).toBeUndefined()
})

// schemaTable

const SCHEMA_H = ['Column', 'Type', 'Key']
const SCHEMA_R = [['id', 'bigserial', 'PK'], ['email', 'varchar(255)', 'unique'], ['org_id', 'uuid', 'FK → orgs.id'], ['active', 'boolean', ''], ['created_at', 'timestamptz', 'index']]

test('schemaTable types: colored by family', () => {
  const o = { schemaTable: 'types' } as const
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 0, 1)).toBe(t.number)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 1, 1)).toBe(t.codeString)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 2, 1)).toBe(t.codeString)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 3, 1)).toBe(t.emphasis)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 4, 1)).toBe(t.link)
  // types alone leaves the keys
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 0, 2)).toBe('')
})

test('schemaTable keys: PK accent, FK link, unique and index gray; full does both', () => {
  const o = { schemaTable: 'keys' } as const
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 0, 2)).toBe(t.accent)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 2, 2)).toBe(t.link)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 1, 2)).toBe(t.codeComment)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 4, 2)).toBe(t.codeComment)
  expect(colorOf(o, SCHEMA_H, SCHEMA_R, 0, 1)).toBe('')
  expect(colorOf({ schemaTable: 'full' }, SCHEMA_H, SCHEMA_R, 0, 1)).toBe(t.number)
  expect(colorOf({ schemaTable: 'full' }, SCHEMA_H, SCHEMA_R, 0, 2)).toBe(t.accent)
})

test('schemaTable needs a types column', () => {
  expect(decorate({ schemaTable: 'full' }, ['Column', 'Meaning'], [['id', 'the row'], ['email', 'login']])).toBeUndefined()
  expect(decorate({ schemaTable: 'full' }, ['Type', 'Count'], [['Bug', '3'], ['Feature', '5']])).toBeUndefined()
})

// compareTable

const CMP_H = ['Option', 'Score', 'Rank']
const CMP_R = [['Postgres', '9.1', '1'], ['MySQL', '7.8', '2'], ['SQLite', '7.2', '3'], ['Mongo', '6.0', '4']]

test('compareTable rank: medals for 1, 2 and 3', () => {
  const o = { compareTable: 'rank' } as const
  expect(colorOf(o, CMP_H, CMP_R, 0, 2)).toBe(t.accent)
  expect(boldOf(o, CMP_H, CMP_R, 0, 2)).toBe(true)
  expect(colorOf(o, CMP_H, CMP_R, 1, 2)).toBe(t.link)
  expect(colorOf(o, CMP_H, CMP_R, 2, 2)).toBe(t.link)
  expect(colorOf(o, CMP_H, CMP_R, 3, 2)).toBe(t.number)
})

test('compareTable pick: the top score green and bold; ranks show which way wins', () => {
  const o = { compareTable: 'pick' } as const
  expect(colorOf(o, CMP_H, CMP_R, 0, 1)).toBe(t.diffAdded)
  expect(boldOf(o, CMP_H, CMP_R, 0, 1)).toBe(true)
  expect(colorOf(o, CMP_H, CMP_R, 1, 1)).toBe(t.number)
  // Lower wins (a latency score ranked ascending).
  const low = [['a', '30', '2'], ['b', '12', '1'], ['c', '50', '3']]
  expect(colorOf(o, CMP_H, low, 1, 1)).toBe(t.diffAdded)
  expect(colorOf({ compareTable: 'full' }, CMP_H, CMP_R, 0, 2)).toBe(t.accent)
})

test('compareTable needs a rank column and a score column', () => {
  expect(decorate({ compareTable: 'full' }, ['Option', 'Score'], [['a', '9'], ['b', '7']])).toBeUndefined()
  expect(decorate({ compareTable: 'full' }, ['Option', 'Rank'], [['a', '1'], ['b', '2']])).toBeUndefined()
})

// apiTable

const API_H = ['Method', 'Path', 'Auth']
const API_R = [['GET', '/users', 'Bearer'], ['POST', '/users', 'API key'], ['DELETE', '/users/:id', 'OAuth'], ['PURGE', '/cache', 'none'], ['`PATCH`', '/users/:id', 'JWT']]

test('apiTable verbs: reads link, writes string, delete red, others gray', () => {
  const o = { apiTable: 'verbs' } as const
  expect(colorOf(o, API_H, API_R, 0, 0)).toBe(t.link)
  expect(colorOf(o, API_H, API_R, 1, 0)).toBe(t.codeString)
  expect(colorOf(o, API_H, API_R, 2, 0)).toBe(t.diffRemoved)
  expect(colorOf(o, API_H, API_R, 3, 0)).toBe(t.codeComment)
  expect(colorOf(o, API_H, API_R, 4, 0)).toBe(t.codeString)
  expect(colorOf(o, API_H, API_R, 0, 2)).toBe('')
})

test('apiTable auth: schemes in accent; full does both', () => {
  const o = { apiTable: 'auth' } as const
  expect(colorOf(o, API_H, API_R, 0, 2)).toBe(t.accent)
  expect(colorOf(o, API_H, API_R, 1, 2)).toBe(t.accent)
  expect(colorOf(o, API_H, API_R, 4, 2)).toBe(t.accent)
  expect(colorOf(o, API_H, API_R, 3, 2)).toBe('')
  expect(colorOf(o, API_H, API_R, 0, 0)).toBe('')
  expect(colorOf({ apiTable: 'full' }, API_H, API_R, 0, 0)).toBe(t.link)
})

test('apiTable needs a method column; unlabeled verbs need a path column', () => {
  expect(decorate({ apiTable: 'full' }, ['Word', 'Meaning'], [['get', 'obtain'], ['put', 'place']])).toBeUndefined()
  expect(colorOf({ apiTable: 'verbs' }, ['', 'Route'], [['GET', '/a'], ['POST', '/b']], 1, 0)).toBe(t.codeString)
})

// kvTable

const KV_H = ['Option', 'Value', 'Default', 'Source']
const KV_R = [['port', '8080', '3000', 'env'], ['host', 'localhost', 'localhost', 'default'], ['debug', 'true', 'false', 'CLI flag'], ['theme', 'dark', 'dark', 'config file']]

test('kvTable sources: env link, config string, default gray', () => {
  const o = { kvTable: 'sources' } as const
  expect(colorOf(o, KV_H, KV_R, 0, 3)).toBe(t.link)
  expect(colorOf(o, KV_H, KV_R, 1, 3)).toBe(t.codeComment)
  expect(colorOf(o, KV_H, KV_R, 2, 3)).toBe(t.codeString)
  expect(colorOf(o, KV_H, KV_R, 3, 3)).toBe(t.codeString)
  expect(colorOf(o, KV_H, KV_R, 2, 1)).toBe('')
})

test('kvTable overrides: a value off its default in accent; full does both', () => {
  const o = { kvTable: 'overrides' } as const
  expect(colorOf(o, KV_H, KV_R, 0, 1)).toBe(t.accent)
  expect(colorOf(o, KV_H, KV_R, 2, 1)).toBe(t.accent)
  expect(colorOf(o, KV_H, KV_R, 1, 1)).toBe('')
  expect(colorOf(o, KV_H, KV_R, 0, 3)).toBe('')
  expect(colorOf({ kvTable: 'full' }, KV_H, KV_R, 0, 3)).toBe(t.link)
  expect(colorOf({ kvTable: 'full' }, KV_H, KV_R, 0, 1)).toBe(t.accent)
})

test('kvTable needs an option column with sources or values and defaults', () => {
  expect(decorate({ kvTable: 'full' }, ['Option', 'Meaning'], [['port', 'listen port']])).toBeUndefined()
  expect(decorate({ kvTable: 'overrides' }, ['Option', 'Source'], [['port', 'env']])).toBeUndefined()
})

// Composition

test('kinds compose: later kinds win on a cell, footers concatenate', () => {
  const h = ['Test', 'Status', 'Time', 'Before', 'After', 'Change']
  const r = [['a', 'passed', '1 s', '10 ms', '9 ms', '-10%'], ['b', 'failed', '2 s', '10 ms', '12 ms', '+20%']]
  const d = decorate({ statusMatrix: 'group', testMatrix: 'report', benchTable: 'trend' }, h, r)
  expect(d?.order).toEqual([1, 0])
  expect(d?.footer.map(l => l.map(x => x.text).join(''))[0]).toBe('✓ 50% passed · ✗ 1 failed · 3 s total')
  expect(d?.footer).toHaveLength(3)
  const runs = d?.cell(0, 5, inline(style, '-10%')) ?? []
  expect(runs.every(x => x.color === t.diffAdded)).toBe(true)
})

test('mono: no colors, status and medals marked by bold and dim', () => {
  const mono = styleOf({ theme: 'mono' }).theme
  const d = decorateTable({ ...OFF, statusMatrix: 'color', compareTable: 'rank' }, mono, ['Option', 'Status', 'Rank', 'Score'], [['a', 'failed', '1', '9'], ['b', 'pending', '2', '7']])
  const fail = d?.cell(0, 1, [{ text: 'failed' }]) ?? []
  expect(fail[0]?.bold).toBe(true)
  const wait = d?.cell(1, 1, [{ text: 'pending' }]) ?? []
  expect(wait[0]?.dim).toBe(true)
  expect(d?.cell(0, 2, [{ text: '1' }])[0]?.bold).toBe(true)
})
