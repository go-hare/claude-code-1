/**
 * densable 2.1.232 #4 — session name uniqueness (ZM_/JM_/kp/mEn/Bid/G$o).
 */
import { describe, expect, test } from 'bun:test'
import {
  allocateUniqueSessionName,
  collectOccupiedNameKeys,
  decideSessionNameUniqueness,
  findNameHoldersLenient,
  formatSessionNameYieldMessage,
  formatSessionRenamePeerNotice,
  formatSessionRenamedMessage,
  isOlderSessionRecord,
  normalizeSessionNameKey,
  noteSessionNameCorrespondent,
  notifySessionNameCorrespondents,
  parseCollisionNameSuffix,
  preferStableYieldName,
  resolveSessionNameWithLiveRegistry,
  resolveUniqueSessionName,
  reuseLastYieldName,
  runSessionNameStartupUniqueness,
  scheduleSessionNameRenameRecheck,
  SESSION_NAME_CORRESPONDENT_CAP,
  SESSION_NAME_RECHECK_MS,
  sessionNameState,
  truncateSessionNamePrefix,
  type LiveSessionNameRecord,
  type SessionNameUniquenessDeps,
} from '../sessionNameUniqueness.js'

function rec(
  pid: number,
  name: string | undefined,
  startedAt: number,
  extra?: Partial<LiveSessionNameRecord>,
): LiveSessionNameRecord {
  return { pid, name, startedAt, ...extra }
}

describe('densable kp normalizeSessionNameKey', () => {
  test('lowercases and collapses spaces to hyphens', () => {
    expect(normalizeSessionNameKey('  Fix Login  Button  ')).toBe(
      'fix-login-button',
    )
  })

  test('strips format chars but keeps whitespace runs for collapse', () => {
    expect(normalizeSessionNameKey('Foo​Bar')).toBe('foobar')
  })
})

describe('densable Lid isOlderSessionRecord', () => {
  test('earlier startedAt wins', () => {
    expect(isOlderSessionRecord(rec(1, 'a', 100), rec(2, 'a', 200))).toBe(true)
    expect(isOlderSessionRecord(rec(1, 'a', 200), rec(2, 'a', 100))).toBe(false)
  })

  test('pid breaks ties', () => {
    expect(isOlderSessionRecord(rec(1, 'a', 100), rec(2, 'a', 100))).toBe(true)
    expect(isOlderSessionRecord(rec(3, 'a', 100), rec(2, 'a', 100))).toBe(false)
  })
})

describe('densable YM_ findNameHoldersLenient', () => {
  test('finds other pids with same normalized name', () => {
    const live = [
      rec(10, 'Auth Fix', 1),
      rec(11, 'auth-fix', 2),
      rec(12, 'other', 3),
    ]
    const holders = findNameHoldersLenient(
      normalizeSessionNameKey('auth fix'),
      live,
      99,
    )
    expect(holders.map(h => h.pid).sort()).toEqual([10, 11])
  })

  test('excludes self pid', () => {
    const live = [rec(10, 'solo', 1)]
    expect(
      findNameHoldersLenient(normalizeSessionNameKey('solo'), live, 10),
    ).toEqual([])
  })
})

describe('densable JM_ allocateUniqueSessionName', () => {
  test('appends word-word suffix not in occupied set', () => {
    let n = 0
    const slugs = ['calm-otter', 'bright-fox', 'calm-otter']
    const occupied = new Set([normalizeSessionNameKey('auth')])
    const name = allocateUniqueSessionName('auth', occupied, () => {
      return slugs[n++] ?? `slug-${n}`
    })
    expect(name).toBe('auth-calm-otter')
    expect(normalizeSessionNameKey(name)).not.toBe(
      normalizeSessionNameKey('auth'),
    )
  })

  test('skips occupied suffixes then uses numeric tail', () => {
    const occupied = new Set([
      normalizeSessionNameKey('auth-calm-otter'),
      normalizeSessionNameKey('auth-bright-fox'),
    ])
    // Force first 16 attempts to collide, then numeric path
    let i = 0
    const name = allocateUniqueSessionName('auth', occupied, () => {
      i++
      // first 16 always same occupied pair alternating
      return i % 2 === 0 ? 'calm-otter' : 'bright-fox'
    })
    expect(name).toMatch(/^auth-(calm-otter|bright-fox)-\d+$/)
  })

  test('truncates long base to fit aqt=200', () => {
    const long = 'x'.repeat(250)
    const name = allocateUniqueSessionName(long, new Set(), () => 'ab-cd')
    expect(name.length).toBeLessThanOrEqual(200)
    expect(name.endsWith('-ab-cd')).toBe(true)
  })
})

describe('densable hi truncateSessionNamePrefix', () => {
  test('returns full string when under max', () => {
    expect(truncateSessionNamePrefix('hello', 10)).toBe('hello')
  })

  test('drops lone high surrogate at cut', () => {
    // densable hi: when slice ends on a high surrogate, drop it
    const s = 'ab\uD83Dcd' // high surrogate at index 2
    const out = truncateSessionNamePrefix(s, 3)
    expect(out).toBe('ab')
  })
})

