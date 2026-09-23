/**
 * densable 2.1.251 SEA peel scan — #14 #17 #21 #22 #45 #46 #47 #48 #70 #71
 * Confirm STRING-ONLY / MISS / N/A. Invent-ban. No HAVE.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_251,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const EXPECT_BYTES = 217360032
const buf = loadSea()
if (buf.length !== EXPECT_BYTES) {
  throw new Error(`SEA bytes ${buf.length} != ${EXPECT_BYTES}`)
}

const groups = {
  14: [
    ['not reachable', true],
    ['SendMessage', true],
    ['Claude Desktop', true],
    ['delivered from another session', true],
    ['through Claude Desktop', true],
    ['delivers through', false],
    ['via Desktop', false],
    ['desktopHandoff', false],
    ['handoffToDesktop', false],
    ['from another session', false],
    ['session id now delivers', false],
    ['Desktop instead', false],
    ['not reachable → Desktop', false],
    ['deliverThroughDesktop', false],
    ['desktop_session', false],
    ['claude-desktop', false],
    ['CLAUDE_DESKTOP', false],
  ],
  17: [
    ['from was the agent type', true],
    ['is not an address', true],
    ['unnamed sibling', true],
    ['unnamed parent', false],
    ['from=`', false],
    ['from= address', false],
    ['agent type, which is not', false],
  ],
  21: [
    ['model had changed', true],
    ['the model had changed', true],
    ['initial model', true],
    ["session's initial model", true],
    ['host was only setting', true],
    ['modelChanged', false],
    ['model_changed', false],
    ['initialModel', false],
    ['setInitialModel', false],
    ['model has changed', false],
    ['telling Claude the model', false],
    ['host-only initial', false],
    ['initial_model', false],
  ],
  22: [
    ['policy disables', true],
    ['Remote Control', true],
    ['quiet notice', true],
    ["organization's policy", false],
    ['disableRemoteControl', false],
    ['Remote Control is disabled', false],
    ['Remote Control failed', false],
    ['kind:"error"', false],
  ],
  45: [
    ['GitHub setup', true],
    ['github setup', true],
    ['transient GitHub', true],
    ['github_preflight', true],
    ['advising GitHub', false],
    ['retry instead', false],
    ['GitHub connection failure', false],
    ['github connection', false],
    ['set up GitHub', false],
    ['connect your GitHub', false],
    ['github_app', false],
    ['transient GitHub connection', false],
    ['says to retry', false],
    ['github_preflight_', false],
  ],
  46: [
    ['redundant UI', true],
    ['re-render', true],
    ['re-renders', true],
    ['redundant render', true],
    ['cutting redundant', false],
    ['skipRedundant', false],
    ['cut redundant', false],
    ['UI re-render', false],
  ],
  47: [
    ['5 MB smaller', true],
    ['5MB smaller', true],
    ['about 5 MB', true],
    ['install size', true],
    ['native binary is about', false],
    ['5 MB smaller', false],
    ['binary is about 5', false],
  ],
  48: [
    ['connection reset', true],
    ['network proxy', true],
    ['proxy drops', true],
    ['names the host', true],
    ['proxy drop', false],
    ['proxy dropped', false],
    ['host and reason', false],
    ['ECONNRESET', false],
    ['only "connection reset"', false],
    ['session\'s network proxy', false],
  ],
  70: [
    ['Bedrock, Foundry, or Vertex', true],
    ['third-party provider setup', true],
    ['Foundry, or Vertex', true],
    ['Bedrock, Foundry', false],
    ['third-party provider', false],
    ['provider setup section', false],
    ['sign-in screen', false],
    ['#third-party', false],
    ['third_party_providers', false],
  ],
  71: [
    ['footer pill', true],
    ['Remote Control banner', true],
    ['claude.ai/code', true],
    ['/remote-control', false],
    ['footerPill', false],
    ['rc banner', false],
    ['RC banner', false],
    ['remote-control pill', false],
  ],
}

function jsScore(win) {
  let s = 0
  if (/function [A-Za-z_$]/.test(win)) s += 40
  if (/=>\{/.test(win) || /=>/.test(win)) s += 10
  if (/if\(/.test(win)) s += 15
  if (/return/.test(win)) s += 10
  if (/const |let |var /.test(win)) s += 10
  if (/"use strict"/.test(win)) s += 5
  if (win.includes('changelog') || win.includes('Fixed ') || win.includes('Improved '))
    s -= 30
  return s
}

function classifyHit(off) {
  if (off < 80_000_000) return 'bin-low'
  if (off < 170_000_000) return 'mid'
  return 'js'
}

const report = []
for (const [id, needles] of Object.entries(groups)) {
  const block = { id: Number(id), needles: [] }
  console.log(`\n======== #${id} ========`)
  for (const [needle, primary] of needles) {
    const hits = allHits(buf, needle)
    const row = {
      needle,
      primary,
      hits: hits.length,
      offs: hits.slice(0, 16),
      more: Math.max(0, hits.length - 16),
      samples: [],
    }
    console.log(
      `  ${primary ? '*' : ' '}${JSON.stringify(needle)} hits=${hits.length} first=${hits.slice(0, 8).join(',') || '-'}`,
    )
    if (hits.length === 0) {
      block.needles.push(row)
      continue
    }
    const jsHits = hits.filter((h) => h >= 170_000_000)
    const pick = (jsHits.length ? jsHits : hits).slice(0, 10)
    for (const h of pick) {
      const win = asciiSlice(buf, h - 120, h + 220)
      const fn = lastFnStartGeneric(buf, h, 12000)
      let extract = null
      if (fn.i >= 0) {
        const ex = extractFnAt(buf, fn.i, 20000)
        if (ex.body) {
          extract = {
            name: fn.name,
            i: fn.i,
            len: ex.len,
            sha: ex.sha,
            hasNeedle: ex.body.includes(needle),
            preview: ex.body.slice(0, 280),
          }
        }
      }
      row.samples.push({
        off: h,
        zone: classifyHit(h),
        score: jsScore(win),
        win: win.slice(0, 320),
        fn,
        extract,
      })
    }
    const best = [...row.samples].sort((a, b) => b.score - a.score)[0]
    if (best) {
      console.log(
        `    best@${best.off} zone=${best.zone} jsScore=${best.score} fn=${best.fn.name}@${best.fn.i}`,
      )
      if (best.extract) {
        console.log(
          `    extract ${best.extract.name} len=${best.extract.len} sha=${best.extract.sha} hasNeedle=${best.extract.hasNeedle}`,
        )
        console.log(`    preview: ${best.extract.preview.replace(/\n/g, ' ')}`)
      }
      console.log(`    win: ${best.win.replace(/\n/g, ' ').slice(0, 240)}`)
    }
    block.needles.push(row)
  }
  report.push(block)
}

const out = join(__dir, '_peel-251-h-scan.json')
writeFileSync(
  out,
  JSON.stringify(
    {
      when: new Date().toISOString(),
      exe: EXE_251,
      bytes: buf.length,
      report,
    },
    null,
    2,
  ),
)
console.log(`\nwrote ${out}`)
