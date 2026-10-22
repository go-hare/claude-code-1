/**
 * densable 2.1.289 shareStatus.otherComments — P() / T() / Ght / Bzr.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  forgetOtherCommentSightings,
  hasOtherCommentSightings,
  latestOtherCommentSeq,
  nextOtherCommentSeq,
  noteOtherCommentGap,
  otherCommentsRow,
  recordOtherCommentSighting,
  resetArtifactAutoReactStoreForTests,
  un,
} from '../index.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
})

describe('shareStatus.otherComments (densable P/T/Ght/Bzr)', () => {
  test('store hosts otherComments Map and otherCommentSeq', () => {
    const store = un()
    expect(store.shareStatus.otherComments).toBeInstanceOf(Map)
    expect(store.shareStatus.otherCommentSeq).toBe(0)
  })

  test('P() get-or-create row; T() bumps seq', () => {
    const a = otherCommentsRow('slug-a')
    const again = otherCommentsRow('slug-a')
    expect(again).toBe(a)
    expect(nextOtherCommentSeq()).toBe(1)
    expect(nextOtherCommentSeq()).toBe(2)
    expect(un().shareStatus.otherCommentSeq).toBe(2)
  })

  test('Ght is false until a sighting exists', () => {
    expect(hasOtherCommentSightings('slug-a')).toBe(false)
    const row = otherCommentsRow('slug-a')
    expect(hasOtherCommentSightings('slug-a')).toBe(false)
    row.sightings.push({ seq: 1, kind: 'gap' })
    expect(hasOtherCommentSightings('slug-a')).toBe(true)
  })

  test('Bzr no-ops when row missing or n is undefined', () => {
    forgetOtherCommentSightings('missing', 1)
    const row = otherCommentsRow('slug-a')
    row.sightings.push({ seq: 1, kind: 'gap' })
    forgetOtherCommentSightings('slug-a')
    expect(row.sightings).toHaveLength(1)
  })

  test('Bzr drops sightings with seq <= n', () => {
    const row = otherCommentsRow('slug-a')
    row.sightings.push(
      { seq: 1, kind: 'gap' },
      { seq: 2, kind: 'row', key: 'k', authorship: 'user' },
      { seq: 3, kind: 'handIn', threadId: 't', gestureAt: 1 },
    )
    forgetOtherCommentSightings('slug-a', 2)
    expect(row.sightings.map(s => s.seq)).toEqual([3])
  })

  test('D production push caps sightings at 64', () => {
    for (let i = 0; i < 70; i++) {
      recordOtherCommentSighting('slug-a', {
        kind: 'row',
        key: `k${i}`,
        authorship: 'user',
      })
    }
    const row = otherCommentsRow('slug-a')
    expect(row.sightings).toHaveLength(64)
    expect(row.sightings[0]?.kind === 'row' && row.sightings[0].key).toBe('k6')
    expect(hasOtherCommentSightings('slug-a')).toBe(true)
  })

  test('XBe records a gap sighting', () => {
    expect(hasOtherCommentSightings('slug-a')).toBe(false)
    noteOtherCommentGap('slug-a')
    expect(hasOtherCommentSightings('slug-a')).toBe(true)
    expect(otherCommentsRow('slug-a').sightings[0]?.kind).toBe('gap')
  })

  test('zPw records other-authorship humans via D', () => {
    const src = readFileSync(join(import.meta.dir, '../scan.ts'), 'utf8')
    expect(src).toContain('recordOtherCommentSighting(t,')
    expect(src).toContain("authorship: 'user'")
  })

  test('upload silent allow requires !Ght', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.ts',
      ),
      'utf8',
    )
    expect(src).toContain('!hasOtherCommentSightings(parsed.slug)')
  })

  test('zht is the last sighting seq', () => {
    expect(latestOtherCommentSeq('slug-a')).toBeUndefined()
    const row = otherCommentsRow('slug-a')
    row.sightings.push({ seq: 4, kind: 'gap' }, { seq: 7, kind: 'gap' })
    expect(latestOtherCommentSeq('slug-a')).toBe(7)
  })

  test('ask stamps zht; qIt call site passes otherCommentSeq', () => {
    const perms = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.ts',
      ),
      'utf8',
    )
    expect(perms).toContain('latestOtherCommentSeq(parsed.slug)')
    expect(perms).toContain('otherCommentSeq: seq')
    expect(perms).toContain(
      'const askPin = gNePin(latestOtherCommentSeq(parsed.slug))',
    )
    expect(perms).toContain('until someone else comments on it again')
    expect(perms).toContain("to (and copies of other artifacts' assets into) ")
    expect(perms).toContain('isArtifactCopyFromOn')
    const tool = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/ArtifactTool/ArtifactTool.ts',
      ),
      'utf8',
    )
    const fn = tool.indexOf('async function recordUploadGrantIfPinned')
    const body = tool.slice(fn, fn + 1200)
    expect(body).toContain('typeof pin.otherCommentSeq ===')
    expect(body).toContain('recordArtifactAssetUploadGrant(')
    expect(body).toContain('afterSeq')
  })

  test('qIt source calls Bzr then ConsentSlugs', () => {
    const src = readFileSync(
      join(import.meta.dir, '../readPerm/grants.ts'),
      'utf8',
    )
    const fn = src.indexOf('export function recordArtifactAssetUploadGrant')
    const body = src.slice(fn, src.indexOf('export function', fn + 1))
    expect(body).toContain('forgetOtherCommentSightings(slug, afterSeq)')
    expect(body.indexOf('forgetOtherCommentSightings')).toBeLessThan(
      body.indexOf('uploadConsentKeys'),
    )
  })
})
