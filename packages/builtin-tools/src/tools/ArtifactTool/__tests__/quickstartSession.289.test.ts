import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearQuickstartSession,
  extrasFromStartKit,
  getQuickstartGuidanceToolUseId,
  getQuickstartRan,
  isQuickstartNone,
  recordQuickstartRan,
  setQuickstartGuidanceToolUseId,
} from '../quickstartSession.js'

afterEach(() => {
  clearQuickstartSession()
})

describe('gold 2.1.289 Artifact quickstart session analog', () => {
  test('record/get/clear quickstartRan', () => {
    expect(getQuickstartRan('slug-a')).toBeUndefined()
    recordQuickstartRan('slug-a', {
      toolUseId: 'tu-1',
      listed: true,
      designSystem: 'https://claude.ai/code/artifact/ds',
      none: false,
    })
    expect(getQuickstartRan('slug-a')).toEqual({
      toolUseId: 'tu-1',
      listed: true,
      designSystem: 'https://claude.ai/code/artifact/ds',
      none: false,
    })
    recordQuickstartRan('slug-b', { none: true })
    expect(getQuickstartRan('slug-b')?.none).toBe(true)
    expect(getQuickstartRan('slug-a')?.toolUseId).toBe('tu-1')
    clearQuickstartSession()
    expect(getQuickstartRan('slug-a')).toBeUndefined()
    expect(getQuickstartRan('slug-b')).toBeUndefined()
  })

  test('guidance toolUseId set/get/clear', () => {
    expect(getQuickstartGuidanceToolUseId()).toBeUndefined()
    setQuickstartGuidanceToolUseId('guid-1')
    expect(getQuickstartGuidanceToolUseId()).toBe('guid-1')
    setQuickstartGuidanceToolUseId(undefined)
    expect(getQuickstartGuidanceToolUseId()).toBeUndefined()
    setQuickstartGuidanceToolUseId('guid-2')
    clearQuickstartSession()
    expect(getQuickstartGuidanceToolUseId()).toBeUndefined()
  })

  test('isQuickstartNone detector (gold aa)', () => {
    expect(isQuickstartNone({})).toBe(true)
    expect(isQuickstartNone({ design_systems: { instances: [] } })).toBe(true)
    expect(
      isQuickstartNone({
        design_systems: { instances: [{ title: 'Acme' }] },
      }),
    ).toBe(false)
    expect(isQuickstartNone({ unavailable: true })).toBe(false)
    expect(
      isQuickstartNone({
        design_systems: { overflow: true, instances: [] },
      }),
    ).toBe(false)
    expect(isQuickstartNone({ dropped: 2 })).toBe(false)
    expect(
      isQuickstartNone({
        design_system: { url: 'https://claude.ai/code/artifact/x' },
      }),
    ).toBe(false)
    expect(
      isQuickstartNone({
        design_system: {
          unavailable: 'the account lists no design systems',
        },
      }),
    ).toBe(true)
  })

  test('extrasFromStartKit slides type files with artifact-type/reference/', () => {
    const extras = extrasFromStartKit(
      {
        match: { type_url: 'https://claude.ai/code/artifact/slides-1' },
        start_kit: {
          type: {
            dir: '/tmp/claude-quickstart-start-kit/slides-1',
            files: [
              { path: 'SKILL.md' },
              { path: 'artifact-type/reference/pages.md' },
            ],
          },
        },
      },
      'slides',
    )
    expect(extras.savedPages).toEqual({
      dir: '/tmp/claude-quickstart-start-kit/slides-1',
      paths: ['SKILL.md', 'artifact-type/reference/pages.md'],
    })
    expect(extras.savedSystem).toBeUndefined()
  })

  test('extrasFromStartKit system_url plus README.md is savedSystem', () => {
    const extras = extrasFromStartKit(
      {
        match: { type_url: 'https://claude.ai/code/artifact/design-core' },
        start_kit: {
          system_url: 'https://claude.ai/code/artifact/sys-1',
          system: {
            dir: '/tmp/claude-quickstart-start-kit/system/sys-1',
            files: [{ path: 'README.md' }, { path: 'tokens.json' }],
          },
        },
      },
      'design',
    )
    expect(extras.savedSystem).toEqual({
      url: 'https://claude.ai/code/artifact/sys-1',
      dir: '/tmp/claude-quickstart-start-kit/system/sys-1',
    })
  })

  test('extrasFromStartKit intent other is empty', () => {
    expect(
      extrasFromStartKit(
        {
          match: { type_url: 'https://claude.ai/code/artifact/slides-1' },
          start_kit: {
            system_url: 'https://claude.ai/code/artifact/sys-1',
            system: {
              dir: '/tmp/sys',
              files: [{ path: 'README.md' }],
            },
            type: {
              dir: '/tmp/type',
              files: [{ path: 'artifact-type/reference/a.md' }],
            },
          },
        },
        'other',
      ),
    ).toEqual({})
  })
})
