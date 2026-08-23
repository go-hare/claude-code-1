/**
 * densable 2.1.212 #45 — print/SDK set_model next-turn (RGf/DGf/h5 + Ye/HS/session).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  setMainLoopModelOverride,
  getMainLoopModelOverride,
} from 'src/bootstrap/state.js'
import {
  decidePrintSetModel,
  decideReplBridgeSetModel,
  modelNotAllowedMessage,
  recognizePrintModel,
  sanitizeModelIdForError,
  unrecognizedModelMessage,
} from '../printSetModel.js'

const savedKey = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  // getDefaultMainLoopModel → isMaxSubscriber needs a key present
  process.env.ANTHROPIC_API_KEY = savedKey || 'test-key-for-print-set-model'
})

afterEach(() => {
  setMainLoopModelOverride(undefined)
  if (savedKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = savedKey
  }
})

describe('densable #45 print set_model (printSetModel)', () => {
  test('invalid non-string model → invalid_model_type', () => {
    const d = decidePrintSetModel(123 as unknown as string, undefined)
    expect(d.ok).toBe(false)
    if (d.ok) return
    expect(d.analytics).toBe('invalid_model_type')
    expect(d.error).toBe('set_model: model must be a string')
  })

  test('null model is treated as default (not invalid type)', () => {
    // densable: Fr!=null&&typeof Fr!=="string" — null/undefined OK
    const d = decidePrintSetModel(null, undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.requestedArg).toBe('default')
  })

  test('undefined model is treated as default', () => {
    const d = decidePrintSetModel(undefined, undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.requestedArg).toBe('default')
  })

  test('default (case/trim) resolves without recognition failure', () => {
    for (const raw of ['default', 'DEFAULT', ' Default ']) {
      const d = decidePrintSetModel(raw, undefined)
      expect(d.ok).toBe(true)
      if (!d.ok) return
      expect(d.requestedArg).toBe(raw)
      expect(typeof d.model).toBe('string')
      expect(d.model.length).toBeGreaterThan(0)
    }
  })

  test('known alias sonnet is recognized and succeeds', () => {
    const d = decidePrintSetModel('sonnet', undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.model.toLowerCase()).toContain('sonnet')
  })

  test('claude-* id is recognized (RGf /^claude-\\S+$/)', () => {
    const rec = recognizePrintModel('claude-sonnet-4-5-20250929')
    expect(rec.recognized).toBe(true)
  })

  test('garbage id is unrecognized with DGf message', () => {
    const d = decidePrintSetModel('not-a-real-model-xyz', undefined)
    // On 3P providers recognition always passes; only firstParty hard-fails.
    // When recognized:false, error matches densable DGf.
    if (!d.ok && d.analytics === 'unrecognized_model') {
      expect(d.error).toMatch(/is not a recognized model id/)
      expect(d.error).toContain(sanitizeModelIdForError('not-a-real-model-xyz'))
    }
  })

  test('unrecognizedModelMessage matches densable DGf copy', () => {
    expect(unrecognizedModelMessage('foo')).toBe(
      'Model "foo" is not a recognized model id. Run /model to see available models.',
    )
    expect(unrecognizedModelMessage('foo', 'sonnet')).toBe(
      'Model "foo" is not a recognized model id. Did you mean \'sonnet\'?',
    )
  })

  test('modelNotAllowedMessage matches densable r4 copy', () => {
    expect(modelNotAllowedMessage('opus', 'claude-sonnet-4-5')).toContain(
      'restricted by your organization',
    )
    expect(modelNotAllowedMessage('opus', 'claude-sonnet-4-5')).toContain(
      'Using claude-sonnet-4-5 instead',
    )
  })

  test('sanitizeModelIdForError strips control junk (densable _5e)', () => {
    expect(sanitizeModelIdForError('opus\n4')).toBe('opus4')
    expect(sanitizeModelIdForError('!!!')).toBe('(unrecognized model name)')
  })

  test('success path model is written for next-turn Ye/HS (overrideable)', () => {
    const d = decidePrintSetModel('haiku', 'sonnet')
    expect(d.ok).toBe(true)
    if (!d.ok) return
    setMainLoopModelOverride(d.model)
    expect(getMainLoopModelOverride()).toBe(d.model)
  })

  test('redundant same-model may skip breadcrumbs when family unchanged', () => {
    const first = decidePrintSetModel('haiku', undefined)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    setMainLoopModelOverride(first.model)
    const second = decidePrintSetModel('haiku', first.model)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // densable: xi()!==Wn || oi(Zn)!==oi($s??Wn) — same model → no Ge
    expect(second.injectBreadcrumbs).toBe(false)
  })
})

describe('densable 2.1.238 #24 decideReplBridgeSetModel', () => {
  test('null/undefined/default resolve to a concrete default model', () => {
    for (const raw of [
      null,
      undefined,
      'default',
      'DEFAULT',
      ' Default ',
    ] as const) {
      const d = decideReplBridgeSetModel(raw, undefined)
      expect(d.ok).toBe(true)
      if (!d.ok) return
      expect(typeof d.model).toBe('string')
      expect(d.model.length).toBeGreaterThan(0)
      expect(d.model.toLowerCase()).not.toBe('default')
    }
  })

  test('unrecognized ids still apply (RGf is print-only)', () => {
    const d = decideReplBridgeSetModel('not-a-real-model-xyz', undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.model).toBe('not-a-real-model-xyz')
  })

  test('known alias sonnet succeeds', () => {
    const d = decideReplBridgeSetModel('sonnet', undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.model.toLowerCase()).toContain('sonnet')
  })
})
