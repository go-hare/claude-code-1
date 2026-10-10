/**
 * Peel keep-list needles from densable 2.1.289 SEA into /tmp/gold289-extract.
 * Usage: bun docs/upstream-extraction/v2.1.289/snippets/peel-keep-list.mjs [key...]
 */
import { writeFileSync, mkdirSync } from 'fs'
import {
  EXE_289,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
  sha,
} from './_peel-289-helpers.mjs'

const NEEDLES = {
  sonnet55: 'claude-sonnet-5-5',
  sonnet55_label: 'Sonnet 5.5',
  reconnect_all: '/mcp reconnect all',
  purge: 'claude purge',
  project_purge: 'project purge',
  max_findings: '--max-findings',
  toggle_ultracode: 'effortSlider:toggleUltracode',
  outside_one_off: 'Yes, but ask again next time',
  ui_selection: '$.ui.selection',
  bare_elicitation: 'bareElicitationCapability',
  disable_web_fetch: 'CLAUDE_CODE_DISABLE_WEB_FETCH',
  agent_list: 'agent.list',
  you_should_know: 'You should know',
  draft_recover: 'brings the draft back',
  dangerous_rm: 'bash -c',
}

const OUT = '/tmp/gold289-extract'
mkdirSync(OUT, { recursive: true })
const buf = loadSea(EXE_289)
const keys = process.argv.slice(2)
const selected = keys.length
  ? Object.fromEntries(
      Object.entries(NEEDLES).filter(([k]) => keys.includes(k)),
    )
  : NEEDLES

const summary = []
for (const [key, needle] of Object.entries(selected)) {
  const hits = allHits(buf, needle)
  if (!hits.length) {
    summary.push({ key, needle, status: 'MISS_NEEDLE' })
    continue
  }
  const hit = hits[0]
  const { i, name } = lastFnStartGeneric(buf, hit, 20000)
  let bodyInfo = i >= 0 ? extractFnAt(buf, i, 40000) : { miss: true }
  const ctx = asciiSlice(buf, hit - 400, hit + 1200)
  const base = `${key}@${hit}`
  writeFileSync(`${OUT}/${base}.ctx.txt`, ctx)
  if (bodyInfo.body) {
    writeFileSync(`${OUT}/${base}.${name || 'fn'}.js`, bodyInfo.body)
    summary.push({
      key,
      needle,
      status: 'BODY',
      hit,
      fn: name,
      fnAt: i,
      sha: bodyInfo.sha,
      len: bodyInfo.len,
      file: `${base}.${name || 'fn'}.js`,
    })
  } else {
    writeFileSync(
      `${OUT}/${base}.window.txt`,
      asciiSlice(buf, Math.max(0, hit - 2000), hit + 6000),
    )
    summary.push({
      key,
      needle,
      status: 'CTX_ONLY',
      hit,
      fn: name,
      fnAt: i,
      preview: bodyInfo.preview?.slice(0, 160),
      file: `${base}.ctx.txt`,
    })
  }
}

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
console.log('wrote', OUT, 'from', EXE_289, 'sha16', sha(buf).slice(0, 16))
