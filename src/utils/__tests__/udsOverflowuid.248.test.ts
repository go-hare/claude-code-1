/**
 * densable 2.1.248 #48 — leftover UDS sockets-dir vet calls tGn / p.
 *
 * Gold: gold-248-48-apply-full.txt Ce() @198269713
 *   r=await tGn(); r?.uidCollapses → uid_collapse
 *   p=(c,O,v)=>t===void 0||s(c)||!O&&(d(c)?g(v):c===0)
 * Gold cn @198268400 (Re uid_collapse). ≠ daemon tsn / F1t.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  UDS_SOCKETS_DIRECTORY_RULE,
  UDS_SOCKETS_PATH_HINT,
  UDS_SOCKETS_UID_COLLAPSE,
} from '../udsMessaging.js'

const udsSrc = readFileSync(join(import.meta.dir, '../udsMessaging.ts'), 'utf8')
const helperSrc = readFileSync(
  join(import.meta.dir, '../overflowuidTrust.ts'),
  'utf8',
)
const daemonSrc = readFileSync(
  join(import.meta.dir, '../../daemon/bgManager.ts'),
  'utf8',
)

const GOLD_CN =
  'This process runs in a user namespace without a uid mapping (its own uid reads as the kernel overflow uid), so file ownership cannot be verified. Start it with a uid map (e.g. `unshare -Ur` / `--map-current-user`), or pass --messaging-socket-path.'

const GOLD_DIRECTORY_RULE = `A directory on the sockets path is shared (world- or group-writable without the sticky bit, e.g. a container volume mounted at /tmp) or not owned by you or root. ${UDS_SOCKETS_PATH_HINT}`

describe('densable 2.1.248 #48 UDS sockets-dir overflowuid vet', () => {
  test('gold cn / directory_rule Re() copies 1:1', () => {
    expect(UDS_SOCKETS_UID_COLLAPSE).toBe(GOLD_CN)
    expect(UDS_SOCKETS_DIRECTORY_RULE).toBe(GOLD_DIRECTORY_RULE)
  })

  test('leftover walk imports and calls tGn snapshot + p predicate', () => {
    expect(udsSrc).toContain("from './overflowuidTrust.js'")
    expect(udsSrc).toContain('tGn')
    expect(udsSrc).toContain('const snap = await tGn()')
    expect(udsSrc).toContain('if (snap?.uidCollapses)')
    expect(udsSrc).toContain('throw new Error(UDS_SOCKETS_UID_COLLAPSE)')
    expect(udsSrc).toContain(
      'p(Number(stat.uid), false, resolvedLink, uid, snap)',
    )
    expect(udsSrc).toContain('p(Number(stat.uid), false, acc, uid, snap)')
    const walk = udsSrc.slice(
      udsSrc.indexOf('async function walkSocketsPathComponents'),
      udsSrc.indexOf('async function ensureSocketParent'),
    )
    expect(walk).toContain('await tGn()')
    expect(walk).toContain('p(Number(stat.uid), false, acc, uid, snap)')
  })

  test('does not steal daemon tsn / F1t leftover', () => {
    expect(udsSrc).not.toContain('refusing to use the daemon socket')
    expect(udsSrc).not.toContain('function F1t')
    expect(udsSrc).not.toContain('function tsn')
    expect(udsSrc).not.toContain('uidsCollapse')
    expect(helperSrc).not.toContain('function F1t')
    expect(helperSrc).not.toContain('unshare -Ur')
    expect(daemonSrc).toContain(
      'refusing to bind: ${dir} is owned by uid ${stat.uid}',
    )
  })
})
