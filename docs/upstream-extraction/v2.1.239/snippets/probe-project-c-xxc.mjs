/**
 * densable 2.1.239 SEA — Project C Phase-2: xxc host + Ink.frameSink peel.
 * SEA: %TEMP%\official-239-pkg\package\claude.exe
 *
 * Writes:
 *   gold-project-c-xxc-host.txt
 *   gold-project-c-frameSink-ink.txt
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const exe = `${process.env.TEMP}\\official-239-pkg\\package\\claude.exe`
const buf = readFileSync(exe)

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')
}

function hits(needle, max = 12) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + 1
  }
  return out
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString('latin1'),
  )
}

function extractBetween(startNeedle, endNeedle, maxLen = 15000) {
  const hs = hits(startNeedle, 2)
  if (hs.length === 0) return { offset: -1, body: '(not found)' }
  const start = hs[0]
  const region = buf.subarray(start, Math.min(buf.length, start + maxLen)).toString('latin1')
  let end = region.indexOf(endNeedle)
  if (end < 0) end = Math.min(region.length, maxLen)
  return { offset: start, body: ascii(region.slice(0, end)) }
}

// ─── 1. xxc host ───────────────────────────────────────────────
{
  const startNeedle = 'function xxc({scrollable:'
  const { offset, body } = extractBetween(startNeedle, 'function X$0(', 12000)
  const preamble = offset >= 0 ? around(offset, 900, 0) : ''
  const x0 = extractBetween('function X$0(e,t){', 'function J$0(', 800)
  const j0 = extractBetween('function J$0(e,t,r,n,o){', 'function wTg(', 2500)
  // wTg may not exist — try alternate ends
  let j0body = j0.body
  if (j0.offset >= 0 && j0body.includes('(not found)')) {
    /* noop */
  }
  // if wTg missing, cut at next function after ~2k
  if (j0.offset >= 0) {
    const region = buf
      .subarray(j0.offset, Math.min(buf.length, j0.offset + 4000))
      .toString('latin1')
    // find second "function " after start
    const second = region.indexOf('function ', 20)
    j0body = ascii(region.slice(0, second > 0 ? second : 2500))
  }

  let out = '# densable 2.1.239 — Project C Phase-2: xxc React host\n'
  out += `# SEA: ${exe}\n`
  out += `# extracted: ${new Date().toISOString()}\n`
  out += `# xxc @ ${offset}\n`
  out += '# Surrounding: kxc (scroll-anchor) + Cxc module factory above; X$0/J$0 helpers below\n\n'
  out += '#### preamble (~900 before function xxc)\n```js\n' + preamble + '\n```\n\n'
  out += `#### function xxc (full, through X$0) @ ${offset}\n\`\`\`js\n${body}\n\`\`\`\n\n`
  out += `#### function X$0 @ ${x0.offset}\n\`\`\`js\n${x0.body}\n\`\`\`\n\n`
  out += `#### function J$0 (gap/backfill serializer head) @ ${j0.offset}\n\`\`\`js\n${j0body}\n\`\`\`\n`
  writeFileSync(join(here, 'gold-project-c-xxc-host.txt'), out)
  console.log('xxc', offset, 'bodyLen', body.length)
}

// ─── 2. Ink frameSink call sites ───────────────────────────────
{
  let out = '# densable 2.1.239 — Project C Phase-2: Ink.frameSink wiring\n'
  out += `# SEA: ${exe}\n`
  out += `# extracted: ${new Date().toISOString()}\n\n`

  const needles = [
    'this.frameSink(',
    '.frameSink(',
    'frameSink&&',
    'frameSink?.',
    'frameSink!==null',
    'frameSink!=null',
    'frameSink=null',
    '?"tick"',
    '==="tick"',
    '=="tick"',
    'return"tick"',
    ',"tick"',
    '==="tick"||',
    '==="tick"?',
    'e==="tick"',
    't==="tick"',
    'r==="tick"',
    'n==="tick"',
    'o==="tick"',
    'i==="tick"',
    's==="tick"',
    'a==="tick"',
    '=== "tick"',
  ]

  out += '#### needle survey\n'
  for (const n of needles) {
    const hs = hits(n, 8)
    out += `- ${JSON.stringify(n)} count=${hs.length} offsets=${hs.slice(0, 4).join(',')}\n`
  }
  out += '\n'

  // Broader search: any frameSink usage near scheduleRender / onRender / draw
  const fsHits = hits('frameSink', 20)
  out += `#### all "frameSink" hits (${fsHits.length})\n`
  for (const h of fsHits) {
    out += `\n--- ${h} ---\n${around(h, 250, 700)}\n`
  }

  // tick return handling in Ink paint path — look for Qvt-ish drain
  const tickCmp = hits('==="tick"', 10).concat(hits('=="tick"', 10))
  out += `\n#### tick equality comparisons (${tickCmp.length})\n`
  for (const h of [...new Set(tickCmp)].slice(0, 8)) {
    out += `\n--- ${h} ---\n${around(h, 350, 500)}\n`
  }

  // scheduleRender / drainTimer patterns near frameSink
  for (const n of [
    'drainTimer',
    'FRAME_INTERVAL',
    'requestAnimationFrame',
    'scheduleRender',
    'isAltScreenActive',
    'recordContentWrite',
    'getStylePool',
    'Yp.get(process.stdout)',
    'Yp.set(',
  ]) {
    const hs = hits(n, 6)
    out += `\n#### "${n}" count=${hs.length}\n`
    for (const h of hs.slice(0, 3)) {
      out += `--- ${h} ---\n${around(h, 120, 400)}\n`
    }
  }

  writeFileSync(join(here, 'gold-project-c-frameSink-ink.txt'), out)
  console.log('frameSink hits', fsHits.length, 'tickCmps', tickCmp.length)
}
