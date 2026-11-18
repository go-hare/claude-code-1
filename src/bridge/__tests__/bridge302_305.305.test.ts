import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('v2.1.302–2.1.305 Bridge & Remote Control alignment', () => {
  test('#909: remote-control --help/-h prints help before auth check in cli.tsx and enterRemoteControl', () => {
    const cliSrc = readFileSync(join(ROOT, 'src/entrypoints/cli.tsx'), 'utf8')
    const rcFlagsSrc = readFileSync(
      join(ROOT, 'src/entrypoints/remoteControlFlags.ts'),
      'utf8',
    )
    const bridgeMainSrc = readFileSync(
      join(ROOT, 'src/bridge/bridgeMain.ts'),
      'utf8',
    )

    expect(bridgeMainSrc).toContain(
      'export async function printRemoteControlHelp',
    )

    const helpIdx = cliSrc.indexOf('printRemoteControlHelp')
    const enterIdx = cliSrc.indexOf('await enterRemoteControl(args.slice(1))')
    expect(helpIdx).toBeGreaterThan(-1)
    expect(enterIdx).toBeGreaterThan(helpIdx)

    const fnStart = rcFlagsSrc.indexOf(
      'export async function enterRemoteControl',
    )
    const fnBody = rcFlagsSrc.slice(fnStart, fnStart + 400)
    const rcHelpIdx = fnBody.indexOf('printRemoteControlHelp')
    const refuseIdx = fnBody.indexOf('refuseRemoteControlLocally')
    expect(rcHelpIdx).toBeGreaterThan(-1)
    expect(refuseIdx).toBeGreaterThan(rcHelpIdx)
  })

  test('#976: initReplBridge skips permanent writeHistorySuppression under tornEntryPair', () => {
    const initSrc = readFileSync(
      join(ROOT, 'src/bridge/initReplBridge.ts'),
      'utf8',
    )
    const vetoStart = initSrc.indexOf('const applyOwnerVetoTaint =')
    const vetoEnd = initSrc.indexOf(
      'const restored = getCurrentSessionBridge()',
    )
    const vetoBody = initSrc.slice(vetoStart, vetoEnd)
    const tornIdx = vetoBody.indexOf('if (tornEntryPair)')
    const returnIdx = vetoBody.indexOf('return', tornIdx)
    const writeIdx = vetoBody.indexOf('writeHistorySuppression(')
    expect(tornIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(tornIdx)
    expect(writeIdx).toBeGreaterThan(returnIdx)
  })

  test('#977: bridgeEnabled allows paid-plan no-telemetry fallback without GrowthBook gate', async () => {
    const enabledSrc = readFileSync(
      join(ROOT, 'src/bridge/bridgeEnabled.ts'),
      'utf8',
    )
    expect(enabledSrc).toContain(
      'export function isPaidPlanNoTelemetryBridgeFallback()',
    )
    expect(enabledSrc).toContain('!isPaidPlanNoTelemetryBridgeFallback() &&')
    expect(enabledSrc).toContain("getPrivacyLevel() !== 'no-telemetry'")
  })

  test('#1055: bridgeMain logs saved spawn mode source at startup and on w toggle', () => {
    const bridgeMainSrc = readFileSync(
      join(ROOT, 'src/bridge/bridgeMain.ts'),
      'utf8',
    )
    expect(bridgeMainSrc).toContain(
      "if (spawnModeSource === 'saved' && multiSessionEnabled)",
    )
    expect(bridgeMainSrc).toContain('(saved for this folder')
    expect(bridgeMainSrc).toContain('Saved for this folder; w switches back.')
  })
})
