/**
 * #21 pass5 — Swt callers; lastMessage from hook; AttachmentMessage 248 vs 247.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-hook-row5.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = ['# gold-248-21-hook-row5', `when=${new Date().toISOString()}`, '']

function dump(buf, label, needle, around = 180, cap = 8) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(`- #${i} @${p} ${asciiSlice(buf, p - around, p + needle.length + around)}`)
  }
  lines.push('')
  return hits
}

dump(b248, 'Swt(', 'Swt(')
dump(b248, 'validationError:Swt', 'validationError:Swt')
dump(b248, 'lastMessage=', 'lastMessage=')
dump(b248, 'lastMessage:', 'lastMessage:')
dump(b248, 'hookName," hook error"', 'hookName," hook error"')
dump(b247, '247 hookName hook error', 'hookName," hook error"')
dump(b247, '247 hook error children alt', '," hook error"]')
dump(b248, '248 ," hook error"]', '," hook error"]')

// _P call sites
dump(b248, '_P(', '_P(A.stderr')
dump(b247, '247 nW(', 'nW(')

// for PermissionRequest in expected schema
dump(b248, 'for PermissionRequest', 'for PermissionRequest')
dump(b247, '247 for PermissionRequest', 'for PermissionRequest')

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
