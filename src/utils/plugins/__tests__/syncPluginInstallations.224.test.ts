import { describe, expect, test } from 'bun:test'
import type { PluginInstallationEntry } from '../schemas.js'
import {
  hasMatchingInstallRecord,
  syncExistingInstallationsForScope,
} from '../syncPluginInstallations.js'

function entry(
  partial: Partial<PluginInstallationEntry> & {
    scope: PluginInstallationEntry['scope']
    installPath: string
  },
): PluginInstallationEntry {
  return {
    installedAt: '2020-01-01T00:00:00.000Z',
    lastUpdated: '2020-01-01T00:00:00.000Z',
    version: '1.0.0',
    ...partial,
  }
}

describe('hasMatchingInstallRecord densable Gry skip', () => {
  test('managed requires single managed entry', () => {
    expect(
      hasMatchingInstallRecord(
        [entry({ scope: 'managed', installPath: '/a' })],
        { scope: 'managed' },
        true,
      ),
    ).toBe(true)
    expect(
      hasMatchingInstallRecord(
        [
          entry({ scope: 'managed', installPath: '/a' }),
          entry({
            scope: 'project',
            installPath: '/b',
            projectPath: '/p1',
          }),
        ],
        { scope: 'managed' },
        true,
      ),
    ).toBe(false)
  })

  test('project requires matching projectPath — length alone is not enough', () => {
    const installs = [
      entry({
        scope: 'project',
        installPath: '/cache/p',
        projectPath: '/proj-a',
      }),
    ]
    expect(
      hasMatchingInstallRecord(
        installs,
        { scope: 'project', projectPath: '/proj-a' },
        false,
      ),
    ).toBe(true)
    // BUG pre-#13: length>0 would skip and leave proj-b missing forever, or
    // overwrite [0] when sync ran — matching path must fail for other project
    expect(
      hasMatchingInstallRecord(
        installs,
        { scope: 'project', projectPath: '/proj-b' },
        false,
      ),
    ).toBe(false)
  })
})

describe('syncExistingInstallationsForScope densable #13 multi-project', () => {
  test('pushes new project record without overwriting peer project', () => {
    const installs = [
      entry({
        scope: 'project',
        installPath: '/cache/v1',
        projectPath: '/proj-a',
        version: '1.0.0',
      }),
    ]
    const { next, changed } = syncExistingInstallationsForScope(
      installs,
      { scope: 'project', projectPath: '/proj-b' },
      '2026-08-11T00:00:00.000Z',
    )
    expect(changed).toBe(true)
    expect(next).toHaveLength(2)
    expect(next[0]?.projectPath).toBe('/proj-a')
    expect(next[0]?.installPath).toBe('/cache/v1')
    expect(next[1]).toMatchObject({
      scope: 'project',
      projectPath: '/proj-b',
      installPath: '/cache/v1',
      version: '1.0.0',
    })
  })

  test('no-op when scope+projectPath already present', () => {
    const installs = [
      entry({
        scope: 'project',
        installPath: '/cache/v1',
        projectPath: '/proj-a',
      }),
    ]
    const { next, changed } = syncExistingInstallationsForScope(
      installs,
      { scope: 'project', projectPath: '/proj-a' },
      '2026-08-11T00:00:00.000Z',
    )
    expect(changed).toBe(false)
    expect(next).toHaveLength(1)
    expect(next[0]?.projectPath).toBe('/proj-a')
  })

  test('managed collapses multi entries to single managed', () => {
    const installs = [
      entry({
        scope: 'project',
        installPath: '/cache/v1',
        projectPath: '/proj-a',
      }),
      entry({
        scope: 'user',
        installPath: '/cache/v1',
      }),
    ]
    const { next, changed } = syncExistingInstallationsForScope(
      installs,
      { scope: 'managed' },
      '2026-08-11T00:00:00.000Z',
    )
    expect(changed).toBe(true)
    expect(next).toHaveLength(1)
    expect(next[0]?.scope).toBe('managed')
    expect(next[0]?.projectPath).toBeUndefined()
  })

  test('dedupes duplicate scope|projectPath keys', () => {
    const installs = [
      entry({
        scope: 'project',
        installPath: '/a',
        projectPath: '/p',
        lastUpdated: '2020-01-01T00:00:00.000Z',
      }),
      entry({
        scope: 'project',
        installPath: '/b',
        projectPath: '/p',
        lastUpdated: '2021-01-01T00:00:00.000Z',
      }),
    ]
    const { next, changed } = syncExistingInstallationsForScope(
      installs,
      { scope: 'project', projectPath: '/p' },
      '2026-08-11T00:00:00.000Z',
    )
    expect(changed).toBe(true)
    expect(next).toHaveLength(1)
    expect(next[0]?.installPath).toBe('/a') // first wins (densable filter)
  })

  test('drops managed when non-managed scope is settings truth', () => {
    const installs = [
      entry({ scope: 'managed', installPath: '/m' }),
      entry({
        scope: 'project',
        installPath: '/p',
        projectPath: '/proj',
      }),
    ]
    const { next, changed } = syncExistingInstallationsForScope(
      installs,
      { scope: 'project', projectPath: '/proj' },
      '2026-08-11T00:00:00.000Z',
    )
    expect(changed).toBe(true)
    expect(next.every(e => e.scope !== 'managed')).toBe(true)
    expect(next).toHaveLength(1)
    expect(next[0]?.projectPath).toBe('/proj')
  })
})
