// schemaTable: a column of fields beside a column of types. `types` colors the
// type cells by family, `keys` the constraint cells (PK, FK, unique, index).

import { filled, findColumn, gray, headerColumn, key, tone } from './common'
import type { Column, Paint, Part } from './common'
import type { SpecialOptions, Theme } from './types'

export type TypeFamily = 'text' | 'numeric' | 'boolean' | 'time' | 'other'

const FAMILIES: readonly [RegExp, TypeFamily][] = [
  [/^(?:varchar|nvarchar|varchar2|char|nchar|character|text|tinytext|mediumtext|longtext|string|str|uuid|guid|json|jsonb|citext|xml|enum|clob)$/, 'text'],
  [/^(?:int|integer|smallint|bigint|tinyint|mediumint|int2|int4|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|decimal|numeric|float|float4|float8|double|real|serial|bigserial|smallserial|number|money|long|short)$/, 'numeric'],
  [/^(?:bool|boolean|bit)$/, 'boolean'],
  [/^(?:timestamp|timestamptz|date|datetime|datetime2|smalldatetime|time|timetz|interval|year|instant|duration)$/, 'time'],
  [/^(?:bytea|blob|binary|varbinary|bytes|inet|cidr|macaddr|point|geometry|geography|array|map|hstore|tsvector|object|any|null|oid|rowid)$/, 'other'],
]

/** The family of a type cell such as `varchar(255)`, `BIGINT NOT NULL`, `int[]`, `timestamp with time zone`. */
export const typeFamily = (cell: string): TypeFamily | undefined => {
  const word = /^[a-z][a-z0-9_]*/i.exec(cell.trim())?.[0]?.toLowerCase()
  if (word === undefined) return undefined
  for (const [re, family] of FAMILIES) if (re.test(word)) return family
  return undefined
}

export type KeyKind = 'pk' | 'fk' | 'index'

/** A constraint cell: PK first, then FK, then unique / index. */
export const keyKind = (cell: string): KeyKind | undefined => {
  const text = cell.toLowerCase()
  if (/\bpk\b|primary(?: key)?\b|🔑/u.test(text)) return 'pk'
  if (/\bfk\b|foreign(?: key)?\b|references?\b|→|->/.test(text)) return 'fk'
  if (/\bunique\b|\buq\b|\buniq\b|\bindex(?:ed)?\b|\bidx\b/.test(text)) return 'index'
  return undefined
}

const TYPE_HINT = /type/
const FIELD_HINT = /field|column|name|attribute|property|key|^col$/
const KEY_HINT = /key|constraint|index|^pk|^fk|modifier|extra|attributes|flags/
const IDENTIFIER = /^[a-z_][\w.$]*(?:\s*\([^)]*\))?$/i

export const familyColor = (theme: Theme, f: TypeFamily): string | undefined =>
  f === 'text' ? theme.codeString : f === 'numeric' ? theme.number : f === 'boolean' ? theme.emphasis : f === 'time' ? theme.link : undefined

export const schemaTable = (mode: SpecialOptions['schemaTable'], theme: Theme, cols: readonly Column[]): Part | undefined => {
  if (mode === 'off') return undefined
  // Types: a type-ish header with most cells known types, or every cell one.
  const typeCol =
    cols.find(col => {
      if (!TYPE_HINT.test(col.header)) return false
      const cells = filled(col)
      return cells.length > 0 && cells.filter(c => typeFamily(c) !== undefined).length * 2 >= cells.length
    }) ?? findColumn(cols, c => typeFamily(c) !== undefined, /(?!)/, 2)
  if (typeCol === undefined) return undefined
  const fieldCol =
    headerColumn(cols, FIELD_HINT, new Set([typeCol.index])) ??
    findColumn(cols, c => IDENTIFIER.test(c), /(?!)/, 2, new Set([typeCol.index]))
  if (fieldCol === undefined) return undefined

  const cells = new Map<string, Paint>()
  if (mode === 'types' || mode === 'full') {
    typeCol.cells.forEach((cell, row) => {
      const f = typeFamily(cell)
      const color = f === undefined ? undefined : familyColor(theme, f)
      if (color !== undefined) cells.set(key(row, typeCol.index), tone(color))
    })
  }
  if (mode === 'keys' || mode === 'full') {
    const taken = new Set([typeCol.index, fieldCol.index])
    const keyCol = headerColumn(cols, KEY_HINT, taken) ?? findColumn(cols, c => keyKind(c) !== undefined, /(?!)/, 1, taken)
    keyCol?.cells.forEach((cell, row) => {
      const k = keyKind(cell)
      if (k === undefined) return
      const p: Paint = k === 'pk' ? tone(theme.accent, { bold: true }, { bold: true }) : k === 'fk' ? tone(theme.link, { bold: true }) : gray(theme)
      cells.set(key(row, keyCol.index), p)
    })
  }
  return { cells }
}
