import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { EXE_248, asciiSlice, loadSea, sha } from './_peel-248-na-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '../../../..')
const buf = loadSea(EXE_248)

function scanQuoted(openPos) {
  let esc = false
  let i = openPos + 1
  while (i < buf.length) {
    const c = buf[i]
    if (esc) {
      esc = false
      i++
      continue
    }
    if (c === 92) {
      esc = true
      i++
      continue
    }
    if (c === buf[openPos]) return i
    i++
  }
  throw new Error('unclosed quote at ' + openPos)
}

function innerAt(assignStart) {
  const prefix = asciiSlice(buf, assignStart, assignStart + 8)
  const eq = prefix.indexOf('=')
  const open = assignStart + eq + 1
  const close = scanQuoted(open)
  return buf.subarray(open + 1, close).toString('utf8')
}

function evalTemplate(src, bindings) {
  const names = Object.keys(bindings)
  const values = names.map(k => bindings[k])
  return new Function(...names, 'return `' + src + '`')(...values)
}

function toTsTemplate(s) {
  return (
    '`' +
    s
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${') +
    '`'
  )
}

const PXT = 196766972
const goldSlice = asciiSlice(buf, PXT, PXT + 17303)
if (sha(goldSlice) !== '498a85cdc7e27a20') {
  throw new Error('gold assign sha mismatch: ' + sha(goldSlice))
}

const pXtSrc = innerAt(PXT)
const eSrc = innerAt(196763889)
const oSrc = innerAt(196784086)

if (sha(pXtSrc) !== '1af6404b4ee1ab88') {
  throw new Error('pXt inner sha mismatch: ' + sha(pXtSrc))
}

const n = ''
const s = ''
const r = ''
const a = "'worktree'"
const bwe = '\u25B8'
const Fy = 4096
const $w = 'workflow-authoring'
const ft = 'Agent'
const md = 'Workflow'

const pXt = evalTemplate(pXtSrc, { n, s, r, a, bwe, Fy })
const e = evalTemplate(eSrc, { ft })
const o = evalTemplate(oSrc, { $w })

const pXtEvalSha = sha(pXt)
const eSha = sha(e)
const oSha = sha(o)
const slim = `${e}\n\n${o}`
const slimSha = sha(slim)

console.log({
  goldAssignSha: sha(goldSlice),
  pXtInnerSha: sha(pXtSrc),
  pXtEvalSha,
  pXtEvalLen: pXt.length,
  eSha,
  eLen: e.length,
  oSha,
  oLen: o.length,
  slimSha,
  slimLen: slim.length,
  pXtHead: pXt.slice(0, 80),
  eHead: e.slice(0, 80),
  o,
})

const header = `/**
 * densable 2.1.248 #40 — extracted from official SEA pXt @196766972.
 * Gold assign (pXt=\`…\`;o=\`…\`; asciiSlice) sha16=498a85cdc7e27a20.
 * Inner template sha16=1af6404b4ee1ab88. Do not rewrite from changelog.
 */

`

const contentTs =
  header +
  `export const WORKFLOW_AUTHORING_SKILL_NAME = ${JSON.stringify($w)}\n` +
  `export const WORKFLOW_TOOL_NAME_FOR_AUTHORING = ${JSON.stringify(md)}\n` +
  `export const WORKFLOW_AUTHORING_PXT_START = ${PXT}\n` +
  `export const WORKFLOW_AUTHORING_PXT_GOLD_SHA16 = '498a85cdc7e27a20'\n` +
  `export const WORKFLOW_AUTHORING_PXT_INNER_SHA16 = '1af6404b4ee1ab88'\n` +
  `export const WORKFLOW_AUTHORING_PROMPT_SHA16 = ${JSON.stringify(pXtEvalSha)}\n` +
  `export const WORKFLOW_AUTHORING_SKILL_DESCRIPTION =\n` +
  `  ${JSON.stringify(`Reference for writing a ${md} tool script (script API and gotchas, resume, quality patterns, worked examples). Load before authoring a script for a workflow the user already opted into; it does not itself authorize running one.`)}\n` +
  `export const WORKFLOW_AUTHORING_MENU_DESCRIPTION =\n` +
  `  'Load the reference for writing Workflow tool scripts'\n` +
  `\n` +
  `/** Official gTt pXt — evaluated SEA template (n/s empty, a='worktree', bwe=▸, Fy=4096). */\n` +
  `export const WORKFLOW_AUTHORING_PROMPT: string = ${toTsTemplate(pXt)}\n`

writeFileSync(
  join(root, 'src/skills/bundled/workflowAuthoringContent.ts'),
  contentTs,
)

const playbook =
  `/**
 * densable 2.1.248 #40 — remaining Workflow tool description (SEA \`e\` @196763889
 * + skill pointer \`o\`). Script API / resume / quality patterns live on the
 * workflow-authoring skill (pXt), not here.
 */

export const WORKFLOW_AUTHORING_SKILL_POINTER: string = ${toTsTemplate(o)}

export const WORKFLOW_TOOL_PROMPT: string = ${toTsTemplate(slim)}
`

writeFileSync(
  join(root, 'packages/workflow-engine/src/tool/playbook.ts'),
  playbook,
)

writeFileSync(
  join(__dir, 'gold-248-40-eval-meta.txt'),
  [
    `pXtEvalSha=${pXtEvalSha} len=${pXt.length}`,
    `eSha=${eSha} len=${e.length}`,
    `oSha=${oSha} len=${o.length}`,
    `slimSha=${slimSha} len=${slim.length}`,
    '',
  ].join('\n'),
)
