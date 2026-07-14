import { describe, expect, test } from 'bun:test'
import {
  getSdkSupportedDialogKinds,
  getSdkSupportedDialogKindsSource,
  setSdkSupportedDialogKinds,
} from '../../bootstrap/state.js'
import { sanitizeDeclaredDialogKinds } from '../userDialog.js'

describe('sdkSupportedDialogKinds bootstrap densable', () => {
  test('set/get source initialize and restored', () => {
    setSdkSupportedDialogKinds(undefined)
    expect(getSdkSupportedDialogKinds()).toBeUndefined()
    expect(getSdkSupportedDialogKindsSource()).toBe('none')

    const kinds = sanitizeDeclaredDialogKinds(['refusal_fallback_prompt', 'x'])
    setSdkSupportedDialogKinds(kinds, 'initialize')
    expect(getSdkSupportedDialogKinds()).toEqual([
      'refusal_fallback_prompt',
      'x',
    ])
    expect(getSdkSupportedDialogKindsSource()).toBe('initialize')

    setSdkSupportedDialogKinds(['ok'], 'restored')
    expect(getSdkSupportedDialogKindsSource()).toBe('restored')

    setSdkSupportedDialogKinds(undefined)
    expect(getSdkSupportedDialogKindsSource()).toBe('none')
  })
})
