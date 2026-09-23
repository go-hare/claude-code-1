/**
 * #21 pass6 — unique 248 agents/fleet ROW (not Swt parse).
 * Needles: hook+schema on row, PermissionRequest, PreToolUse, invalid, schema.
 * Compare 247. No invent.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-hook-row6.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-21-hook-row6',
  `when=${new Date().toISOString()}`,
  `sea248=${EXE_248} bytes=${b248.length}`,
  `sea247=${EXE_247} bytes=${b247.length}`,
  'contract=unique 248 agents/fleet ROW that names hook + schema',
  'rule=Swt parse is not a row. invent-ban. else stay UNKNOWN.',
  '',
]

function count(buf, n) {
  return allHits(buf, n).length
}

function dump(buf, label, needle, around = 160, cap = 8) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(buf, p - around, p + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(buf, label, i, maxLen = 8000) {
  const start = lastFnStartGeneric(buf, i, 12000)
  lines.push(`## ${label} near@${i} fn=${start.name} @${start.i}`)
  if (start.i < 0) {
    lines.push('NO_FN')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, start.i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    const same247 = allHits(b247, ext.body).length
    lines.push(`exact247=${same247}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
  return ext
}

function cmp(needle) {
  const a = count(b248, needle)
  const b = count(b247, needle)
  lines.push(`- ${JSON.stringify(needle)}  248=${a}  247=${b}${a > 0 && b === 0 ? '  UNIQUE248' : ''}`)
  return { a, b, unique: a > 0 && b === 0 }
}

lines.push('# count 248 vs 247')
const uniqueNeedles = [
  'schema error',
  'invalid answer',
  'hook schema',
  'names the hook',
  'hook and the schema',
  'hook output invalid',
  ' hook output invalid',
  'hook failed:',
  ' hook failed:',
  'PermissionRequest decision must be',
  'top-level decision is the legacy',
  'for PermissionRequest',
  'waiting silently',
  'invalid hook',
  'invalidAnswer',
  'hookAnswer',
  'hook_answer',
  'schemaError',
  'hookSchema',
  'hook_schema',
  'lastMessage:',
  'lastMessage=',
  'waitingFor:',
  'waitingFor=',
  'job.detail',
  'job.needs',
  'hookName+" hook',
  'hookName, " hook',
  '${e.hookName} hook',
  '${t.hookName} hook',
  '${r.hookName} hook',
  '${o.hookName} hook',
  '${d.hookName} hook',
  '${C.hookName} hook',
  '${A.hookName} hook',
  'hookName} hook:',
  'hookName} :',
  'hook + schema',
  'hook+schema',
  'Expected schema:`',
  'JSON validation failed: ${',
  'validationError}',
  'validationError:',
  'tMe({status',
  'updateSessionActivity',
  'UFe(',
  'function UFe',
  'function lq',
  'topDialogWaitingFor',
  'hook_non_blocking_error',
  'Open in a terminal',
  'heldInTerminal',
]
for (const n of uniqueNeedles) cmp(n)
lines.push('')

// unique-ish 248 needles from prior + new
const hunt = [
  'hook output invalid',
  ' hook failed:',
  'PermissionRequest decision must be',
  'for PermissionRequest',
  'JSON validation failed: ${',
  'tMe({status',
  'function UFe',
  'function lq',
  'topDialogWaitingFor',
  'lastMessage:',
  'waitingFor:',
]
for (const n of hunt) {
  const hits = dump(b248, `248 ${n}`, n, 200, 10)
  for (const p of hits.slice(0, 4)) {
    const win = asciiSlice(b248, p - 80, p + n.length + 80)
    if (win.includes('function ') || win.includes('=>') || win.includes('return')) {
      dumpFn(b248, `248-fn ${n}`, p)
    }
  }
}

lines.push('# 247 same needles')
for (const n of [
  'hook output invalid',
  ' hook failed:',
  'PermissionRequest decision must be',
  'for PermissionRequest',
  'JSON validation failed: ${',
  'topDialogWaitingFor',
  'function UFe',
]) {
  dump(b247, `247 ${n}`, n, 140, 4)
}

// fleet / agents row region: leftover AgentView ~201.4M is AttachmentMessage
// hunt functions containing both hook and waitingFor / lastMessage / detail
lines.push('# combo windows unique-ish')
function comboHits(buf, a, b, window = 400) {
  const ha = allHits(buf, a)
  const out = []
  for (const p of ha) {
    const win = asciiSlice(buf, p - window, p + a.length + window)
    if (win.includes(b)) out.push(p)
  }
  return out
}

const combos = [
  ['waitingFor', 'hook'],
  ['waitingFor', 'schema'],
  ['waitingFor', 'PermissionRequest'],
  ['waitingFor', 'PreToolUse'],
  ['waitingFor', 'validation'],
  ['lastMessage', 'hook'],
  ['lastMessage', 'schema'],
  ['lastMessage', 'PermissionRequest'],
  ['lastMessage', 'validationError'],
  ['detail', 'hookName'],
  ['needs', 'hookName'],
  ['needs', 'schema'],
  ['tMe(', 'hook'],
  ['tMe(', 'schema'],
  ['tMe(', 'validation'],
  ['updateSessionActivity', 'hook'],
  ['hookName', 'waitingFor'],
  ['hookName', 'lastMessage'],
  ['hookName', 'detail'],
  ['validationError', 'waitingFor'],
  ['validationError', 'lastMessage'],
  ['validationError', 'tMe'],
  ['Swt(', 'waitingFor'],
  ['Swt(', 'lastMessage'],
  ['Swt(', 'tMe'],
  ['Owt(', 'waitingFor'],
  ['Owt(', 'lastMessage'],
  ['_P(', 'waitingFor'],
  ['_P(', 'lastMessage'],
  ['hook error', 'waitingFor'],
  ['hook error', 'lastMessage'],
  ['Expected schema', 'waitingFor'],
  ['Expected schema', 'lastMessage'],
  ['Expected schema', 'tMe'],
]
for (const [a, b] of combos) {
  const h248 = comboHits(b248, a, b)
  const h247 = comboHits(b247, a, b)
  lines.push(
    `- combo ${JSON.stringify(a)}+${JSON.stringify(b)}  248=${h248.length}  247=${h247.length}${h248.length > 0 && h247.length === 0 ? '  UNIQUE248' : ''}`,
  )
  if (h248.length > 0 && h248.length <= 6) {
    for (const p of h248) {
      lines.push(`  248@${p} ${asciiSlice(b248, p - 120, p + 180)}`)
    }
  } else if (h248.length > h247.length && h248.length <= 12) {
    for (const p of h248.slice(0, 6)) {
      lines.push(`  248@${p} ${asciiSlice(b248, p - 120, p + 180)}`)
    }
  }
}
lines.push('')

// Extract leftover-ish row hosts: SessionRow / deriveBand / jobLabel near waitingFor
const rowNeedles = [
  'waitingFor??',
  'waitingFor ??',
  '.waitingFor??',
  '.waitingFor??session.lastMessage',
  'session.waitingFor',
  'd.waitingFor',
  'e.waitingFor',
  't.waitingFor',
  'heldInTerminal',
  'ctrl+x again to delete',
  '→ to return',
  '\\u2192 to return',
  'to return',
]
lines.push('# row-host needles')
for (const n of rowNeedles) {
  const a = count(b248, n)
  const b = count(b247, n)
  lines.push(`- ${JSON.stringify(n)}  248=${a}  247=${b}`)
  if (a > 0 && a <= 6) {
    for (const p of allHits(b248, n)) {
      lines.push(`  248@${p} ${asciiSlice(b248, p - 100, p + n.length + 140)}`)
    }
  }
}
lines.push('')

// Extract 248 functions around agents row detail
for (const n of [
  'ctrl+x again to delete',
  'to return',
  'heldInTerminal',
  'Open in a terminal',
]) {
  const hits = allHits(b248, n)
  for (const p of hits.slice(0, 2)) dumpFn(b248, `rowish ${n}`, p, 12000)
}

// 247 waitingFor setter equivalents
dump(b247, '247 UFe-shape sandbox request', 'if(e.workerSandboxPrompt)return"sandbox request"')
dump(b248, '248 UFe-shape sandbox request', 'if(d.workerSandboxPrompt)return"sandbox request"')

// lastMessage assignment from hook attachments / job.detail
dump(b248, '248 lastMessage: job', 'lastMessage: job')
dump(b248, '248 lastMessage:job', 'lastMessage:job')
dump(b248, '248 waitingFor: job', 'waitingFor: job')
dump(b248, '248 waitingFor:C', 'waitingFor:C')
dump(b248, '248 waitingFor: C', 'waitingFor: C')

// unique 248 template fragments
for (const n of [
  ' hook · ',
  ' hook — ',
  ' hook: ',
  '` hook `',
  'schema error',
  'invalid JSON output',
  'invalid hook output',
  'hook printed',
  'prints an invalid',
]) {
  cmp(n)
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
