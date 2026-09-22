/**
 * densable 2.1.248 #46 — /loop self-pace + autonomous default always on.
 * SEA removed tengu_kairos_loop_dynamic / tengu_kairos_loop_prompt GB.
 */
import { describe, expect, test } from 'bun:test'

import { isKairosLoopDynamicEnabled } from '../loopDynamic.js'
import { isLoopDefaultPromptEnabled } from '../loopFire.js'

function exportedFnBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}`)
  expect(start).toBeGreaterThan(-1)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(brace, i + 1)
    }
  }
  return src.slice(start, start + 160)
}

describe('loop always-on 248 #46', () => {
  test('dynamic + fire available without GB', () => {
    expect(isKairosLoopDynamicEnabled()).toBe(true)
    expect(isLoopDefaultPromptEnabled()).toBe(true)
  })

  test('gate bodies have no GB call and no provider check', async () => {
    const dynamicSrc = await Bun.file(
      new URL('../loopDynamic.ts', import.meta.url),
    ).text()
    const fireSrc = await Bun.file(
      new URL('../loopFire.ts', import.meta.url),
    ).text()

    expect(dynamicSrc).not.toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_dynamic'",
    )
    expect(fireSrc).not.toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_prompt'",
    )

    const dynamicBody = exportedFnBody(dynamicSrc, 'isKairosLoopDynamicEnabled')
    const fireBody = exportedFnBody(fireSrc, 'isLoopDefaultPromptEnabled')
    for (const body of [dynamicBody, fireBody]) {
      expect(body).toContain('return true')
      expect(body).not.toContain('getFeatureValue')
      expect(body).not.toContain('getAPIProvider')
      expect(body).not.toContain('bedrock')
      expect(body).not.toContain('vertex')
      expect(body).not.toContain('foundry')
    }
  })

  test('TX and ScheduleWakeup prompt use leftover-import jKe, not GB', async () => {
    const txSrc = await Bun.file(
      new URL(
        '../../../packages/builtin-tools/src/tools/SearchExtraToolsTool/prompt.ts',
        import.meta.url,
      ),
    ).text()
    const wakeupPromptSrc = await Bun.file(
      new URL(
        '../../../packages/builtin-tools/src/tools/ScheduleWakeupTool/prompt.ts',
        import.meta.url,
      ),
    ).text()

    expect(txSrc).toContain("from 'src/utils/loopDynamic.js'")
    expect(txSrc).not.toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_dynamic'",
    )
    expect(wakeupPromptSrc).not.toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_loop_dynamic'",
    )

    const { isDeferredTool } = await import(
      '../../../packages/builtin-tools/src/tools/SearchExtraToolsTool/prompt.js'
    )
    expect(
      isDeferredTool({
        name: 'ScheduleWakeup',
        shouldDefer: true,
      } as never),
    ).toBe(false)
  })
})
