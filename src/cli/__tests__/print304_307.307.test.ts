import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..', '..', '..')

describe('v2.1.304–2.1.307 print.ts alignment', () => {
  const mcpAndPluginsSrc = readFileSync(
    join(ROOT, 'src/cli/print/mcpAndPlugins.ts'),
    'utf8',
  )
  const controlLoopSrc = readFileSync(
    join(ROOT, 'src/cli/print/controlLoop.ts'),
    'utf8',
  )
  const turnRunnerSrc = readFileSync(
    join(ROOT, 'src/cli/print/turnRunner.ts'),
    'utf8',
  )

  test('#978: get_context_usage runs non-blockingly via pendingContextUsagePromise and is awaited at cleanup', () => {
    const cleanupIdx = mcpAndPluginsSrc.indexOf(
      'pendingContextUsagePromise.catch(() => {})',
    )
    expect(cleanupIdx).toBeGreaterThan(-1)

    const handlerIdx = controlLoopSrc.indexOf(
      "else if (msg.request.subtype === 'get_context_usage')",
    )
    expect(handlerIdx).toBeGreaterThan(-1)
    const nextBranchIdx = controlLoopSrc.indexOf(
      "else if (msg.request.subtype === 'mcp_message')",
      handlerIdx,
    )
    const handlerBlock = controlLoopSrc.slice(handlerIdx, nextBranchIdx)
    expect(handlerBlock).toContain('const runContextUsage = async')
    expect(handlerBlock).toContain(
      'pendingContextUsagePromise =\n              streamCtx.pendingContextUsagePromise.then(',
    )
  })

  test('#1101: run() races updateSdkMcp against getMcpConnectTimeoutMs when options.sdkUrl is set', () => {
    const runIdx = turnRunnerSrc.indexOf(
      "headlessProfilerCheckpoint('run_entry')",
    )
    const afterIdx = turnRunnerSrc.indexOf(
      "headlessProfilerCheckpoint('after_updateSdkMcp')",
    )
    expect(runIdx).toBeGreaterThan(-1)
    expect(afterIdx).toBeGreaterThan(runIdx)
    const block = turnRunnerSrc.slice(runIdx, afterIdx)
    expect(block).toContain('if (streamCtx.options.sdkUrl)')
    expect(block).toContain('getMcpConnectTimeoutMs()')
    expect(block).toContain('raceWithTimeoutMs(sdkMcpUpdatePromise, budgetMs)')
    expect(block).toContain("logEvent('tengu_sdk_mcp_update_wait_timeout'")
  })
})
