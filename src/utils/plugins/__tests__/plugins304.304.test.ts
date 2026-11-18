import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkPluginInputRefusal,
  clearSessionStoppedForPluginInput,
  getPluginInputRefusalReason,
  markSessionStoppedForPluginInput,
  setBackgroundCeilingProvider,
} from '../functionHooksModules.js'

describe('plugins v2.1.304 (#969)', () => {
  afterEach(() => {
    setBackgroundCeilingProvider(undefined)
    clearSessionStoppedForPluginInput()
  })

  test('#969: background ceiling provider refuses plugin spawn/input past --max-turns or inputClosed', () => {
    expect(getPluginInputRefusalReason()).toBeUndefined()

    setBackgroundCeilingProvider(() => 'the run reached its --max-turns limit')
    expect(getPluginInputRefusalReason()).toBe(
      'the run reached its --max-turns limit',
    )
    expect(checkPluginInputRefusal({ plugin: 'my-mod' }, '$.agent.spawn')).toBe(
      'the run reached its --max-turns limit',
    )

    setBackgroundCeilingProvider(() => 'the host has ended its input')
    expect(checkPluginInputRefusal({ plugin: 'my-mod' }, '$.agent.spawn')).toBe(
      'the host has ended its input',
    )
  })

  test('#969: Stop latch blocks plugin input until a newer vouched user press clears it', () => {
    const sessionKey = {}
    markSessionStoppedForPluginInput(sessionKey, 1000)

    expect(
      checkPluginInputRefusal(
        { plugin: 'my-mod', sessionKey, vouchedPressAt: 999 },
        '$.agent.spawn',
      ),
    ).toBe('the session was stopped and nobody has sent input since')

    expect(
      checkPluginInputRefusal(
        { plugin: 'my-mod', sessionKey, vouchedPressAt: 1000 },
        '$.agent.spawn',
      ),
    ).toBeUndefined()
  })
})
