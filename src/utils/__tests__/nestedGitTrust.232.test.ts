/**
 * densable 2.1.232 #15 — nested git does not inherit parent trust.
 * Pure `yed` walk: walkHasTrustDialogAcceptedBounded.
 */
import { describe, expect, test } from 'bun:test'
import { resolve } from 'path'
import { normalizePathForConfigKey } from '../path.js'
import { walkHasTrustDialogAcceptedBounded } from '../config.js'

function key(p: string): string {
  return normalizePathForConfigKey(resolve(p))
}

// Platform-native absolute trees so resolve(path, '..') stays consistent.
const ROOT = process.platform === 'win32' ? 'D:/repos' : '/repos'
const PARENT = `${ROOT}/parent`
const NESTED = `${PARENT}/nested`
const NESTED_SRC = `${NESTED}/src`
const SIBLING = `${PARENT}/other`

const parentKey = key(PARENT)
const nestedKey = key(NESTED)
const nestedSrcKey = key(NESTED_SRC)
const siblingKey = key(SIBLING)

type TrustWalkConfig = Parameters<typeof walkHasTrustDialogAcceptedBounded>[0]

function trustConfig(
  projects: Record<string, { hasTrustDialogAccepted: boolean }>,
): TrustWalkConfig {
  // Test-only partial projects map — walk only reads hasTrustDialogAccepted.
  return { projects } as unknown as TrustWalkConfig
}

describe('walkHasTrustDialogAcceptedBounded (densable 2.1.232 #15 yed)', () => {
  test('trust at nested git root is accepted for paths inside it', () => {
    const config = trustConfig({
      [nestedKey]: { hasTrustDialogAccepted: true },
    })
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, nestedKey),
    ).toBe(true)
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedKey, nestedKey),
    ).toBe(true)
  })

  test('parent trust outside nested git root is rejected', () => {
    const config = trustConfig({
      [parentKey]: { hasTrustDialogAccepted: true },
    })
    // Nested repo bound: must not inherit parent project trust
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, nestedKey),
    ).toBe(false)
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedKey, nestedKey),
    ).toBe(false)
  })

  test('trust above bound is ignored even if walk would pass through', () => {
    const config = trustConfig({
      [parentKey]: { hasTrustDialogAccepted: true },
      [key(ROOT)]: { hasTrustDialogAccepted: true },
    })
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, nestedKey),
    ).toBe(false)
  })

  test('same-repo parent trust (bound higher) is accepted', () => {
    // Single repo at PARENT; nested/src is just a subdirectory, not a nested .git
    const config = trustConfig({
      [parentKey]: { hasTrustDialogAccepted: true },
    })
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, parentKey),
    ).toBe(true)
  })

  test('unbounded walk (gitRoot null) inherits parent trust — advisory path', () => {
    const config = trustConfig({
      [parentKey]: { hasTrustDialogAccepted: true },
    })
    // densable v6e advisoryNoFsProbe → yed(..., null)
    expect(walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, null)).toBe(
      true,
    )
  })

  test('no trust anywhere returns false', () => {
    const config = trustConfig({})
    expect(
      walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, nestedKey),
    ).toBe(false)
    expect(walkHasTrustDialogAcceptedBounded(config, nestedSrcKey, null)).toBe(
      false,
    )
  })

  test('path already outside git root bound fails closed', () => {
    const config = trustConfig({
      [siblingKey]: { hasTrustDialogAccepted: true },
      [parentKey]: { hasTrustDialogAccepted: true },
    })
    // Start is sibling of nested; bound is nested root → outside prefix → false
    expect(
      walkHasTrustDialogAcceptedBounded(config, siblingKey, nestedKey),
    ).toBe(false)
  })

  test('trust only on intermediate path inside same root', () => {
    const mid = key(`${NESTED}/pkg`)
    const deep = key(`${NESTED}/pkg/lib`)
    const config = trustConfig({
      [mid]: { hasTrustDialogAccepted: true },
    })
    expect(walkHasTrustDialogAcceptedBounded(config, deep, nestedKey)).toBe(
      true,
    )
  })
})
