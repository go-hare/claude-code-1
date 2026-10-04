/**
 * densable 2.1.283 `trustedNetworkDirectories` field + `Ier` rewrite + `g1`/`h1`.
 *
 * GOLD SEA `/tmp/official-283/package/claude`
 *   unique string @72811096 count 40
 *   `g1`/`h1` @190551319
 *   `Ier` @190949411
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { setFlagSettingsInline } from '../../../bootstrap/state.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../fsOperations.js'
import { reconcileAdditionalDirectories } from '../../settings/applySettingsChange.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import { screenClaimPath } from '../../../cli/claimNetworkPath.js'
import {
  mappedNetworkDriveAliases,
  resolvedNetworkPathReasonH1,
  rewriteFlagSettingsTrustedNetworkDirectories,
  screenNetworkPathG1,
} from '../trustedNetworkDirectories.js'

const GOLD = '/tmp/official-283/package/claude'

function goldHas(s: string): boolean {
  return readFileSync(GOLD).includes(Buffer.from(s))
}

function goldCount(s: string): number {
  const buf = readFileSync(GOLD)
  const needle = Buffer.from(s)
  let n = 0
  let i = 0
  while (true) {
    const j = buf.indexOf(needle, i)
    if (j < 0) return n
    n++
    i = j + 1
  }
}

afterEach(() => {
  setOriginalFsImplementation()
  setFlagSettingsInline(null)
  resetSettingsCache()
  delete process.env.CLAUDE_CODE_SESSION_KIND
})

describe('densable 2.1.283 trustedNetworkDirectories gold lock', () => {
  test('unique string count 40 @72811096', () => {
    expect(goldCount('trustedNetworkDirectories')).toBe(40)
    expect(goldHas('trustedNetworkDirectories')).toBe(true)
  })

  test('g1/h1 path-screen body (not ReflectMessage g1 @180171152)', () => {
    expect(goldHas('function g1(n,e,t){let i=n.trim()')).toBe(true)
    expect(goldHas('function h1(n,e){return r(n,e)?.reason}')).toBe(true)
    expect(goldHas('reason:"nt_namespace"')).toBe(true)
    expect(goldHas('reason:"untrusted_unc"')).toBe(true)
    expect(goldHas('reason:"untrusted_automount"')).toBe(true)
    expect(goldHas('reason:"unvettable_chain"')).toBe(true)
    expect(goldHas('reason:"suspicious_windows_spelling"')).toBe(true)
  })

  test('Ier flagSettings rewrite body', () => {
    expect(
      goldHas('if(o==="flagSettings"){let A=new Set((he("flagSettings")'),
    ).toBe(true)
    expect(
      goldHas(
        'w={...w,trustedNetworkDirectories:L}}if(h.length>0)w=Cc(w,{type:"removeDirectories"',
      ),
    ).toBe(true)
  })
})

describe('ToolPermissionContext field', () => {
  test('empty context carries an empty trustedNetworkDirectories map', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.trustedNetworkDirectories).toBeInstanceOf(Map)
    expect(ctx.trustedNetworkDirectories?.size).toBe(0)
  })
})

describe('g1 / h1 screen', () => {
  test('local path ok', () => {
    const r = screenNetworkPathG1('/tmp/proj', '/tmp/proj', undefined)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.pathsToCheck).toContain('/tmp/proj')
  })

  test('NT namespace is nt_namespace', () => {
    const r = screenNetworkPathG1(
      '\\??\\C:\\Windows',
      '\\??\\C:\\Windows',
      undefined,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('nt_namespace')
  })

  test('UNC is untrusted_unc unless trusted', () => {
    const r = screenNetworkPathG1(
      '//fileserver/share/proj',
      '//fileserver/share/proj',
      undefined,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('untrusted_unc')
  })

  test('trusted UNC alias allows the share', () => {
    const trusted = new Map<string, readonly string[]>([
      ['Z:\\proj', ['Z:\\proj', '//fileserver/share/proj']],
    ])
    const r = screenNetworkPathG1(
      '//fileserver/share/proj/src',
      '//fileserver/share/proj/src',
      trusted,
    )
    expect(r.ok).toBe(true)
  })

  test('automount /net is untrusted_automount', () => {
    const r = screenNetworkPathG1('/net/host/foo', '/net/host/foo', undefined)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('untrusted_automount')
  })

  test('h1 returns reason on resolved UNC, undefined when trusted', () => {
    expect(
      resolvedNetworkPathReasonH1('//fileserver/share/proj', undefined),
    ).toBe('untrusted_unc')
    const trusted = new Map<string, readonly string[]>([
      ['Z:\\proj', ['Z:\\proj', '//fileserver/share/proj']],
    ])
    expect(
      resolvedNetworkPathReasonH1('//fileserver/share/proj', trusted),
    ).toBeUndefined()
  })

  test('ne screenClaimPath uses context.trustedNetworkDirectories', () => {
    const empty = getEmptyToolPermissionContext()
    expect(screenClaimPath('//evil/share', '//evil/share', empty).ok).toBe(
      false,
    )
    const trusted = {
      trustedNetworkDirectories: new Map<string, readonly string[]>([
        ['Z:\\proj', ['Z:\\proj', '//fileserver/share/proj']],
      ]),
    }
    expect(
      screenClaimPath(
        '//fileserver/share/proj',
        '//fileserver/share/proj',
        trusted,
      ).ok,
    ).toBe(true)
  })
})

describe('Ier flagSettings rewrite', () => {
  test('txn mapped-drive aliases when realpath is UNC on same host', () => {
    const base = getFsImplementation()
    setFsImplementation({
      ...base,
      realpathSync(path: string): string {
        if (path === 'Z:\\' || path === 'Z:/') {
          return '\\\\fileserver\\share'
        }
        if (path === 'Z:\\proj') return '\\\\fileserver\\share\\proj'
        return base.realpathSync(path)
      },
    })
    expect(mappedNetworkDriveAliases('Z:\\proj')).toEqual([
      'Z:\\proj',
      '\\\\fileserver\\share\\proj',
    ])
  })

  test('rewrite adds mapped aliases onto the bag and toAdd', () => {
    const base = getFsImplementation()
    setFsImplementation({
      ...base,
      existsSync: () => false,
      realpathSync(path: string): string {
        if (path === 'Z:\\' || path === 'Z:/') {
          return '\\\\fileserver\\share'
        }
        if (path === 'Z:\\proj') return '\\\\fileserver\\share\\proj'
        return base.realpathSync(path)
      },
    })
    const scratch = { toRemove: [] as string[], toAdd: [] as string[] }
    const rewritten = rewriteFlagSettingsTrustedNetworkDirectories(
      {
        additionalWorkingDirectories: new Map(),
        trustedNetworkDirectories: new Map(),
      },
      new Set(['Z:\\proj']),
      scratch,
    )
    expect(rewritten).toBeDefined()
    expect([...rewritten!.trustedNetworkDirectories.keys()]).toEqual([
      'Z:\\proj',
    ])
    expect(rewritten!.trustedNetworkDirectories.get('Z:\\proj')).toEqual([
      'Z:\\proj',
      '\\\\fileserver\\share\\proj',
    ])
    expect(scratch.toAdd).toEqual(['\\\\fileserver\\share\\proj'])
  })

  test('bg session (rxn false) does not add new mapped aliases', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    const base = getFsImplementation()
    setFsImplementation({
      ...base,
      existsSync: () => false,
      realpathSync(path: string): string {
        if (path === 'Z:\\' || path === 'Z:/') {
          return '\\\\fileserver\\share'
        }
        if (path === 'Z:\\proj') return '\\\\fileserver\\share\\proj'
        return base.realpathSync(path)
      },
    })
    const scratch = { toRemove: [] as string[], toAdd: [] as string[] }
    const rewritten = rewriteFlagSettingsTrustedNetworkDirectories(
      {
        additionalWorkingDirectories: new Map(),
        trustedNetworkDirectories: new Map(),
      },
      new Set(['Z:\\proj']),
      scratch,
    )
    expect(rewritten).toBeUndefined()
    expect(scratch.toAdd).toEqual([])
  })

  test('reconcile flagSettings drops unlisted aliases (not cliArg)', () => {
    setFlagSettingsInline({ permissions: { additionalDirectories: [] } })
    resetSettingsCache()
    let ctx = getEmptyToolPermissionContext()
    ctx = {
      ...ctx,
      additionalWorkingDirectories: new Map([
        ['/mnt/z', { path: '/mnt/z', source: 'flagSettings' }],
        [
          '//fileserver/share/proj',
          { path: '//fileserver/share/proj', source: 'localSettings' },
        ],
      ]),
      trustedNetworkDirectories: new Map([
        ['/mnt/z', ['/mnt/z', '//fileserver/share/proj']],
      ]),
    }
    ctx = reconcileAdditionalDirectories(ctx, [], [], 'flagSettings')
    expect(ctx.trustedNetworkDirectories?.has('/mnt/z')).toBe(false)
    expect(
      ctx.additionalWorkingDirectories.has('//fileserver/share/proj'),
    ).toBe(false)
  })

  test('cliArg-owned keys survive flagSettings drop', () => {
    setFlagSettingsInline({ permissions: { additionalDirectories: [] } })
    resetSettingsCache()
    let ctx = getEmptyToolPermissionContext()
    ctx = {
      ...ctx,
      additionalWorkingDirectories: new Map([
        ['/mnt/z', { path: '/mnt/z', source: 'cliArg' }],
      ]),
      trustedNetworkDirectories: new Map([
        ['/mnt/z', ['/mnt/z', '//fileserver/share/proj']],
      ]),
    }
    ctx = reconcileAdditionalDirectories(ctx, [], [], 'flagSettings')
    expect(ctx.trustedNetworkDirectories?.get('/mnt/z')).toEqual([
      '/mnt/z',
      '//fileserver/share/proj',
    ])
  })
})