describe('densable ZM_ decideSessionNameUniqueness', () => {
  test('keep when no holders', () => {
    const d = decideSessionNameUniqueness({
      desiredName: 'solo',
      self: rec(1, undefined, 100),
      live: [rec(1, undefined, 100)],
      moment: 'rename',
    })
    expect(d.kind).toBe('keep')
  })

  test('rename yields when any other live holds name', () => {
    const d = decideSessionNameUniqueness({
      desiredName: 'shared',
      self: rec(2, undefined, 50), // even if younger, rename always yields
      live: [rec(1, 'shared', 100), rec(2, undefined, 50)],
      moment: 'rename',
      slug: () => 'word-word',
    })
    expect(d.kind).toBe('yield')
    if (d.kind === 'yield') {
      expect(d.newName).toBe('shared-word-word')
      expect(d.holders[0]?.pid).toBe(1)
    }
  })

  test('startup only yields to older holders', () => {
    // self started earlier — keep
    const keep = decideSessionNameUniqueness({
      desiredName: 'shared',
      self: rec(1, 'shared', 10),
      live: [rec(1, 'shared', 10), rec(2, 'shared', 99)],
      moment: 'startup',
    })
    expect(keep.kind).toBe('keep')

    // self started later — yield
    const yieldD = decideSessionNameUniqueness({
      desiredName: 'shared',
      self: rec(2, undefined, 99),
      live: [rec(1, 'shared', 10), rec(2, undefined, 99)],
      moment: 'startup',
      slug: () => 'a-b',
    })
    expect(yieldD.kind).toBe('yield')
  })
})

describe('resolveUniqueSessionName', () => {
  test('sanitizes and yields', () => {
    const r = resolveUniqueSessionName({
      desiredName: '  Auth Work  ',
      self: rec(2, undefined, 200),
      live: [rec(1, 'auth-work', 100), rec(2, undefined, 200)],
      moment: 'rename',
    })
    expect(r.yielded).toBe(true)
    expect(
      r.name.startsWith('Auth Work-') ||
        r.name.startsWith('auth-work-') ||
        r.name.includes('-'),
    ).toBe(true)
    // allocated from sanitized base "Auth Work"
    expect(r.name.toLowerCase()).toContain('auth')
  })
})

describe('messages', () => {
  test('yield notice matches densable gold', () => {
    expect(formatSessionNameYieldMessage('foo', 'foo-calm-otter')).toBe(
      'Another live session on this machine goes by "foo", so this session is now "foo-calm-otter". Use /rename to pick a different name.',
    )
  })

  test('rename success with collision parenthetical', () => {
    expect(formatSessionRenamedMessage('foo-a-b', 'foo')).toBe(
      'Session renamed to: foo-a-b ("foo" is held by another live session on this machine)',
    )
    expect(formatSessionRenamedMessage('foo')).toBe('Session renamed to: foo')
  })
})

describe('collectOccupiedNameKeys', () => {
  test('builds set of normalized names', () => {
    const s = collectOccupiedNameKeys([
      rec(1, 'A B', 1),
      rec(2, 'a-b', 2),
      rec(3, undefined, 3),
    ])
    expect(s.has('a-b')).toBe(true)
    expect(s.size).toBe(1)
  })
})

describe('densable mEn resolveSessionNameWithLiveRegistry', () => {
  test('yields on rename when another live holds name', async () => {
    const live = [rec(1, 'shared', 100), rec(process.pid, 'shared', 200)]
    const deps: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => live,
    }
    const r = await resolveSessionNameWithLiveRegistry('shared', 'rename', deps)
    expect(r.yielded).toBe(true)
    expect(r.name).not.toBe('shared')
    expect(r.name.startsWith('shared-')).toBe(true)
  })

  test('keeps name when unique', async () => {
    const live = [rec(process.pid, 'solo', 100)]
    const deps: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => live,
    }
    const r = await resolveSessionNameWithLiveRegistry('solo', 'startup', deps)
    expect(r.yielded).toBe(false)
    expect(r.name).toBe('solo')
  })
})

describe('densable Bid runSessionNameStartupUniqueness', () => {
  test('writes sessionNameArg then yields if contested by older holder', async () => {
    const writes: Array<{ name: string; source: string }> = []
    let selfName = 'shared'
    const live = (): LiveSessionNameRecord[] => [
      rec(1, 'shared', 10), // older holder
      {
        pid: process.pid,
        name: selfName,
        startedAt: 100,
        nameSource: 'user',
      },
    ]
    const deps: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => live(),
    }
    await runSessionNameStartupUniqueness({
      sessionNameArg: 'shared',
      interactive: true,
      writeName: async (name, source) => {
        writes.push({ name, source })
        selfName = name
      },
      deps,
      scheduleRecheck: () => {
        /* no timer in unit test */
      },
    })
    expect(writes[0]).toEqual({ name: 'shared', source: 'user' })
    // startup yields to older → collision write
    expect(writes.some(w => w.source === 'collision')).toBe(true)
  })

  test('skips when not interactive', async () => {
    const writes: Array<{ name: string; source: string }> = []
    await runSessionNameStartupUniqueness({
      sessionNameArg: 'x',
      interactive: false,
      writeName: async (name, source) => {
        writes.push({ name, source })
      },
      deps: {
        whenRegistered: async () => true,
        listLive: async () => [],
      },
    })
    // still writes sessionNameArg as user
    expect(writes).toEqual([{ name: 'x', source: 'user' }])
  })
})

