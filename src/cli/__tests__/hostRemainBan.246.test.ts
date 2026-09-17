/**
 * densable 2.1.246 remain-ban cluster — official-absent / wrong-host.
 *
 *   markStartupDialogBlocked — bytecode chunk-63xcwyf6; Desktop
 *     CLAUDE_JOB_DIR job wrap only. CLI wedge does not call it.
 *   useRenderInput — Desktop He=(e,r,o)=>ae(...). CLI Ink has no ae.
 *   iX — empty stub next to DF. Restore triple is EF(pt),AF(pt),DF(pt);
 *     iX is not in that list. Not Ko().d. Do not invent the empty stub.
 *   AF — official body; Yv=replaceMemoryToggledOff. Locked separately.
 *   ColorFile JS — SEA 0. Local napi ColorFile is ours, not official JS.
 *   padMissing / Batch* — SEA 0 product tools.
 *   custom JWT jp — none. Official jose decodeJwt; local na=decodeJwtExpiry.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('densable 2.1.246 remain-ban host / SEA-0 cluster', () => {
  test('CLI wedge and Ink host do not invent markStartupDialogBlocked', () => {
    const files = [
      'src/daemon/rendezvousServer.ts',
      'src/daemon/xSeSpawn.ts',
      'src/daemon/bgManager.ts',
      'src/interactiveHelpers.tsx',
      'src/cli/print.ts',
      'packages/@ant/ink/src/components/App.tsx',
    ]
    for (const file of files) {
      const body = src(file)
      expect(body).not.toContain('markStartupDialogBlocked')
      expect(body).not.toContain('clearStartupDialogBlocked')
      expect(body).not.toContain('chunk-63xcwyf6')
    }
  })

  test('CLI Ink has no Desktop useRenderInput / ae host hook', () => {
    const inkApp = src('packages/@ant/ink/src/components/App.tsx')
    const inkCore = src('packages/@ant/ink/src/core/ink.tsx')
    const print = src('src/cli/print.ts')
    for (const body of [inkApp, inkCore, print]) {
      expect(body).not.toContain('useRenderInput')
      expect(body).not.toContain('useRenderHook')
      expect(body).not.toContain('He=(e,r,o)=>ae')
      expect(body).not.toContain('surface:"terminal"')
    }
  })

  test('print restore is EF + AF — no empty iX stub', () => {
    const print = src('src/cli/print.ts')
    expect(print).toContain('declared_dialog_kinds')
    expect(print).toContain('setSdkSupportedDialogKinds')
    expect(print).toContain('restoreMemoryToggleFromWorkerState')
    expect(print).not.toContain('planModeRestoredAtBoot')
    expect(print).not.toContain('permissionModeSuppliedOnInvocation:t')
    expect(print).not.toContain('function iX(')
    const commands = src('src/commands.ts')
    expect(commands).not.toContain('pause-memory')
  })

  test('ColorFile JS is not invented; local class is napi', () => {
    const wrapper = src('src/components/StructuredDiff/colorDiff.ts')
    expect(wrapper).toContain("from 'color-diff-napi'")
    expect(wrapper).not.toContain('export class ColorFile')
    const napi = src('packages/color-diff-napi/src/index.ts')
    expect(napi).toContain('export class ColorFile')
  })

  test('no padMissing helper and no product Batch* tools', () => {
    const tools = src('src/tools.ts')
    expect(tools).not.toContain('BatchRead')
    expect(tools).not.toContain('BatchEdit')
    expect(tools).not.toContain('BatchWrite')
    expect(tools).not.toContain('BatchGlob')
    expect(tools).not.toContain('BatchGrep')
    expect(tools).not.toContain('padMissing')
    const progress = src('src/components/tasks/RemoteSessionProgress.tsx')
    expect(progress).not.toContain('padMissing')
  })

  test('helper JWT na is decodeJwtExpiry — no custom jp parse', () => {
    const jwtExpiry = src('src/utils/jwtExpiry.ts')
    expect(jwtExpiry).toContain('export function decodeJwtExpiry(')
    expect(jwtExpiry).toContain("token.startsWith('sk-ant-si-')")
    expect(jwtExpiry).not.toContain('function jp')
    expect(jwtExpiry).not.toContain("from 'jose'")
    const auth = src('src/utils/auth.ts')
    expect(auth).toContain('decodeJwtExpiry')
    expect(auth).not.toContain('function jp')
  })
})
