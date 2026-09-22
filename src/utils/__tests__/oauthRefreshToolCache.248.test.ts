/**
 * densable 2.1.248 #8 — oauth-refresh-tool-cache (r_ / s_ / Ip / o_).
 *
 * GOLD: gold-248-unk-8-ip.txt
 * r_ @180125072 · s_ @180125738 · Ip @180712775 sha=043f2d44f49faba4
 * G2t after oauth save: lY(),Ip()  — not leftover Map.clear
 * Vmn logout stays always IW. Token refresh uses Ip via G2t/save.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  Gx,
  Ip,
  IW,
  clearToolSchemaCache,
  i_,
  kn,
  o_,
  r_,
  s_,
  type CachedSchema,
} from '../toolSchemaCache.js'

const cacheSrc = readFileSync(
  join(import.meta.dir, '../toolSchemaCache.ts'),
  'utf8',
)
const authSrc = readFileSync(join(import.meta.dir, '../auth.ts'), 'utf8')
const logoutSrc = readFileSync(
  join(import.meta.dir, '../../commands/logout/logout.tsx'),
  'utf8',
)

const SCHEMA: CachedSchema = {
  name: 'x',
  description: 'd',
  input_schema: { type: 'object', properties: {} },
}

function resetR(): void {
  const e = kn()
  e.byKey.clear()
  e.generation = 0
  e.keepAcrossTokenChanges = undefined
}

afterEach(() => {
  resetR()
})

describe('densable 2.1.248 #8 r_ methods', () => {
  test('r_ get/stamp/register/size/invalidateAll/dropInFlight', () => {
    const e = new r_()
    expect(e.keepAcrossTokenChanges).toBeUndefined()
    expect(e.generation).toBe(0)
    expect(e.size).toBe(0)
    expect(e.stamp()).toBe(0)
    expect(e.get('k')).toBeUndefined()

    const gen = e.stamp()
    e.register('k', SCHEMA, gen)
    expect(e.get('k')).toEqual(SCHEMA)
    expect(e.size).toBe(1)

    e.register('stale', SCHEMA, gen - 1)
    expect(e.get('stale')).toBeUndefined()
    expect(e.size).toBe(1)

    e.dropInFlightComposes()
    expect(e.stamp()).toBe(1)
    expect(e.size).toBe(1)
    e.register('late', SCHEMA, gen)
    expect(e.get('late')).toBeUndefined()

    e.invalidateAll()
    expect(e.size).toBe(0)
    expect(e.stamp()).toBe(2)
    expect(e.keepAcrossTokenChanges).toBeUndefined()
  })

  test('IW is clearToolSchemaCache alias; o_ is gen++ only', () => {
    const e = kn()
    e.register('k', SCHEMA, e.stamp())
    expect(e.size).toBe(1)
    o_()
    expect(e.size).toBe(1)
    expect(e.stamp()).toBe(1)
    expect(clearToolSchemaCache).toBe(IW)
    IW()
    expect(e.size).toBe(0)
    expect(e.stamp()).toBe(2)
  })

  test('module is official r_ not leftover Map.clear', () => {
    expect(cacheSrc).toContain('class r_')
    expect(cacheSrc).toContain('keepAcrossTokenChanges')
    expect(cacheSrc).toContain('dropInFlightComposes')
    expect(cacheSrc).toContain('tengu_still_kestrel')
    expect(cacheSrc).toContain(
      'if (r === this.generation) this.byKey.set(e, t)',
    )
    expect(cacheSrc).toContain('this.byKey.clear()')
    expect(cacheSrc).toContain('this.generation += 1')
    expect(cacheSrc).toContain('if ((clearBetasCaches(), !s_())) IW()')
    expect(cacheSrc).toContain('else o_()')
    expect(cacheSrc).not.toContain('const TOOL_SCHEMA_CACHE = new Map')
    expect(cacheSrc).not.toContain('TOOL_SCHEMA_CACHE.clear()')
  })
})

describe('densable 2.1.248 #8 s_ latch', () => {
  test('default false when Bl is unset; does not latch', () => {
    const prev = i_(null)
    try {
      expect(s_()).toBe(false)
      expect(kn().keepAcrossTokenChanges).toBeUndefined()
      expect(Gx).toBe('tengu_still_kestrel')
    } finally {
      i_(prev)
    }
  })

  test('GB true latches; later Bl flip is ignored', () => {
    const prev = i_((gate, fallback) => {
      expect(gate).toBe(Gx)
      expect(fallback).toBe(false)
      return true
    })
    try {
      expect(s_()).toBe(true)
      expect(kn().keepAcrossTokenChanges).toBe(true)
      i_(() => false)
      expect(s_()).toBe(true)
    } finally {
      i_(prev)
    }
  })

  test('GB false latches false', () => {
    const prev = i_(() => false)
    try {
      expect(s_()).toBe(false)
      expect(kn().keepAcrossTokenChanges).toBe(false)
      i_(() => true)
      expect(s_()).toBe(false)
    } finally {
      i_(prev)
    }
  })
})

describe('densable 2.1.248 #8 Ip fold', () => {
  test('s_ false → IW clear+gen++; s_ true → o_ gen++ only', () => {
    const e = kn()
    e.keepAcrossTokenChanges = false
    e.register('k', SCHEMA, e.stamp())
    Ip()
    expect(e.size).toBe(0)
    expect(e.stamp()).toBe(1)

    e.register('k', SCHEMA, e.stamp())
    e.keepAcrossTokenChanges = true
    Ip()
    expect(e.size).toBe(1)
    expect(e.stamp()).toBe(2)
  })
})

describe('densable 2.1.248 #8 oauth-save / logout callers', () => {
  test('auth.ts save uses Ip / dropInFlight, not always IW', () => {
    expect(authSrc).toContain('Ip()')
    expect(authSrc).toContain('dropInFlight')
    expect(authSrc).toContain('lY(),Ip()')
    expect(authSrc).not.toContain('clearToolSchemaCache()')
    expect(authSrc).not.toContain('clearBetasCaches()')
    const save = authSrc.slice(
      authSrc.indexOf('export function saveOAuthTokensIfNeeded'),
      authSrc.indexOf('export function getActiveProfileAccessToken'),
    )
    expect(save).toContain('Ip()')
    expect(save).not.toContain('clearToolSchemaCache')
    expect(save).not.toContain('clearBetasCaches()')
  })

  test('logout leftover stays always IW', () => {
    expect(logoutSrc).toContain('clearToolSchemaCache()')
    expect(logoutSrc).toContain('clearBetasCaches()')
    expect(logoutSrc).not.toContain('Ip()')
    expect(logoutSrc).not.toContain('dropInFlight')
  })
})
