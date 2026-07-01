import { describe, expect, test } from 'bun:test'
import {
  _resetBroadRuleCacheForTesting,
  isAutoModeFilteringActive,
  isBroadRule,
} from '../broadRuleFilter.js'

describe('isAutoModeFilteringActive', () => {
  test('true for mode=auto', () => {
    expect(isAutoModeFilteringActive('auto', false)).toBe(true)
    expect(isAutoModeFilteringActive('auto', true)).toBe(true)
    expect(isAutoModeFilteringActive('auto', undefined)).toBe(true)
  })

  test('true for mode=plan only when auto-mode is active', () => {
    expect(isAutoModeFilteringActive('plan', true)).toBe(true)
    expect(isAutoModeFilteringActive('plan', false)).toBe(false)
    expect(isAutoModeFilteringActive('plan', undefined)).toBe(false)
  })

  test('false for other modes', () => {
    expect(isAutoModeFilteringActive('default', true)).toBe(false)
    expect(isAutoModeFilteringActive('acceptEdits', true)).toBe(false)
    expect(isAutoModeFilteringActive('bypassPermissions', true)).toBe(false)
  })
})

describe('isBroadRule — Bash', () => {
  test('tool-level allow is broad', () => {
    expect(isBroadRule('Bash', undefined)).toBe(true)
    expect(isBroadRule('Bash', '')).toBe(true)
  })

  test('whitespace/asterisk-only content is broad', () => {
    expect(isBroadRule('Bash', '   ')).toBe(true)
    expect(isBroadRule('Bash', '*')).toBe(true)
    expect(isBroadRule('Bash', ' * * ')).toBe(true)
  })

  test('exact dangerous command is broad', () => {
    expect(isBroadRule('Bash', 'python')).toBe(true)
    expect(isBroadRule('Bash', 'node')).toBe(true)
    expect(isBroadRule('Bash', 'sudo')).toBe(true)
    expect(isBroadRule('Bash', 'ssh')).toBe(true)
  })

  test('prefix syntax :* is broad', () => {
    expect(isBroadRule('Bash', 'python:*')).toBe(true)
    expect(isBroadRule('Bash', 'npm run:*')).toBe(true)
  })

  test('trailing star is broad', () => {
    expect(isBroadRule('Bash', 'python*')).toBe(true)
    expect(isBroadRule('Bash', 'node*')).toBe(true)
  })

  test('space + star is broad', () => {
    expect(isBroadRule('Bash', 'python *')).toBe(true)
  })

  test('flag suffix star is broad', () => {
    expect(isBroadRule('Bash', 'python -*')).toBe(true)
    expect(isBroadRule('Bash', 'node -e *')).toBe(true)
  })

  test('python -m package.module is NOT broad when no trailing * (no wildcard)', () => {
    // `python -m http.server` (no trailing *) doesn't enter the
    // `startsWith(p) && endsWith('*')` branch → not broad.
    expect(isBroadRule('Bash', 'python -m http.server')).toBe(false)
  })

  test('python -m package.module:* IS broad when module has no dot', () => {
    // `python3 -m pip:*` → f=`-m pip:*`, starts with `-`, trailing `*`.
    // The official Python `-m package.module` exception requires a dot in
    // the module path; `-m pip:` has no dot, so the exception does NOT
    // fire and the rule is broad.
    expect(isBroadRule('Bash', 'python3 -m pip:*')).toBe(true)
  })

  test('python -m package.module.* is NOT broad (official exception)', () => {
    // `python -m http.server *` → f=`-m http.server *`. Trailing `*`,
    // starts with `-`. withoutTrailingStar=`-m http.server ` which
    // matches `/^-m\s+\w+\.[\w.]+(\s+)$/` → exception fires, NOT broad.
    expect(isBroadRule('Bash', 'python -m http.server *')).toBe(false)
    expect(isBroadRule('Bash', 'python -m http.server:*')).toBe(false)
  })

  test('non-broad specific command is NOT broad', () => {
    expect(isBroadRule('Bash', 'ls')).toBe(false)
    expect(isBroadRule('Bash', 'git status')).toBe(false)
    expect(isBroadRule('Bash', 'npm install')).toBe(false)
  })

  test('case-insensitive matching', () => {
    expect(isBroadRule('Bash', 'PYTHON')).toBe(true)
    expect(isBroadRule('Bash', 'Python:*')).toBe(true)
    expect(isBroadRule('Bash', 'NODE *')).toBe(true)
  })
})

