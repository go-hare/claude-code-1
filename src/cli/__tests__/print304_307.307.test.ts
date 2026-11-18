import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('v2.1.304–2.1.307 print.ts alignment', () => {
  const printSrc = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')

  test('#978: get_context_usage runs non-blockingly via pendingContextUsagePromise and is awaited at cleanup', () => {
    const cleanupIdx = printSrc.indexOf(
      'await pendingContextUsagePromise.catch(() => {})',
    )
    expect(cleanupIdx).toBeGreaterThan(-1)

    const handlerIdx = printSrc.indexOf(
      "else if (msg.request.subtype === 'get_context_usage')",
    )
    expect(handlerIdx).toBeGreaterThan(-1)
    const nextBranchIdx = printSrc.indexOf(
      "else if (msg.request.subtype === 'mcp_message')",
      handlerIdx,
    )
    const handlerBlock = printSrc.slice(handlerIdx, nextBranchIdx)
    expect(handlerBlock).toContain('const runContextUsage = async')
    expect(handlerBlock).toContain(
      'pendingContextUsagePromise = pendingContextUsagePromise.then(',
    )
  })

  test('#1101: run() races updateSdkMcp against getMcpConnectTimeoutMs when options.sdkUrl is set', () => {
    const runIdx = printSrc.indexOf("headlessProfilerCheckpoint('run_entry')")
    const afterIdx = printSrc.indexOf(
      "headlessProfilerCheckpoint('after_updateSdkMcp')",
    )
    expect(runIdx).toBeGreaterThan(-1)
    expect(afterIdx).toBeGreaterThan(runIdx)
    const block = printSrc.slice(runIdx, afterIdx)
    expect(block).toContain('if (options.sdkUrl)')
    expect(block).toContain('getMcpConnectTimeoutMs()')
    expect(block).toContain('raceWithTimeoutMs(sdkMcpUpdatePromise, budgetMs)')
    expect(block).toContain("logEvent('tengu_sdk_mcp_update_wait_timeout'")
  })
})
