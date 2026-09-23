/**
 * densable 2.1.248 #21 — extract unique agents-row hook+schema name.
 * Gold wins. No invent from changelog.
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

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)

const lines = [
  '# gold-248-21-hook-row',
  `when=${new Date().toISOString()}`,
  `sea248=${EXE_248} bytes=${b248.length}`,
  `sea247=${EXE_247} bytes=${b247.length}`,
  'contract=extract unique fleet/agents-row that names hook + schema on invalid PermissionRequest/PreToolUse answer',
  'rule=if no unique row body: stay UNKNOWN. do not invent.',
  '',
]

function dumpHits(buf, label, needle, around = 140, cap = 12) {
  const hits = allHits(buf, needle)
  lines.push(
    `## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFnNear(buf, label, i, maxLen = 6000) {
  const start = lastFnStartGeneric(buf, i, 8000)
  lines.push(`## ${label} near@${i} fn=${start.name} @${start.i}`)
  if (start.i < 0) {
    lines.push('NO_FN')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, start.i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

function only248(needle) {
  const a = allHits(b248, needle).length
  const b = allHits(b247, needle).length
  return { a, b, new248: a > 0 && b === 0 }
}

const needles = [
  'schema error',
  'invalid answer',
  'hook schema',
  'hook and the schema',
  'names the hook',
  'JSON validation failed',
  'Hook JSON output validation failed',
  'Expected schema:',
  'failed schema validation',
  'async hook JSON output failed schema validation',
  'hook returned blocking error',
  ' hook error:',
  'hook error: ',
  'PermissionRequest hook',
  'PreToolUse hook',
  'updatedInput that failed schema validation',
  'waiting silently',
  'invalid hook answer',
  'hookName+" hook',
  'hookName, " hook',
  '.hookName," hook',
  'hookName," hook error',
  'hook_non_blocking_error',
  'hook_error_during_execution',
  'JSON validation failed: ',
  'schema validation: ',
  'waitingFor:',
  'lastMessage:',
]

lines.push('# 247 vs 248 needle counts')
for (const n of needles) {
  const { a, b, new248 } = only248(n)
  lines.push(
    `- ${JSON.stringify(n)}  248=${a}  247=${b}${new248 ? '  **NEW248**' : ''}`,
  )
}
lines.push('')

// focused dumps on 248
dumpHits(b248, '#21 JSON validation failed', 'JSON validation failed')
dumpHits(
  b248,
  '#21 Hook JSON output validation failed',
  'Hook JSON output validation failed',
)
dumpHits(b248, '#21 Expected schema', 'Expected schema:')
dumpHits(
  b248,
  '#21 updatedInput failed schema',
  'updatedInput that failed schema validation',
)
dumpHits(
  b248,
  '#21 async hook JSON schema',
  'async hook JSON output failed schema validation',
)
dumpHits(b248, '#21 hook error colon', ' hook error:')
dumpHits(b248, '#21 hookName hook error', '.hookName," hook')
dumpHits(b248, '#21 hookName hook returned', 'hook returned blocking error')
dumpHits(b248, '#21 hook_non_blocking_error', 'hook_non_blocking_error')

// JS-looking template interpolations that name hook + error
const comboNeedles = [
  '${A.hookName} hook',
  '${e.hookName} hook',
  '${t.hookName} hook',
  'hookName} hook error',
  'hookName," hook error',
  'hookName," hook returned',
  'hookName} schema',
  'schema error:',
  'schemaError',
  'hookSchema',
  'hook_schema',
  'invalidAnswer',
  'invalid_answer',
  'hookAnswer',
  'hook_answer',
]
for (const n of comboNeedles) {
  dumpHits(b248, `#21 combo ${n}`, n, 160, 6)
}

// fleet-ish region ~191M-192.5M and UI ~201M
function dumpRegionNeedles(label, start, end, needles2) {
  lines.push(`## region ${label} [${start},${end})`)
  const slice = b248.subarray(start, end)
  for (const n of needles2) {
    const hits = allHits(slice, n).map(i => i + start)
    if (hits.length)
      lines.push(
        `- ${JSON.stringify(n)} hits=${hits.length} @${hits.slice(0, 6).join(',')}`,
      )
  }
  lines.push('')
}

const fleetNeedles = [
  'hook',
  'schema',
  'PermissionRequest',
  'PreToolUse',
  'waitingFor',
  'lastMessage',
  'hookName',
  'hook error',
  'validation',
]
dumpRegionNeedles('fleet~191.8-192.4M', 191800000, 192400000, fleetNeedles)
dumpRegionNeedles('ui~201.3-201.6M', 201300000, 201600000, [
  'hookName',
  'hook error',
  'schema',
  'validation',
  'PermissionRequest',
  'PreToolUse',
])

// extract covering fns for the most promising hits
const interesting = [
  ['json-val-failed', 'JSON validation failed: '],
  ['hook-json-val', 'Hook JSON output validation failed:'],
  ['updatedInput-schema', 'updatedInput that failed schema validation'],
  ['async-hook-schema', 'async hook JSON output failed schema validation'],
  ['hook-error-ui', ' hook returned blocking error'],
  ['hook-error-colon', ' hook error: '],
]
for (const [tag, n] of interesting) {
  const hits = allHits(b248, n)
  for (const [idx, i] of hits.slice(0, 4).entries()) {
    const win = asciiSlice(b248, i - 80, i + 200)
    const js = /function |=>|const |return |hookName/.test(win)
    lines.push(`## hit ${tag}#${idx} @${i} jsish=${js}`)
    lines.push(win)
    lines.push('')
    if (js) dumpFnNear(b248, `${tag}#${idx}`, i, 5000)
  }
}

// strings that look like row copy: short, human, hook+schema
const rowish = [
  'hook schema error',
  'hook schema:',
  'Hook schema',
  'schema failed',
  'failed the schema',
  'did not match the schema',
  'invalid hook output',
  'invalid hook JSON',
  'hook printed',
  'hook output error',
  'hook validation',
  'validation failed for hook',
]
for (const n of rowish) {
  const { a, b, new248 } = only248(n)
  if (a || b)
    lines.push(
      `- rowish ${JSON.stringify(n)} 248=${a} 247=${b}${new248 ? ' **NEW248**' : ''}`,
    )
  if (a) dumpHits(b248, `rowish ${n}`, n, 180, 4)
}

writeFileSync(`${outDir}/gold-248-21-hook-row.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-21-hook-row.txt`, 'lines', lines.length)
