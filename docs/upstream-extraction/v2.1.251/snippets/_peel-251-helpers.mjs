/**
 * densable 2.1.251 SEA peel helpers.
 * EXE: official win32-x64 2.1.251, 217360032 bytes, --version 2.1.251.
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'

export const EXE_251 =
  'C:/Users/Administrator/AppData/Local/Temp/official-251/package/claude.exe'

export function loadSea(path = EXE_251) {
  return readFileSync(path)
}

export function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

export function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

export function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + Math.max(1, n.length)
  }
  return hits
}

export function extractFnAt(buf, i, maxLen = 12000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 280) }
}

export function lastFnStartGeneric(buf, before, maxLookback = 8000) {
  const start = Math.max(0, before - maxLookback)
  const win = asciiSlice(buf, start, before)
  let bestRel = -1
  let name = ''
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  let m
  while ((m = re.exec(win))) {
    bestRel = m.index
    name = m[1]
  }
  if (bestRel < 0) return { i: -1, name: '' }
  return { i: start + bestRel, name }
}