describe('isBroadRule — Bash network/cloud commands', () => {
  // IMPORTANT: official `yw4 = [...dgq, ...[]]` does NOT include curl/wget/
  // kubectl/aws/gcloud/gsutil. The `Ew4.has(_)` branch inside `ov8` is
  // therefore effectively dead code (the intersection of `yw4` and `Ew4` is
  // empty). These tests document the actual official behavior: rules with
  // `kubectl`/`curl`/`wget` prefixes are NOT broad under the broad-rule
  // filter, because no `yw4` pattern matches them. They're still caught by
  // the auto-mode *stripping* layer (`dangerousPatterns.ts`), which is a
  // separate mechanism.

  test('kubectl rules are NOT broad (kubectl not in yw4)', () => {
    expect(isBroadRule('Bash', 'kubectl exec *')).toBe(false)
    expect(isBroadRule('Bash', 'kubectl apply *')).toBe(false)
    expect(isBroadRule('Bash', 'kubectl get *')).toBe(false)
    expect(isBroadRule('Bash', 'kubectl')).toBe(false)
    expect(isBroadRule('Bash', 'kubectl:*')).toBe(false)
  })

  test('curl/wget rules are NOT broad (not in yw4)', () => {
    expect(isBroadRule('Bash', 'curl')).toBe(false)
    expect(isBroadRule('Bash', 'curl:*')).toBe(false)
    expect(isBroadRule('Bash', 'wget https://example.com')).toBe(false)
  })

  test('shell metacharacters in suffix do NOT force broad (suffix never matched)', () => {
    // Since `kubectl` isn't in yw4, the `startsWith('kubectl ')` check
    // never enters the E_W_4 branch — shell metacharacters are irrelevant.
    expect(isBroadRule('Bash', 'kubectl exec $CMD*')).toBe(false)
    expect(isBroadRule('Bash', 'kubectl apply `cat f`*')).toBe(false)
  })
})

describe('isBroadRule — PowerShell', () => {
  test('tool-level allow is broad', () => {
    expect(isBroadRule('PowerShell', undefined)).toBe(true)
    expect(isBroadRule('PowerShell', '')).toBe(true)
  })

  test('asterisk-only is broad', () => {
    expect(isBroadRule('PowerShell', '*')).toBe(true)
    expect(isBroadRule('PowerShell', ' * ')).toBe(true)
  })

  test('PS interpreter patterns are broad', () => {
    expect(isBroadRule('PowerShell', 'python')).toBe(true)
    expect(isBroadRule('PowerShell', 'node:*')).toBe(true)
    expect(isBroadRule('PowerShell', 'iex')).toBe(true)
    expect(isBroadRule('PowerShell', 'invoke-expression')).toBe(true)
    expect(isBroadRule('PowerShell', 'invoke-command *')).toBe(true)
    expect(isBroadRule('PowerShell', 'add-type')).toBe(true)
    expect(isBroadRule('PowerShell', 'start-process -*')).toBe(true)
  })

  test('.exe variants are broad', () => {
    expect(isBroadRule('PowerShell', 'python.exe')).toBe(true)
    expect(isBroadRule('PowerShell', 'python.exe:*')).toBe(true)
    expect(isBroadRule('PowerShell', 'python.exe *')).toBe(true)
    expect(isBroadRule('PowerShell', 'npm.exe run:*')).toBe(true)
    expect(isBroadRule('PowerShell', 'npm.exe run -*')).toBe(true)
  })

  test('safe PS cmdlet is NOT broad', () => {
    expect(isBroadRule('PowerShell', 'Get-ChildItem')).toBe(false)
    expect(isBroadRule('PowerShell', 'Write-Host')).toBe(false)
  })

  test('case-insensitive', () => {
    expect(isBroadRule('PowerShell', 'PYTHON.EXE')).toBe(true)
    expect(isBroadRule('PowerShell', 'IEX')).toBe(true)
  })
})

describe('isBroadRule — Agent', () => {
  test('Agent tool-level allow is broad', () => {
    expect(isBroadRule('Agent', undefined)).toBe(true)
    expect(isBroadRule('Agent', '')).toBe(true)
    expect(isBroadRule('Agent', 'Explore')).toBe(true)
  })

  test('legacy Task name resolves to Agent and is broad', () => {
    expect(isBroadRule('Task', undefined)).toBe(true)
    expect(isBroadRule('Task', 'Explore')).toBe(true)
  })

  test('non-Agent tools are not broad via the Agent branch', () => {
    expect(isBroadRule('Read', undefined)).toBe(false)
    expect(isBroadRule('Write', '')).toBe(false)
  })
})

describe('isBroadRule — cache', () => {
  test('returns consistent results across calls', () => {
    _resetBroadRuleCacheForTesting()
    const first = isBroadRule('Bash', 'python:*')
    const second = isBroadRule('Bash', 'python:*')
    expect(first).toBe(second)
    expect(first).toBe(true)
  })

  test('distinguishes by ruleContent', () => {
    _resetBroadRuleCacheForTesting()
    expect(isBroadRule('Bash', 'python:*')).toBe(true)
    expect(isBroadRule('Bash', 'ls')).toBe(false)
  })

  test('distinguishes undefined vs empty string (same key)', () => {
    _resetBroadRuleCacheForTesting()
    // Both undefined and '' produce the same cache key (`toolName + \0 + ''`)
    // and both are broad for Bash — consistent with official NRH.
    expect(isBroadRule('Bash', undefined)).toBe(true)
    expect(isBroadRule('Bash', '')).toBe(true)
  })
})

describe('isBroadRule — non-shell tools', () => {
  test('Read/Write/Edit are never broad', () => {
    expect(isBroadRule('Read', undefined)).toBe(false)
    expect(isBroadRule('Write', '')).toBe(false)
    expect(isBroadRule('Edit', '*')).toBe(false)
  })

  test('MCP tools are not broad (only Bash/PowerShell/Agent are checked)', () => {
    expect(isBroadRule('mcp__workspace__bash', undefined)).toBe(false)
    expect(isBroadRule('mcp__workspace__web_fetch', '*')).toBe(false)
  })
})
