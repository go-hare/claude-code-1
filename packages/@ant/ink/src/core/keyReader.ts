/**
 * densable `Zy` / `Sd` / `Ed` / `Jy` — App stdin tokenizer bag.
 * Gold: official-289 SEA @193239763–193241120.
 */

import {
  INITIAL_STATE,
  isHeldIncompleteSequence,
  parkIncompleteMousePrefix,
  parseMultipleKeypresses,
  type KeyParseState,
  type ParsedInput,
} from './parse-keypress.js'

/** densable `Fl`. */
export const KEY_READER_NORMAL_MS = 50
/** densable `Qy`. */
export const KEY_READER_PASTE_MS = 2000
/** densable `bd`. */
export const KEY_READER_MOUSE_PREFIX_MS = 2000

export type KeyReader = {
  parse: KeyParseState
  lastInputAt: number
  byteRunDeadlineAt: number | null
  mousePrefixDropAt: number | null
  droppedPrefixDropAt: number | null
  /** Official 2.1.325 (#864) `heldReadLate` — ESC held across a late read. */
  heldReadLate: boolean
}

export type KeyReadResult = {
  keys: ParsedInput[]
  reader: KeyReader
  wakeAt: number | null
}

/** densable `Zy`. */
export function createKeyReader(now: number): KeyReader {
  return {
    parse: { ...INITIAL_STATE },
    lastInputAt: now,
    byteRunDeadlineAt: null,
    mousePrefixDropAt: null,
    droppedPrefixDropAt: null,
    heldReadLate: false,
  }
}

/** densable `Sd`. */
export function keyReaderHasPending(reader: KeyReader): boolean {
  const parse = reader.parse
  return (
    parse.incomplete !== '' ||
    parse.mode === 'IN_PASTE' ||
    parse.pendingByteEvents.length > 0
  )
}

/** densable `Ed` / 2.1.325 `Jc`. */
export function readKeys(
  reader: KeyReader,
  input: string | Buffer | null,
  now: number,
  readLate = false,
): KeyReadResult {
  let parse = reader.parse
  let droppedPrefixDropAt = reader.droppedPrefixDropAt
  if (
    droppedPrefixDropAt !== null &&
    now >= droppedPrefixDropAt &&
    (parse.droppedMousePrefix || parse.flushedEscapePrefix)
  ) {
    parse = { ...parse, droppedMousePrefix: '', flushedEscapePrefix: '' }
    droppedPrefixDropAt = null
  }
  const prev = parse
  const [rawKeys, next] = parseMultipleKeypresses(parse, input)
  const inPaste = next.mode === 'IN_PASTE'
  const inputReadLate = input !== null && readLate
  const firstLate =
    inputReadLate ||
    reader.heldReadLate ||
    (input !== null &&
      prev.incomplete === '\x1b' &&
      now - reader.lastInputAt >= KEY_READER_NORMAL_MS)
  const restLate = input === null ? reader.heldReadLate : inputReadLate
  const keys =
    firstLate || restLate
      ? rawKeys.map((k, idx) =>
          k.kind === 'key' && (idx === 0 ? firstLate : restLate)
            ? { ...k, readLate: true }
            : k,
        )
      : rawKeys
  let byteRunDeadlineAt = reader.byteRunDeadlineAt
  if (next.pendingByteEvents.length === 0) {
    byteRunDeadlineAt = null
  } else if (
    prev.pendingByteEvents !== next.pendingByteEvents ||
    byteRunDeadlineAt === null
  ) {
    byteRunDeadlineAt = now + KEY_READER_NORMAL_MS
  }
  let mousePrefixDropAt = reader.mousePrefixDropAt
  if (!inPaste && isHeldIncompleteSequence(next.incomplete)) {
    if (
      !(
        mousePrefixDropAt !== null &&
        keys.length === 0 &&
        isHeldIncompleteSequence(prev.incomplete) &&
        next.incomplete.startsWith(prev.incomplete)
      )
    ) {
      mousePrefixDropAt = now + KEY_READER_MOUSE_PREFIX_MS
    }
  } else {
    mousePrefixDropAt = null
  }
  if (next.droppedMousePrefix || next.flushedEscapePrefix) {
    if (!prev.droppedMousePrefix && !prev.flushedEscapePrefix) {
      droppedPrefixDropAt = now + KEY_READER_MOUSE_PREFIX_MS
    }
  } else {
    droppedPrefixDropAt = null
  }
  const incompleteOrPasteMs =
    next.incomplete || inPaste
      ? inPaste
        ? KEY_READER_PASTE_MS
        : mousePrefixDropAt !== null
          ? Math.max(0, mousePrefixDropAt - now)
          : KEY_READER_NORMAL_MS
      : null
  const byteRunMs =
    byteRunDeadlineAt === null || inPaste
      ? null
      : Math.max(0, byteRunDeadlineAt - now)
  const waitMs =
    incompleteOrPasteMs === null
      ? byteRunMs
      : byteRunMs === null
        ? incompleteOrPasteMs
        : Math.min(incompleteOrPasteMs, byteRunMs)
  return {
    keys,
    reader: {
      parse: next,
      lastInputAt: input === null ? reader.lastInputAt : now,
      byteRunDeadlineAt,
      mousePrefixDropAt,
      droppedPrefixDropAt,
      heldReadLate:
        next.incomplete !== '' && (rawKeys.length === 0 ? firstLate : restLate),
    },
    wakeAt: waitMs === null ? null : now + waitMs,
  }
}

/** densable `Jy`. */
export function flushKeys(reader: KeyReader, now: number): KeyReadResult {
  if (!keyReaderHasPending(reader)) {
    return { keys: [], reader, wakeAt: null }
  }
  let next = reader
  if (
    next.mousePrefixDropAt !== null &&
    now >= next.mousePrefixDropAt &&
    next.parse.mode !== 'IN_PASTE' &&
    isHeldIncompleteSequence(next.parse.incomplete)
  ) {
    next = {
      ...next,
      parse: parkIncompleteMousePrefix(next.parse),
      mousePrefixDropAt: null,
      droppedPrefixDropAt: now + KEY_READER_MOUSE_PREFIX_MS,
    }
  }
  if (next.parse.incomplete) {
    const budget =
      next.parse.mode === 'IN_PASTE'
        ? KEY_READER_PASTE_MS
        : KEY_READER_NORMAL_MS
    const remaining = budget - (now - next.lastInputAt)
    if (remaining > 0) {
      return { keys: [], reader: next, wakeAt: now + remaining }
    }
  }
  return readKeys(next, null, now)
}
