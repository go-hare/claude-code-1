/**
 * Write unique leftover gold files from already-locked 248 offsets.
 * Extract fn only when unique. NEVER HAVE.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b = loadSea(EXE_248)

function goldFn(path, header, i, maxLen = 8000) {
  const ext = extractFnAt(b, i, maxLen)
  const lines = [header, `exe=${EXE_248}`, `start=${i}`, '']
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  writeFileSync(path, lines.join('\n'))
  return ext
}

function goldText(path, header, body) {
  writeFileSync(path, `${header}\nexe=${EXE_248}\n\n${body}\n`)
}

// #10 Ae / xe unique
goldFn(
  `${outDir}/gold-248-na-10-Ae.txt`,
  '# gold-248-na-10-Ae  desktopSessionCleanupPeriodDays cutoff (unique)',
  191903586,
  400,
)
goldFn(
  `${outDir}/gold-248-na-10-xe.txt`,
  '# gold-248-na-10-xe  policy/settings block cleanup (unique, after Ae)',
  191903716,
  400,
)
goldText(
  `${outDir}/gold-248-na-10-schema.txt`,
  '# gold-248-na-10-schema  settings describe (248-new, hits247=0)',
  asciiSlice(b, 179088656, 179088656 + 1100),
)

// #30 rr / or / ar / Ke
goldFn(`${outDir}/gold-248-na-30-rr.txt`, '# gold-248-na-30-rr  credential leaf (or+ar new)', 183209926, 400)
goldFn(`${outDir}/gold-248-na-30-or.txt`, '# gold-248-na-30-or  *.env (prod.env)', 183210134, 200)
goldFn(`${outDir}/gold-248-na-30-ar.txt`, '# gold-248-na-30-ar  *.tfvars', 183210234, 200)
goldText(
  `${outDir}/gold-248-na-30-Ke.txt`,
  '# gold-248-na-30-Ke  swap/tmp/backup suffix (id_rsa.swo via .sw[a-p]; key.pem.tmp via .tmp)',
  asciiSlice(b, 183206850, 183206850 + 220),
)

// #33 unique root-option refuse
goldFn(`${outDir}/gold-248-na-33-b.txt`, '# gold-248-na-33-b  suppliedRootOptions', 191865730, 800)
goldFn(`${outDir}/gold-248-na-33-C.txt`, '# gold-248-na-33-C  rootOptionsRemoteControlRefuses', 191866061, 200)
goldFn(`${outDir}/gold-248-na-33-w.txt`, '# gold-248-na-33-w  rootOptionsRefusedMessage', 191866145, 800)
goldFn(`${outDir}/gold-248-na-33-R.txt`, '# gold-248-na-33-R  enterRemoteControl', 191864989, 200)
goldText(
  `${outDir}/gold-248-na-33-f-map.txt`,
  '# gold-248-na-33-f-map  allowed root flags before remote-control',
  asciiSlice(b, 191865059, 191865059 + 900),
)
goldText(
  `${outDir}/gold-248-na-33-commander.txt`,
  '# gold-248-na-33-commander  allowUnknownOption + refuse then enterRemoteControl (247 MISS)',
  asciiSlice(b, 191608780, 191608780 + 520),
)

// #40 authoring — register/autoload unique; pXt body in SEA but do not invent locally
goldFn(`${outDir}/gold-248-na-40-gTt.txt`, '# gold-248-na-40-gTt', 204697507, 200)
goldFn(`${outDir}/gold-248-na-40-Fmr.txt`, '# gold-248-na-40-Fmr  register workflow-authoring', 204697553, 800)
goldFn(
  `${outDir}/gold-248-na-40-T.txt`,
  '# gold-248-na-40-T  getWorkflowAuthoringAutoloadMessages',
  204709919,
  2000,
)
{
  const pxt = b.indexOf(Buffer.from('pXt=`# Workflow authoring reference'))
  const win = asciiSlice(b, pxt, pxt + 20000)
  const end = win.indexOf('`;')
  const body = end > 0 ? win.slice(0, end + 2) : win.slice(0, 400)
  goldText(
    `${outDir}/gold-248-na-40-pXt-meta.txt`,
    '# gold-248-na-40-pXt-meta  skill body EXISTS in SEA — do not invent locally',
    `start=${pxt} len=${body.length} sha=${sha(body)}\nhead=${body.slice(0, 280)}\n…\ntail=${body.slice(-180)}`,
  )
}

// #41 PR badge 248 ≠ 247 Wut
goldFn(
  `${outDir}/gold-248-na-41-A$.txt`,
  '# gold-248-na-41-A$  TTL cache (prStatusByUrl=A$(_Jt,30000))',
  178817076,
  2000,
)
goldText(
  `${outDir}/gold-248-na-41-dXe.txt`,
  '# gold-248-na-41-dXe  pollerNotModifiedStreak + bump emit reset (247=0)',
  asciiSlice(b, 184546328, 184546328 + 700),
)
goldText(
  `${outDir}/gold-248-na-41-304.txt`,
  '# gold-248-na-41-304  REST list 304 empty-ok (PR unchanged)',
  asciiSlice(b, 184550050, 184550050 + 420),
)

// #43 unique precheck
goldFn(`${outDir}/gold-248-na-43-k.txt`, '# gold-248-na-43-k  map 401/404 → github_not_connected', 183083641, 800)
goldFn(`${outDir}/gold-248-na-43-TUn.txt`, '# gold-248-na-43-TUn  github_access_precheck_enabled', 184607964, 200)
goldFn(`${outDir}/gold-248-na-43-oae.txt`, '# gold-248-na-43-oae  checkGithubAppInstalled + linkedAccountAccess', 183081248, 4000)
goldText(
  `${outDir}/gold-248-na-43-probe.txt`,
  '# gold-248-na-43-probe  bxt slice — refuse before cloud (do not invent cloud host)',
  asciiSlice(b, 193377200, 193377200 + 1600),
)

// #46 always self-pace (GB keys gone)
goldText(
  `${outDir}/gold-248-na-46-register.txt`,
  '# gold-248-na-46-register  /loop always self-pace + autonomous default; tengu_kairos_loop_dynamic/prompt ABSENT (247=2)',
  asciiSlice(b, 204828600, 204828600 + 900),
)

// #47 Oht + QO
goldText(
  `${outDir}/gold-248-na-47-Oht.txt`,
  '# gold-248-na-47-Oht  [Anthropic telemetry] (247=0). 3P OTEL diag prefix still present.',
  asciiSlice(b, 180153365, 180153365 + 900),
)
goldFn(`${outDir}/gold-248-na-47-QO.txt`, '# gold-248-na-47-QO  wrap exporter; swallow fail; logSummary', 180153885, 800)

console.log('WROTE unique gold-248-na-* files')