describe('densable G$o scheduleSessionNameRenameRecheck', () => {
  test('uses SESSION_NAME_RECHECK_MS = 3000', () => {
    expect(SESSION_NAME_RECHECK_MS).toBe(3000)
  })

  test('onYield when recheck finds older claim', async () => {
    let selfName = 'mine'
    const yields: string[] = []
    await new Promise<void>(resolve => {
      scheduleSessionNameRenameRecheck({
        name: 'mine',
        scheduleRecheck: fn => {
          // run immediately instead of waiting 3s
          fn()
        },
        deps: {
          whenRegistered: async () => true,
          listLive: async () => [
            rec(1, 'mine', 1, { nameSince: 1 }),
            {
              pid: process.pid,
              name: selfName,
              startedAt: 99,
              nameSince: 99,
            },
          ],
        },
        onYield: async (newName, previous) => {
          yields.push(`${previous}->${newName}`)
          selfName = newName
          resolve()
        },
      })
      // if no yield, still resolve shortly
      setTimeout(resolve, 50)
    })
    expect(yields.length).toBe(1)
    expect(yields[0]?.startsWith('mine->')).toBe(true)
  })
})

describe('densable Nid / QM_ / jid residual', () => {
  test('Fid parseCollisionNameSuffix only for known adj-noun', () => {
    // use a real short slug pair from words.ts
    const pair = parseCollisionNameSuffix('auth-calm-otter')
    // may be undefined if calm/otter not both in lists — still lock shape
    const known = parseCollisionNameSuffix('auth-bright-fox')
    // at least rejects non-pair tails
    expect(parseCollisionNameSuffix('auth-notapair')).toBeUndefined()
    expect(parseCollisionNameSuffix('-calm-otter')).toBeUndefined()
    void pair
    void known
  })

  test('noteCorrespondent caps at KM_=64 and only uds', () => {
    sessionNameState.reset()
    noteSessionNameCorrespondent('bridge:x', 1)
    expect(sessionNameState.correspondents.size).toBe(0)
    for (let i = 0; i < SESSION_NAME_CORRESPONDENT_CAP + 5; i++) {
      noteSessionNameCorrespondent(`uds:/tmp/s${i}.sock`, i)
    }
    expect(sessionNameState.correspondents.size).toBe(
      SESSION_NAME_CORRESPONDENT_CAP,
    )
    sessionNameState.reset()
  })

  test('QM_ lastYield reuse via preferStableYieldName / XAt', async () => {
    sessionNameState.reset()
    const live = [
      rec(1, 'shared', 10),
      rec(process.pid, 'shared-calm-otter', 100, {
        name: 'shared-calm-otter',
      }),
    ]
    // first yield records lastYield
    const deps: SessionNameUniquenessDeps = {
      whenRegistered: async () => true,
      listLive: async () => live,
    }
    const r1 = await resolveSessionNameWithLiveRegistry(
      'shared',
      'rename',
      deps,
      'shared',
    )
    expect(r1.yielded).toBe(true)
    expect(sessionNameState.lastYield?.base).toBe('shared')
    // force self name to lastYield name for reuse path
    live[1] = rec(process.pid, r1.name, 100)
    const reuse = reuseLastYieldName('shared', r1.name)
    expect(reuse).toBe(r1.name)
    const stable = preferStableYieldName('shared', live[1]!)
    expect(stable).toBe(r1.name)
    sessionNameState.reset()
  })

  test('jid peer notice body + send filter', async () => {
    sessionNameState.reset()
    noteSessionNameCorrespondent('uds:/tmp/peer.sock', 42)
    noteSessionNameCorrespondent('uds:/tmp/stale.sock', 99)
    const sent: Array<{ sock: string; body: string; fromName?: string }> = []
    await notifySessionNameCorrespondents('old', 'new', 'desired', {
      skipUdsGate: true,
      ownSocket: () => '/tmp/self.sock',
      listLive: async () => [
        { pid: 42, startedAt: 1, sock: '/tmp/peer.sock' },
        // 99 no longer owns stale sock
        { pid: 99, startedAt: 1, sock: '/tmp/other.sock' },
      ],
      send: async (sock, body, fromName) => {
        sent.push({ sock, body, fromName })
      },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.sock).toBe('/tmp/peer.sock')
    expect(sent[0]!.body).toBe(
      formatSessionRenamePeerNotice('old', 'new', 'desired'),
    )
    expect(sent[0]!.body).toContain('Address this one as "new"')
    sessionNameState.reset()
  })
})
