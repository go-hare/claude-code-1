import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fastModeModule from '../../../utils/fastMode.js'
import * as fastIndexModule from '../index.js'
import {
  formatFastModePricingForModel,
  handleFastModeShortcut,
} from '../fast.js'

const spies: Array<{ mockRestore: () => void }> = []

afterEach(() => {
  while (spies.length > 0) {
    spies.pop()?.mockRestore()
  }
})

describe('D-P2-7: /fast UI pricing copy passes active model to getOpus46CostTier(true, model)', () => {
  test('formatFastModePricingForModel returns $8/$40 for Opus 5.5 and $16/$80 for Fable 5.2', () => {
    spies.push(spyOn(fastModeModule, 'isFastModeEnabled').mockReturnValue(true))
    spies.push(
      spyOn(fastModeModule, 'isFastModeSupportedByModel').mockReturnValue(true),
    )

    expect(formatFastModePricingForModel('claude-opus-5-5')).toBe(
      '$8/$40 per Mtok',
    )
    expect(formatFastModePricingForModel('claude-fable-5-2')).toBe(
      '$16/$80 per Mtok',
    )
    expect(formatFastModePricingForModel('claude-opus-5')).toBe(
      '$10/$50 per Mtok',
    )
  })

  test('handleFastModeShortcut includes model-specific fast pricing for Opus 5.5 and Fable 5.2', async () => {
    spies.push(spyOn(fastModeModule, 'isFastModeEnabled').mockReturnValue(true))
    spies.push(
      spyOn(fastModeModule, 'getFastModeUnavailableReason').mockReturnValue(
        null,
      ),
    )
    spies.push(
      spyOn(fastModeModule, 'isFastModeSupportedByModel').mockReturnValue(true),
    )
    spies.push(
      spyOn(
        fastIndexModule,
        'saveFastModeWithConfigSetHook',
      ).mockImplementation(async (enable, _prev, onCommit) => {
        onCommit(enable)
        return { kind: 'saved', saved: enable }
      }),
    )

    const opus55Msg = await handleFastModeShortcut(
      true,
      () =>
        ({
          mainLoopModel: 'claude-opus-5-5',
          fastMode: false,
        }) as never,
      () => {},
    )
    expect(opus55Msg).toContain('$8/$40 per Mtok')
    expect(opus55Msg).not.toContain('$10/$50 per Mtok')

    const fable52Msg = await handleFastModeShortcut(
      true,
      () =>
        ({
          mainLoopModel: 'claude-fable-5-2',
          fastMode: false,
        }) as never,
      () => {},
    )
    expect(fable52Msg).toContain('$16/$80 per Mtok')
  })
})
