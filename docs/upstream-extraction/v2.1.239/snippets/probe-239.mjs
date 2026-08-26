#!/usr/bin/env node
// Count UTF-8 needles in official 2.1.239 SEA.
import { readFileSync } from 'node:fs'

const BIN =
  process.env.OFFICIAL_239_BIN ||
  String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`

const needles = [
  'US-only-inference',
  'us-only-inference',
  'usOnlyInference',
  'US_ONLY_INFERENCE',
  '1.1×',
  '1.1x',
  'data-residency',
  'dataResidency',
  'max-budget-usd',
  '/claude-api upgrade',
  'claude-api upgrade',
  'anthropic.Timeout',
  'httpx.Timeout',
  '@synced',
  'name@synced',
  'plugin enable/disable @synced',
  'posix_spawn ENOENT',
  'config.worktree',
  '.worktreeinclude',
  'pluginRoot',
  '35;150;7M',
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'voice.enabled',
  'keybindingFlavor',
  'Pasted text #',
  'dark-ansi',
  'claudeMdExcludes',
  'setMcpServers',
  'SessionStart',
  'ListAgents',
  'no agent named',
  'Remote Control isn',
  'directory that no longer exists',
  'no longer exists',
  'HTTPS_PROXY',
  'awsAuthRefresh',
  'Content-Type',
  'weekly limit',
  'session or weekly',
  'three launches',
  'UTF-8 BOM',
  '\uFEFF',
  'View usage',
  'crossSessionInbound',
  'SendMessage',
  'live teammates',
  'your own name',
  'idle worker restart',
  'plan mode',
  'JetBrains',
  '15 minutes',
  'WebFetch',
  'deleted directory',
  'removed worktree',
  'posix_spawn',
  'tab group',
  'Claude in Chrome',
  'Option+Backspace',
  'Ctrl+Backspace',
  'masked',
  'organization policy',
  'spend-limit',
  'out-of-credits',
  'middle to stay on one line',
  'truncate',
  'keep-alive',
  'keep-alives',
  '30 min',
  'every 2 h',
  'Alt+F',
  'readline',
]

const buf = readFileSync(BIN)
console.log(`bin=${BIN}`)
console.log(`size=${buf.length}`)
for (const kw of needles) {
  const needle = Buffer.from(kw, 'utf8')
  let from = 0
  let n = 0
  while (true) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    n++
    from = i + Math.max(1, needle.length)
    if (n >= 99) break
  }
  console.log(`${String(n).padStart(3)}  ${JSON.stringify(kw)}`)
}
