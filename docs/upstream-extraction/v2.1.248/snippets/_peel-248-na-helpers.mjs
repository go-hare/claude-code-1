/**
 * Reused 247 peel helpers from
 * docs/upstream-extraction/v2.1.247/snippets/_peel-1-ye-Ht-Jt-DE.mjs
 * (asciiSlice / sha / allHits / extractFnAt / lastFnStart).
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'

export const EXE_248 =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
export const EXE_247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'

export function loadSea(path) {
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
    i = k + n.length
  }
  return hits
}

export function extractFnAt(buf, i, maxLen = 8000) {
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

export function lastFnStart(buf, before, names) {
  let best = -1
  let name = ''
  for (const n of names) {
    const needle = Buffer.from(n)
    let i = 0
    while (i < before) {
      const k = buf.indexOf(needle, i)
      if (k < 0 || k >= before) break
      if (k > best) {
        best = k
        name = n
      }
      i = k + needle.length
    }
  }
  return { i: best, name }
}

export function lastFnStartGeneric(buf, before, maxLookback = 6000) {
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

export function looksJs(win) {
  return (
    win.includes('function ') ||
    win.includes('=>') ||
    win.includes('const ') ||
    win.includes('return ') ||
    win.includes('export{')
  )
}
